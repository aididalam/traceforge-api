# TraceForge API

Tenant-scoped HTTP API over the TraceForge indexed MySQL read model.

The API is read-only. It does not submit blockchain transactions.

## Development

```bash
cp .env.example .env
npm install
npm run typecheck
npm run dev
```

## Development network

The chain and contract scope are configured with:

- `TRACEFORGE_CHAIN_ID`
- `TRACEFORGE_CONTRACT_ADDRESS`

This keeps history queries isolated when one MySQL database contains events from
more than one TraceForge deployment.

## Endpoints

- `GET /health`
- `GET /ready`
- `GET /docs`
- `GET /openapi.json`
- `GET /v1/tenants/:tenantId/entities/:entityId`
- `GET /v1/tenants/:tenantId/entities/:entityId/history`

Entity history supports cursor pagination:

```text
?limit=50&afterEventId=123
```

`limit` defaults to 50 and is capped at 100.

## Error shape

```json
{
  "error": {
    "code": "entity_not_found",
    "message": "Entity was not found."
  }
}
```

## Secrets

`.env` is local-only and ignored by Git.

Never commit private keys or production database credentials.

## Resolved off-chain documents

API v0.3 resolves off-chain JSON documents by their on-chain content hash.

Entity responses include both `metadataHash` and resolved `metadata` when the
document exists in `offchain_documents`.

History responses include:

- `metadataHash` and `metadata`
- `evidenceHash` and `evidence`

Missing off-chain content does not invalidate the chain event. In that case the
hash remains available and the resolved document is `null`.

A document can also be fetched directly:

```text
GET /v1/documents/:contentHash
```

## Human-readable semantics

API v0.4 resolves dynamic semantic hashes through the indexer's
`semantic_registry`.

Entity responses include:

- `entityTypeLabel`
- `currentStateLabel`

History events include:

- `eventTypeLabel`
- `stateAfterLabel`
- `linkTypeLabel`

The original hash is always returned. Unknown semantics are never guessed:
their label is `null`.

## Discovery endpoints

API v0.5 adds tenant-scoped browse endpoints so clients do not need to know
entity, organization, or relationship IDs in advance.

```text
GET /v1/tenants/:tenantId/entities
GET /v1/tenants/:tenantId/organizations
GET /v1/tenants/:tenantId/relationships
```

All three endpoints use event-order cursor pagination:

```text
?limit=50&afterEventId=123
```

Responses preserve the original hashes and include verified semantic labels and
resolved metadata when available.

## Acceptance tests

TraceForge API includes executable acceptance tests against the canonical local
sandbox dataset.

Start the API first:

```bash
npm run dev
```

Then, from another terminal:

```bash
npm run test:acceptance
```

The suite verifies health/readiness, current entity state, closed lifecycle,
off-chain document resolution, history semantics, tenant discovery, cursor
pagination, structured validation errors, and OpenAPI exposure.

The default fixture IDs target the TraceForge chain-9009 sandbox. They can be
overridden with:

```text
API_BASE_URL
TRACEFORGE_TEST_TENANT_ID
TRACEFORGE_TEST_BATCH_ID
TRACEFORGE_TEST_ITEM_ID
TRACEFORGE_TEST_BATCH_METADATA_HASH
```

## Tenant-scoped API authentication

API v0.6 protects all `/v1/*` routes with tenant-scoped bearer tokens.

Tokens are generated locally and only a SHA-256 digest is stored in MySQL.
The plaintext token should be kept in a protected local secret file and never
committed or pasted into logs.

System endpoints such as `/health`, `/ready`, `/docs`, and `/openapi.json`
remain unauthenticated.

Issue a local sandbox token after applying API migrations:

```text
npm run api:migrate
npm run auth:issue -- --tenant <tenant-id> --name sandbox-dev --output ~/.traceforge/secrets/api-sandbox.token
```

Use the token:

```text
Authorization: Bearer <token>
```

Tenant-scoped routes reject a valid token when its tenant does not match the
route tenant. The hash-based document endpoint is also restricted to documents
referenced by the authenticated token's tenant.

## API principals and scopes

API v0.7 separates read access from future blockchain write authority.

Supported scopes:

```text
tenant:read
chain:write
```

Existing v0.6 tokens are migrated to `tenant:read`.

A token with `chain:write` must be bound to an active tenant organization. This
does not itself grant blockchain capability; future write endpoints must also
verify the bound organization's on-chain role/capability and use a controlled
signer.

Inspect the current authenticated principal:

```text
GET /v1/auth/me
```

Local token lifecycle helpers:

```text
npm run auth:list
npm run auth:revoke -- --token-id <id>
```

Do not issue `chain:write` tokens until the signer boundary is configured.

## Read-only chain write preflight

API v0.8 adds:

```text
GET /v1/auth/preflight
```

The route never signs or broadcasts a transaction. It requires a
`chain:write` API token and verifies live chain state before a future write
endpoint is allowed to proceed.

Required runtime configuration:

```text
TRACEFORGE_RPC_URL=http://127.0.0.1:8545
TRACEFORGE_SIGNER_ADDRESS=<public signer wallet address>
```

