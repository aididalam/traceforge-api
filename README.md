# TraceForge API

Part of [TraceForge](https://github.com/aididalam/traceforge). See the parent repository for Docker setup and deployment.

Connects business accounts, public product tracking and ERP/POS systems to TraceForge.
Validates operations, submits blockchain transactions and serves MySQL projections.
A durable worker processes bulk ERP operations with retries and idempotency.

## API reference

[API.md](API.md) lists every application endpoint, authentication requirements,
HTTP methods, request examples and response examples. A running API also serves
Swagger at `/docs` and OpenAPI JSON at `/docs/json` on its private listener.

## Run separately

Use Node.js 22.13+ and MySQL 8.4. Copy `.env.example` to `.env` and configure the
private RPC, deployed contract identity and database credentials. Apply the
indexer's migrations before the API migrations, then:

```bash
npm ci
npm run api:migrate
npm run build
npm start
```

Run `npm run erp:worker` and `npm run public:sync` alongside the indexer for ERP
jobs and shared tracking updates. Business writes require
`TRACEFORGE_BROADCAST_ENABLED=true` and a private business wallet directory;
the standalone API defaults to writes disabled. Docker Compose manages these
services and migrations automatically.

## License

Licensed under the [MIT License](LICENSE), as part of TraceForge.
Third-party dependencies retain their own licenses.
