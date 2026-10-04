# TraceForge public provenance v1

TraceForge keeps public provenance beside the contract deployment under:

```text
contracts/deployments/<chainId>/operations/
```

`schemaVersion: 1` is the public provenance format currently used by the
development network. Provenance is a verification artifact, not a secret store.

## Provenance families

Two schema families are currently versioned.

### Custody operation provenance

Schema:

```text
api/schemas/custody-operation-provenance.schema.json
```

Custody transfer is a two-stage workflow and therefore permits an incomplete
proposal-only document as well as a completed proposal + acceptance document.

### Generic operation provenance

Schema:

```text
api/schemas/generic-operation-provenance.schema.json
```

Generic provenance represents one completed non-custody immutable write. The v1
operation names are:

```text
createEntity
recordTrace
updateEntityState
updateEntityMetadata
createEntityLink
setEntityLinkActive
closeEntity
```

A completed generic provenance document records the network and exact contract
runtime hash, authenticated organization/signer/role, operation inputs, API
idempotency journal identifiers, transaction receipt, canonical indexed event
or events, and post-write verification.

Generic provenance filenames contain `-generic-`. This makes default validation
fail closed for malformed generic proof files instead of silently treating them
as another operation artifact.

## Secret boundary

Public provenance MUST NOT contain:

```text
privateKey
private_key
serializedTransaction
serialized_transaction
token
apiToken
api_token
bearerToken
bearer_token
password
mysqlPassword
mysql_password
secret
mnemonic
seedPhrase
seed_phrase
```

A boolean such as `serializedTransactionCleared: true` is public verification
state and is allowed. The serialized signed transaction itself is not.

API bearer tokens, private keys, MySQL credentials, and signer-map secret paths
remain local runtime material.

## Validation

Run both provenance families:

```bash
npm run provenance:validate
```

Run only generic provenance:

```bash
npm run provenance:validate:generic
```

Exercise validator positive and negative cases:

```bash
npm run verify:provenance-schema
```

Generic validation also enforces operation-specific expected indexed events.
For example, `recordTrace` requires `TraceRecorded`; `createEntity` requires
`EntityCreated`; and `closeEntity` requires both `EntityClosed` and
`TraceRecorded`.

The validator checks reconciliation counters (`resolved + unresolved = total`)
and key post-write invariants. `recordTrace` v1 provenance must explicitly prove
that state, metadata, and custody remained unchanged and that the entity
remained open.