Supported capability names map exactly to the immutable Solidity enum order:

```text
ENTITY_CREATE       0
TRACE_RECORD        1
STATE_UPDATE        2
METADATA_UPDATE     3
CUSTODY_TRANSFER    4
ENTITY_LINK         5
ENTITY_CLOSE        6
```

Example:

```text
/v1/auth/preflight?capability=CUSTODY_TRANSFER&entityId=<id>&requireCustody=true&pendingCustody=forbidden
```

`pendingCustody` may be `ignore`, `required`, or `forbidden`.

The preflight checks chain ID, deployed bytecode, tenant/org/membership state,
signer wallet binding, live `hasCapability` authorization, and optional entity,
custody, closed-state, and pending-custody conditions.

The role candidate list comes from the indexed read model, but authorization is
accepted only when the deployed contract's live `hasCapability` returns true.

## v0.8 preflight acceptance coverage

The acceptance suite also exercises the live chain preflight boundary.

It expects the writer token at:

```text
~/.traceforge/secrets/api-sandbox-writer.token
```

Override with either:

```text
TRACEFORGE_WRITER_TOKEN_FILE
TRACEFORGE_WRITER_TOKEN
```

The live preflight tests verify:

- a distributor writer is authorized for `CUSTODY_TRANSFER`;
- every required live-chain check passes for the open sandbox batch;
- a read-only token is rejected with `insufficient_scope`;
- the already-closed sandbox item fails the `entity_open` guard;
- `/v1/auth/preflight` is present in OpenAPI.

No acceptance test signs or broadcasts a transaction.

## Controlled custody simulation

API v0.9 adds the first transaction-shaped endpoint:

```text
POST /v1/tenants/:tenantId/entities/:entityId/custody/proposals/simulate
```

It **never broadcasts**.

Before simulation it:

- requires an organization-bound `chain:write` token;
- loads the configured signer key file without printing it;
- rejects key files with group/other permissions;
- derives the signer address and requires it to equal
  `TRACEFORGE_SIGNER_ADDRESS`;
- verifies live chain/network/contract/tenant/org/wallet/membership state;
- verifies current custody and absence of a pending transfer;
- verifies the destination organization and membership;
- discovers a live role whose `CUSTODY_TRANSFER` capability passes
  `hasCapability`;
- runs `simulateContract`;
- estimates gas;
- returns `broadcast: false`.

Runtime configuration:

```text
TRACEFORGE_SIGNER_KEY_FILE=~/.traceforge/secrets/sandbox-distributor.key
```

No wallet client and no transaction-broadcast call exists in this milestone.

## v0.9 custody simulation acceptance coverage

The acceptance suite verifies the first transaction-shaped API flow without
broadcasting a transaction.

It checks that:

- the distributor writer can simulate `proposeCustodyTransfer`;
- every live preflight check succeeds;
- gas estimation returns a positive value;
- the response explicitly reports `broadcast: false`;
- a follow-up live preflight proves no pending custody transfer was created;
- a read-only token cannot access the simulation endpoint;
- the simulation route is exposed in OpenAPI.

The suite never submits a state-changing transaction.

## Controlled custody broadcast endpoint

API v0.10 adds:

```text
POST /v1/tenants/:tenantId/entities/:entityId/custody/proposals/broadcast
```

The route is **disabled by default**:

```text
TRACEFORGE_BROADCAST_ENABLED=false
```

A broadcast request requires all of the following:

- an organization-bound `chain:write` token;
- a valid `Idempotency-Key` header;
- request body `confirm: "BROADCAST"`;
- live signer / tenant / organization / membership / custody / recipient /
  capability checks;
- successful contract simulation;
- gas estimation with a 20% gas-limit buffer;
- zero-fee legacy transaction signing for TraceForge chain 9009.

Before submitting, the API signs the exact transaction locally, computes its
transaction hash, and stores both the operation and signed transaction in
`chain_write_operations`. This permits recovery if the process exits between
signing/submission/receipt handling.

After submission it requires:

- a successful receipt;
- matching `CustodyTransferProposed`;
- matching `TraceRecorded`;
- live pending-custody readback matching the request.

After confirmation the stored serialized transaction is cleared.

The endpoint must remain disabled until the final immutable-write checkpoint is
reviewed.
## API v0.11 — organization-aware signers and custody acceptance simulation

v0.11 introduces an organization-to-signer mapping file:

```text
TRACEFORGE_SIGNER_MAP_FILE=~/.traceforge/config/api-signers.json
```

The mapping contains only public organization IDs, public wallet addresses, and
paths to protected key files. Private keys remain in owner-only local secret
files and are never stored in MySQL.

Proposal simulation/broadcast routes now choose the signer from the authenticated
API principal's organization. The legacy single signer configuration remains as
a fallback when no signer map file is configured.

New non-broadcast route:

```text
POST /v1/tenants/:tenantId/entities/:entityId/custody/acceptances/simulate
```

It requires an organization-bound `chain:write` token and verifies:

