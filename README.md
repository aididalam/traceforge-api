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
