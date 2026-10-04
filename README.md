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
