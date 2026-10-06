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

## Independent business flow

- `POST /operator/v1/signup`: independently register a business and its own production workspace; no invitation required.
- `POST /operator/v1/login`: email/password login; hashed expiring API sessions.
- `POST /operator/v1/products/create`: add a product with an explicit public sharing choice.
- `GET /operator/v1/receive/:trackingId`: scan preview for a full ID or short code; never changes custody.
- `POST /operator/v1/products/:productId/receive`: receiver confirms physical receipt; expected custody version rejects stale claims.
- `POST /operator/v1/products/:productId/close`: current holder ends tracking with Sold/Lost/Damaged/Disposed.
- `GET /operator/v1/products`: products the signed-in business produced or handled, across producers.
- `GET /operator/v1/products/:productId/history`: named, dated supply history.
- `GET /operator/v1/businesses` and `/operations`: business directory and actor-scoped operation status.

Receiving and closing consult global active business identity. Production workspace roles still protect creating and editing products. Optional staff activation uses an email-bound invitation. Public trace publication, business-name consent and private-document omission remain explicit.

Signup accepts any `businessType` as nonblank text up to 120 characters, including
custom types and Unicode. Suggested types in the UI are optional. The type is
stored in business metadata and describes the business; it is not an allowlist
of supply-chain participants or a receiving permission. Existing types remain
compatible. Control characters and non-string input are rejected.

All writes require an idempotency key in the validated body. The signed transaction is journaled before broadcast; retries reuse it. A per-wallet database lock protects nonce allocation. Receipt events verify actor, product, evidence and custody version. Browser requests use fixed Next.js routes with origin validation and HttpOnly cookies; server wallet keys never reach the browser.

Generic `/v1/*` token-scoped read/production APIs remain available. `CUSTODY_CLAIM` and `ENTITY_CLOSE` preflight use global business identity. There are no proposal, acceptance, cancellation or pending-custody endpoints.

Product creation accepts an optional `fields` array of `{ label, value }` text
pairs (maximum 32, unique names up to 80 characters, values up to 1,000).
Custom fields are stored inside the product metadata JSON and included in its
on-chain hash. Operator details resolve the fields from the hash-bound document;
public display copies them only for an explicitly shared product. A missing or
empty array keeps compatibility with existing name/description-only products.
Legacy Units/Packaging/Quality/Revision fields remain readable. Dynamic values
are displayed as plain text, preserving their capitalization and contents.

The generated contract ABI includes the 2026-10-06 quantity/route operations.
The [batch upgrade](https://github.com/aididalam/traceforge/blob/main/docs/batch-quantity-plan.md)
is being delivered in phases: contract accounting is implemented, while required
external-ID validation, quantity HTTP workflows, route/search responses and DB
migrations are the next phase. These HTTP endpoints still use the existing
whole-product flow until that implementation and deployment are complete.

Operator and public product histories show one business action per receive or
removal. The contract emits a matching TraceRecorded log immediately after the
action event. A shared SQL predicate excludes only that exact companion before
LIMIT/cursor pagination, matching chain, contract, transaction, adjacent log,
product, workspace, event type, evidence, actor, business and time. Separate
updates in the same transaction stay visible. All indexed raw logs and generic
technical discovery responses remain unchanged.

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
npm run verify:provenance-schema
```

`npm run test:direct-claim` requires the isolated Hardhat integration network on loopback port 18545. It creates and drops its own temporary database/wallet directory and verifies signup, multi-producer inventory, real signed claims, closure, retries, privacy and projections. It never targets Pi. Hosted CI runs this test with disposable MySQL.

`npm run test:acceptance` checks a running API without writing. `npm run verify:mysql-backup-restore` exercises database backup/restore separately. Synthetic generic provenance fixtures retain schema/secret-boundary coverage without referring to retired chain deployments.
