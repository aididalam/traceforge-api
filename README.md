# TraceForge API

HTTP API for the TraceForge indexed MySQL read model.

## Development

```bash
cp .env.example .env
npm install
npm run typecheck
npm run dev
```

The API reads from the TraceForge MySQL read model. It does not submit blockchain transactions.

## Initial endpoints

- `GET /health`
- `GET /ready`
- `GET /v1/tenants/:tenantId/entities/:entityId`
- `GET /v1/tenants/:tenantId/entities/:entityId/history`