- live chain ID and deployed contract code;
- mapped signer integrity and live wallet-to-organization binding;
- active tenant, organization, and tenant membership;
- entity exists and is open;
- a pending custody transfer exists;
- the authenticated organization is the pending recipient;
- pending source still matches the current custodian;
- the recipient is not already the current custodian;
- a live role grants `CUSTODY_TRANSFER`;
- exact `acceptCustodyTransfer` simulation succeeds;
- gas estimation succeeds.

The route always returns `broadcast: false`; v0.11 does not add an acceptance
broadcast endpoint. Broadcasting remains controlled by the existing server
safety flag and the final immutable-write checkpoint.
## API v0.12 — controlled custody acceptance broadcast

v0.12 adds:

```text
POST /v1/tenants/:tenantId/entities/:entityId/custody/acceptances/broadcast
```

The endpoint remains protected by the global server gate:

```text
TRACEFORGE_BROADCAST_ENABLED=false
```

It requires:

- an organization-bound `chain:write` token;
- an organization-aware mapped signer;
- a valid `Idempotency-Key`;
- `confirm: "BROADCAST"`;
- chain ID 9009;
- exact deployed runtime bytecode hash;
- active tenant / organization / membership;
- live wallet-to-organization binding;
- an open entity;
- an existing pending custody transfer;
- the authenticated organization must be the pending recipient;
- the pending source must still equal the current custodian;
- a live `CUSTODY_TRANSFER` capability;
- exact `acceptCustodyTransfer` simulation;
- gas estimation and 20% gas-limit buffer.

The signed transaction is journaled in `chain_write_operations` before node
submission. The route supports same-key recovery for PREPARED/BROADCAST writes.

A successful receipt is accepted only if it contains both a matching
`CustodyTransferred` event and matching `TraceRecorded`. It then requires live
readback proving the pending transfer is cleared and the entity's current
custodian is the authenticated recipient organization.

No acceptance transaction should be sent until the separate immutable-write
checkpoint is reviewed.

## API v0.13 — shared write safety and organization-aware preflight

v0.13 consolidates the live-chain authorization checks used by write preflight,
custody simulations, and custody broadcasts.

`src/write-safety.ts` is now the shared authority for:

- chain ID verification;
- deployed contract presence;
- exact runtime bytecode hash verification;
- tenant and organization existence/activity;
- tenant membership;
- mapped signer wallet-to-organization binding;
- live role/capability authorization;
- recipient organization and membership checks for custody proposals.

`GET /v1/auth/preflight` now resolves the signer from the authenticated
organization using the same organization-to-signer map as write routes. It no
longer assumes the legacy global signer address. This means Distributor and
Producer principals can be preflighted independently without changing process
configuration.

`TRACEFORGE_RUNTIME_BYTECODE_HASH` is parsed once through API configuration and
must be a valid bytes32 value when present. All write safety checks consume that
normalized configuration value.

Broadcast behavior is unchanged:

```text
TRACEFORGE_BROADCAST_ENABLED=false
```

remains the safe default, and v0.13 introduces no new chain mutation.

### Custody provenance schema

`schemas/custody-operation-provenance.schema.json` documents schema version 1
for custody-operation provenance artifacts. It supports both proposal-only
(`complete: false`) and completed proposal/acceptance flows.

Validate custody provenance artifacts from the umbrella checkout with:

```bash
npm run provenance:validate
```

The validator defaults to:

```text
../contracts/deployments/9009/operations
```

and can also receive one or more explicit JSON files or directories.
## API v0.14 — generic write simulation foundation

v0.14 exposes non-broadcast simulation routes for all non-custody protocol
capabilities. They use the same organization-aware signer and centralized live
write-safety checks as custody operations.

Routes:

```text
POST /v1/tenants/:tenantId/entities/:entityId/create/simulate
POST /v1/tenants/:tenantId/entities/:entityId/traces/simulate
POST /v1/tenants/:tenantId/entities/:entityId/state/simulate
POST /v1/tenants/:tenantId/entities/:entityId/metadata/simulate
POST /v1/tenants/:tenantId/entities/:entityId/links/simulate
POST /v1/tenants/:tenantId/entities/:entityId/links/status/simulate
POST /v1/tenants/:tenantId/entities/:entityId/close/simulate
```

Each route requires an organization-bound `chain:write` token and selects the
live role that grants the corresponding fixed capability:

```text
ENTITY_CREATE    = 0
TRACE_RECORD     = 1
STATE_UPDATE     = 2
METADATA_UPDATE  = 3
ENTITY_LINK      = 5
ENTITY_CLOSE     = 6
```

All routes verify chain ID, exact deployed runtime bytecode hash, tenant and
organization status, tenant membership, signer wallet binding, and live
capability authorization before exact contract simulation and gas estimation.

Entity mutation simulations require an existing open entity. Entity creation
requires the requested entity ID to be absent. Link simulations require both
source and target entities to exist and remain open. Close simulation also
requires no pending custody transfer.

These routes never sign or broadcast transactions. Controlled broadcast support
for generic operations is intentionally deferred to a later milestone.
