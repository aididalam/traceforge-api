# TraceForge API

The API connects business accounts and opt-in public product tracking to the TraceForge contract and MySQL read model.

This repository is the `api/` submodule of [TraceForge](https://github.com/aididalam/traceforge). The parent lists all components and deployment instructions.

## Run

Use Node.js 22.13+ and MySQL 8.4. Copy `.env.example` to `.env`, configure the deployed contract address/runtime hash, RPC and database credentials, then run:

```sh
npm ci
npm run api:migrate
npm run build
npm start
```

Apply indexer migrations first. Business writes require `TRACEFORGE_BROADCAST_ENABLED=true` and an owner-only `TRACEFORGE_BUSINESS_WALLET_DIRECTORY`. The repository default disables writes. Keys and credentials must never be committed.

## ERP connectors and queued checkout

The integration API accepts existing product codes and 1–100 create/receive/remove
operations per durable job. Business accounts create scoped, expiring/revocable
keys through `/operator/v1/integration-keys`; ERP servers use those keys on
`/integration/v1`. Submit to `POST /integration/v1/jobs`, then poll
`GET /integration/v1/jobs/:jobId` for per-item confirmation. The API acknowledges
the database record before blockchain work; successful lines remain confirmed
if another line fails. Whole-request/item retries are idempotent across jobs.

Apply migration 011, build, and run `npm run erp:worker` alongside the API and
existing indexer/publication refresh. The worker preserves order per business,
frozen versions/payloads and the existing nonce lock/write journal. It recovers
expired leases and uncertain writes after process restarts. Scanning/search are
read-only and retain private-product boundaries. Run `npm run test:erp-input` and
the existing disposable `test:direct-claim` harness for actual HTTP/MySQL/chain
and worker recovery acceptance. See the parent's
[ERP setup, payloads and delivery rules](https://github.com/aididalam/traceforge/blob/main/docs/erp-integration.md).

`npm run demo:erp -- --broadcast` explicitly creates three dedicated live demo
products, receives them at the demo shop and submits one queued checkout. It
keeps resumable credentials in an owner-only local file and refuses to repeat
a completed deployment's demonstration. `npm run verify:live-erp` checks the
saved receipt set and current chain/SQL stock without creating new operations.
Existing `verify:live-batch` continues checking its original demo receipts even
when additional ERP operations have been recorded.

## Product ID and batch API (Phase 3)

The quantity upgrade is implemented, tested and activated on Pi. The local API
uses contract `0xf286a8f7bbbe4e5f2337e1701524368794de5672` and the fresh
`traceforge_batch_20261006` database. Indexer migrations 001–006 and API
migrations 001–010 are applied. See the parent's
[Phase 6 activation](https://github.com/aididalam/traceforge/blob/main/docs/batch-activation-phase6.md).
For a new environment, apply indexer migration 006 before API migration 010.

- Signup accepts a descriptive `businessType` and optional available `businessCode`.
  Automatic codes use A–Z and 0–9, starting at one character and increasing as
  combinations fill. `/operator/v1/me` includes the reserved code. This code is
  a database convenience for printed references and conveys no blockchain permission.
- `POST /operator/v1/products/create` requires `name`, `id`, `publish` and
  `idempotencyKey`. Optional `quantity` defaults to 1; greater values register
  batches. Counts are positive JSON safe integers. Optional `fields` supply
  additional label/value details; reserved ID/quantity labels cannot be overridden.
  Normalized registration JSON contains `schemaVersion: 2`, `name`, `id`,
  initial `quantity` and `fields`. The original reference/hash remain fixed.
- A confirmed registration returns a globally unique full Tracking ID and a
  reserved 12-character `shortCode`, including for private registrations and
  before projection finishes. Public resolution remains publication gated.
- `GET /operator/v1/products/search?id=...&businessCode=...&after=...&limit=...`
  returns exact, case-sensitive external-ID matches. Duplicate references are
  permitted. Results include shared products and records the caller created or
  handled. The optional code filter identifies the originating business.
- `GET /operator/v1/receive/:trackingId` resolves full/short codes without writing.
  A batch preview includes the first page of available routes and global counts;
  a private preview omits its product name, external ID and metadata fields.
- `GET /operator/v1/products/:productId/routes` and `/holders` paginate active
  paths and aggregated current holders. Source/parent IDs, consented names,
  receipt times, quantities and versions distinguish repeated receipts.
- `POST /operator/v1/products/:productId/receive` requires confirmation, version
  and an idempotency key. Batches also require `sourceRouteId` and `quantity`.
  Each batch receipt creates a distinct child path and debits the source; it
  never changes the global available count. No sender proposal, producer
  membership or receiving-role approval is required.
- `POST /operator/v1/products/:productId/remove` requires confirmation, version
  and an idempotency key. Batches also require `routeId` and `quantity`.
  Only that path's holder can remove its available items. Reason defaults to
  `Sold`; `Lost`, `Damaged`, `Spoiled`, `Disposed` and `Other` require `reasonText`.
  The text is stored on chain (256 Unicode characters / 1024 UTF-8 bytes maximum).
  Singles remove one item. `/close` remains a compatibility alias; newly
  registered singles also require their current version and the new reason rules.
- `/products` reports cross-producer inventory and the caller's available count.
  `/products/:productId/history` reports one dated operation per registration,
  receipt or removal. Raw paired logs remain intact for audit.

Writes preserve simulation, wallet locking, journal-before-broadcast, exact-payload
idempotency and mined-receipt verification. Source versions prevent stale and
competing receipts/removals from overdrawing stock. Read counts, timestamps and
versions are decimal strings. Pagination defaults to 50 and allows at most 100;
global/own totals are computed across all paths, independently of the page.

Public quantity/search paths:

| Route | Response |
| --- | --- |
| `/public/v1/products/search?id=...&businessCode=...&after=...&limit=...` | Shared external-ID matches, origin attribution and availability |
| `/public/v1/products/:trackingId/quantity` | Original ID, initial/available/removed counts, classification and six reason totals |
| `/public/v1/products/:trackingId/routes?after=...&limit=...` | Available receipt routes, parent/owner attribution and versions |
| `/public/v1/products/:trackingId/holders?after=...&limit=...` | Per-business available stock across its paths |

These routes require explicit product publication, enforce fixed response fields
and return no private documents, actor wallets, evidence bodies or credentials.
Existing tenant/entity detail/history routes include quantity summaries and
quantity movements for registered products, while retaining legacy record shapes.
Public history names use the businesses' current sharing consent and can span
more than 32 participants. Optional staff invitations remain email-bound.

The migration runner automatically reserves missing codes for existing business
accounts and preserves existing/custom reservations. To repeat that backfill:

```sh
npm run business:codes:backfill
```

## Public tracking

`/public/v1/tracking/:trackingId`, `/public/v1/short-links/:shortCode`, and `/public/v1/tenants/:tenantId/entities/:entityId[/history]` expose only explicitly shared products. Full IDs and short codes keep their binding when a product is unpublished. `npm run public:sync` updates opted-in display snapshots after indexing and respects explicit unpublishing.

## Verification

```sh
npm run typecheck
npm run verify:production-build
npm run verify:security-hardening
npm run verify:token-expiry
npm run verify:public-discovery
npm run verify:public-tracking
npm run verify:public-presentation
npm run verify:public-short-links
npm run verify:operator-dashboard
npm run verify:product-input
npm run verify:public-products
npm run verify:provenance-schema
```

`npm run test:direct-claim` requires the isolated Hardhat integration network on loopback port 18545. It creates and drops its own temporary database/wallet directory and verifies actual migrations, signup/custom codes, single and batch receipts/removals, multi-producer inventory, concurrent claims/codes, retries, privacy, logical history, rebuilds and rollback. It also runs the existing dashboard/public-history SQL integration checks. It never targets Pi. Hosted CI runs this test with disposable MySQL.

Set `TRACEFORGE_TEST_UI=true` to also start an owned Next.js server on port 13478
and run unmocked desktop/mobile browser acceptance against this API and chain.
Install Chromium with `cd ../ui && npx playwright install chromium` first.
Build all three applications before running. When preserving running development
builds, use `TRACEFORGE_TEST_API_DIST=dist-phase5`,
`TRACEFORGE_TEST_INDEXER_DIST=dist-phase5` and
`TRACEFORGE_UI_DIST_DIR=.next-phase5` with separately compiled output directories.
The test control server is loopback-only and authenticated with an ephemeral
test secret; it is not part of the production API. Test manifests contain only
synthetic identities, expire with the test, and never contain server session
tokens, signer keys or database passwords. See
[Phase 5 verification](https://github.com/aididalam/traceforge/blob/main/docs/batch-integration-phase5.md).

`npm run test:acceptance` checks a running API without writing. `npm run verify:mysql-backup-restore` exercises database backup/restore separately. Synthetic generic provenance fixtures retain schema/secret-boundary coverage without referring to retired chain deployments.

`npm run verify:live-batch` performs read-only comparisons of the checked-in Pi
demo receipt with contract balances/reasons, MySQL projections, short links,
publication boundaries and confirmed journals. It expects the unchanged demo
stock; manually receiving/removing demo products changes those expectations.
`npm run demo:batch -- --broadcast` explicitly seeds an unseeded deployment;
it refuses to repeat the recorded demo on the current contract. It reads demo
credentials from the owner-only `~/.traceforge/secrets/batch-demo-accounts.json`
(override with `TRACEFORGE_DEMO_ACCOUNTS_FILE`) and saves nonsecret demo identifiers
and receipt proofs in the contracts submodule. Keys/passwords remain outside Git.

For development verification while the legacy services continue running, compile
both API and indexer with `tsc --outDir dist-phase3`, then run:

```sh
TRACEFORGE_TEST_API_DIST=dist-phase3 TRACEFORGE_TEST_INDEXER_DIST=dist-phase3 npm run test:direct-claim
```

The harness respects production rate limits and removes only its own temporary
database and wallet directory. It deploys the compiled contract to localhost
port 18545 and starts an isolated API on port 13301. A stale concurrent operation
may be rejected before broadcast or recorded as a reverted transaction; either
case leaves exactly one successful receipt and conserved stock.
