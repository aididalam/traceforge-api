# TraceForge API reference

Part of [TraceForge](https://github.com/aididalam/traceforge). See [README.md](README.md) for standalone setup.

All application endpoints are listed below. JSON values are illustrative and use
synthetic IDs/credentials; replace them with your installation’s actual values.
Response examples show complete common shapes except where explicitly marked
as selected fields. GET requests have no body. POST bodies use
`Content-Type: application/json`. Paths use `{parameter}` placeholders.

The standalone API listens on `http://127.0.0.1:3000` by default. With Docker
Compose the API listener is private: the public proxy exposes `/integration/v1/*`
and the optional network bootstrap route directly; the UI calls business and
public APIs through its server-side gateway.

## Authentication and data formats

| API | Authorization |
| --- | --- |
| `/health`, `/ready`, `/public/v1/*`, signup/login/activate | No token |
| Other `/operator/v1/*` | `Authorization: Bearer <sessionToken>` from login |
| `/integration/v1/*` | `Authorization: Bearer <ERP key secret>` |
| `/v1/*` | Workspace API token; reads require `tenant:read`, writes require `chain:write` |
| `/network/v1/bootstrap` | Dedicated 64-character deployment bootstrap token |

Operator sessions expire after 30 minutes. These credentials are separate.
ERP keys are created by a signed-in business;
workspace tokens are issued by an installation operator (`npm run token:issue`).
Never send wallet private keys or tokens in URLs. The browser UI stores its
session through its own gateway; ERP connectors should use scoped ERP keys.

Business create/receive/remove writes use an `idempotencyKey` in the JSON body.
Generic broadcasts use the `Idempotency-Key` header. Retry with the same key and
unchanged data; changed payloads with the same key conflict. A write can return
`BROADCAST` before its receipt is confirmed; only `CONFIRMED` is final success.
Indexed searches/history can lag confirmed transactions briefly.

Read quantities, versions, event IDs and block numbers are decimal strings;
write quantities are positive JSON safe integers (maximum 9007199254740991).
Pagination normally uses `after` and `page.next`, with limit 1–100 (default 50).
Holder cursors are business IDs. Workspace/public entity history uses
`afterEventId` and `page.nextAfterEventId` instead.

Common failures use the following envelope (some legacy preflight failures
contain only a code):

```json
{"error":{"code":"authentication_required","message":"Sign in to continue."}}
```

Typical status codes: 400 invalid input, 401 authentication, 403 insufficient
access, 404 missing/unpublished record, 409 stale version or conflicting request,
429 rate limit and 503 dependency unavailable. The usual budget is 120 requests
per minute; signup/login have stricter limits. Retry 429 according to Retry-After.

## Endpoint index

- [Health and readiness](#health-and-readiness) — 2 endpoints
- [Business accounts](#business-accounts) — 5 endpoints
- [Business products and activity](#business-products-and-activity) — 12 endpoints
- [ERP and POS integration](#erp-and-pos-integration) — 10 endpoints
- [Public product tracking](#public-product-tracking) — 8 endpoints
- [Private workspace reads](#private-workspace-reads) — 7 endpoints
- [Generic contract writes](#generic-contract-writes) — 15 endpoints
- [Network bootstrap](#network-bootstrap) — 1 endpoint

## Health and readiness

### GET /health

Request example:

```http
GET /health
```

Response example (`200`):

```json
{
  "service": "traceforge-api",
  "status": "ok"
}
```

### GET /ready

Returns 503 when dependencies are unavailable. Docker deployments also check blockchain identity and advancing blocks.

Request example:

```http
GET /ready
```

Response example (`200`):

```json
{
  "database": "ok",
  "status": "ready"
}
```

## Business accounts

### POST /operator/v1/signup

Registers an independent business. Any descriptive business type is accepted; optional businessCode reserves an available custom code. Passwords need 12–128 characters. A pending blockchain registration can return created=false, pending=true; retry with the same account details.

On a public EVM network, a new server-managed business wallet needs native gas
funds. The pending response can include the address to fund:

```json
{
  "created": false,
  "pending": true,
  "businessCode": "A",
  "funding": {
    "walletAddress": "0x1111111111111111111111111111111111111111",
    "symbol": "POL"
  }
}
```

Fund that address on the configured network and retry the same signup details.
Public writes stay pending until their canonical transaction block is finalized.
`insufficient_gas_balance`, `fee_limit_exceeded`, `transaction_pending` and
`finality_unavailable` describe funding, configured fee caps and network waits;
retry an existing operation with its original idempotency key. ERP jobs retry
these conditions with backoff.

Request example:

```http
POST /operator/v1/signup
Content-Type: application/json
```

```json
{
  "email": "operator@example.com",
  "password": "ExamplePassword123!",
  "name": "Sample Operator",
  "businessName": "Sample Business",
  "businessType": "Repair workshop",
  "publicProfile": true
}
```

Response example (`200`):

```json
{
  "created": true,
  "pending": false,
  "businessCode": "A"
}
```

### POST /operator/v1/login

Request example:

```http
POST /operator/v1/login
Content-Type: application/json
```

```json
{
  "email": "operator@example.com",
  "password": "ExamplePassword123!"
}
```

Response example (`200`):

```json
{
  "sessionToken": "tfos_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "expiresAt": "2026-10-09T06:30:00.000Z",
  "user": {
    "accountId": "11111111-1111-4111-8111-111111111111",
    "email": "operator@example.com",
    "name": "Sample Operator",
    "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "organizationId": "0x3333333333333333333333333333333333333333333333333333333333333333",
    "workspaceName": "Sample Business",
    "organizationName": "Sample Business",
    "businessCode": "A",
    "access": "manage"
  }
}
```

### POST /operator/v1/activate

Optional email-bound staff invitation activation. Independent businesses use signup and do not need an invitation.

Request example:

```http
POST /operator/v1/activate
Content-Type: application/json
```

```json
{
  "email": "staff@example.com",
  "password": "ExamplePassword123!",
  "name": "Sample Staff",
  "invitationCode": "tfoi_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

Response example (`200`):

```json
{
  "created": true
}
```

### GET /operator/v1/me

Request example:

```http
GET /operator/v1/me
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "user": {
    "accountId": "11111111-1111-4111-8111-111111111111",
    "email": "operator@example.com",
    "name": "Sample Operator",
    "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "organizationId": "0x3333333333333333333333333333333333333333333333333333333333333333",
    "workspaceName": "Sample Business",
    "organizationName": "Sample Business",
    "businessCode": "A",
    "access": "manage"
  }
}
```

### POST /operator/v1/logout

Request example:

```http
POST /operator/v1/logout
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "signedOut": true
}
```

## Business products and activity

### POST /operator/v1/products/create

name, id, publish and idempotencyKey are required. quantity defaults to 1; greater than 1 registers a batch. Up to 32 unique label/value fields are accepted. description remains an optional compatibility field. Confirmed registration reserves both full and short tracking IDs, including for private products.

Request example:

```http
POST /operator/v1/products/create
Authorization: Bearer <sessionToken>
Content-Type: application/json
```

```json
{
  "name": "Cola batch",
  "id": "A/BATCH-001",
  "quantity": 100,
  "fields": [
    {
      "label": "Expiry date",
      "value": "2027-10-01"
    }
  ],
  "publish": true,
  "idempotencyKey": "register_batch_001"
}
```

Response example (`200`):

```json
{
  "operationId": "11111111-1111-4111-8111-111111111111",
  "status": "CONFIRMED",
  "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
  "blockNumber": "120",
  "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "shortCode": "0123456789ab"
}
```

### GET /operator/v1/receive/{trackingId}

Accepts a full Tracking ID or 12-character short code. For a single item, holder and version are populated; batches use routes and each route version. Private product details are omitted. This lookup does not transfer stock.

Request example:

```http
GET /operator/v1/receive/{trackingId}
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "name": "Cola batch",
  "holder": null,
  "closed": false,
  "version": null,
  "canReceive": true,
  "quantity": {
    "externalId": "A/BATCH-001",
    "initialQuantity": "100",
    "availableQuantity": "98",
    "removedQuantity": "2",
    "isBatch": true,
    "inSupplyChain": true,
    "reasons": [
      {
        "reason": "Sold",
        "quantity": "2"
      },
      {
        "reason": "Lost",
        "quantity": "0"
      },
      {
        "reason": "Damaged",
        "quantity": "0"
      },
      {
        "reason": "Spoiled",
        "quantity": "0"
      },
      {
        "reason": "Disposed",
        "quantity": "0"
      },
      {
        "reason": "Other",
        "quantity": "0"
      }
    ],
    "ownAvailableQuantity": "0"
  },
  "routes": [
    {
      "id": "0x4444444444444444444444444444444444444444444444444444444444444444",
      "parentRouteId": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "owner": {
        "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
        "name": "Sample Business"
      },
      "previousOwner": null,
      "receivedQuantity": "100",
      "availableQuantity": "98",
      "version": "1",
      "receivedAt": "1791525600"
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### POST /operator/v1/products/{productId}/receive

Batch receipt requires sourceRouteId, quantity and the current source version. For a single item omit sourceRouteId/quantity and use the lookup version. confirmed=true declares physical handover; no sender proposal is required.

Request example:

```http
POST /operator/v1/products/{productId}/receive
Authorization: Bearer <sessionToken>
Content-Type: application/json
```

```json
{
  "sourceRouteId": "0x4444444444444444444444444444444444444444444444444444444444444444",
  "quantity": 10,
  "version": "1",
  "confirmed": true,
  "idempotencyKey": "receive_batch_001"
}
```

Response example (`200`):

```json
{
  "operationId": "11111111-1111-4111-8111-111111111111",
  "status": "CONFIRMED",
  "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
  "blockNumber": "120",
  "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "receivedRouteId": "0x8888888888888888888888888888888888888888888888888888888888888888",
  "quantity": "10"
}
```

### POST /operator/v1/products/{productId}/remove

Only the current holder can remove its stock. Batch removals need routeId, quantity and the current route version. Singles use quantity=1 and the current custody version. Sold is the default reason; Lost, Damaged, Spoiled, Disposed and Other require reasonText (up to 256 characters). Remaining stock keeps the product in the supply chain.

Request example:

```http
POST /operator/v1/products/{productId}/remove
Authorization: Bearer <sessionToken>
Content-Type: application/json
```

```json
{
  "routeId": "0x4444444444444444444444444444444444444444444444444444444444444444",
  "quantity": 2,
  "version": "1",
  "reason": "Sold",
  "confirmed": true,
  "idempotencyKey": "remove_batch_001"
}
```

Response example (`200`):

```json
{
  "operationId": "11111111-1111-4111-8111-111111111111",
  "status": "CONFIRMED",
  "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
  "blockNumber": "120",
  "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "removedQuantity": "2",
  "reason": "Sold",
  "reasonText": ""
}
```

### POST /operator/v1/products/{productId}/close

Compatibility alias for remove. Only the current holder can remove its stock. Batch removals need routeId, quantity and the current route version. Singles use quantity=1 and the current custody version. Sold is the default reason; Lost, Damaged, Spoiled, Disposed and Other require reasonText (up to 256 characters). Remaining stock keeps the product in the supply chain.

Request example:

```http
POST /operator/v1/products/{productId}/close
Authorization: Bearer <sessionToken>
Content-Type: application/json
```

```json
{
  "routeId": "0x4444444444444444444444444444444444444444444444444444444444444444",
  "quantity": 2,
  "version": "1",
  "reason": "Sold",
  "confirmed": true,
  "idempotencyKey": "remove_batch_001"
}
```

Response example (`200`):

```json
{
  "operationId": "11111111-1111-4111-8111-111111111111",
  "status": "CONFIRMED",
  "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
  "blockNumber": "120",
  "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "removedQuantity": "2",
  "reason": "Sold",
  "reasonText": ""
}
```

### GET /operator/v1/products/search

Exact, case-sensitive printed ID lookup. Duplicate IDs may produce multiple products. Includes published products and private products this business has handled.

Request example:

```http
GET /operator/v1/products/search?id=A%2FBATCH-001&businessCode=A&limit=50
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "products": [
    {
      "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
      "shortCode": "0123456789ab",
      "name": "Cola batch",
      "externalId": "A/BATCH-001",
      "origin": {
        "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
        "name": "Sample Business",
        "businessCode": "A"
      },
      "isBatch": true,
      "initialQuantity": "100",
      "availableQuantity": "98",
      "inSupplyChain": true
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### GET /operator/v1/products/{productId}/routes

Returns available batch routes with owners, ancestry, quantities and versions. Single items have no batch routes.

Request example:

```http
GET /operator/v1/products/{productId}/routes?after=0&limit=50
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "routes": [
    {
      "id": "0x4444444444444444444444444444444444444444444444444444444444444444",
      "parentRouteId": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "owner": {
        "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
        "name": "Sample Business"
      },
      "previousOwner": null,
      "receivedQuantity": "100",
      "availableQuantity": "98",
      "version": "1",
      "receivedAt": "1791525600"
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### GET /operator/v1/products/{productId}/holders

Aggregates available stock by business. The after cursor is a full business ID, not an event number.

Request example:

```http
GET /operator/v1/products/{productId}/holders?limit=50
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "holders": [
    {
      "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
      "name": "Sample Business",
      "availableQuantity": "98",
      "routeCount": 1
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### GET /operator/v1/products

Inventory across products this business created, received or handled; quantity includes ownAvailableQuantity.

Request example:

```http
GET /operator/v1/products?after=0&limit=50
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "products": [
    {
      "id": "0x2222222222222222222222222222222222222222222222222222222222222222",
      "name": "Cola batch",
      "description": null,
      "type": "Product",
      "status": null,
      "closed": false,
      "createdAt": "1791525600",
      "holder": null,
      "quantity": {
        "externalId": "A/BATCH-001",
        "initialQuantity": "100",
        "availableQuantity": "98",
        "removedQuantity": "2",
        "isBatch": true,
        "inSupplyChain": true,
        "reasons": [
          {
            "reason": "Sold",
            "quantity": "2"
          },
          {
            "reason": "Lost",
            "quantity": "0"
          },
          {
            "reason": "Damaged",
            "quantity": "0"
          },
          {
            "reason": "Spoiled",
            "quantity": "0"
          },
          {
            "reason": "Disposed",
            "quantity": "0"
          },
          {
            "reason": "Other",
            "quantity": "0"
          }
        ],
        "ownAvailableQuantity": "98"
      },
      "fields": [
        {
          "label": "Expiry date",
          "value": "2027-10-01"
        }
      ]
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### GET /operator/v1/products/{productId}/history

Returns one logical supply-chain event per registration, receipt or removal.

Request example:

```http
GET /operator/v1/products/{productId}/history?after=0&limit=50
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "product": {
    "id": "0x2222222222222222222222222222222222222222222222222222222222222222",
    "name": "Cola batch",
    "description": null,
    "type": "Product",
    "status": null,
    "closed": false,
    "createdAt": "1791525600",
    "holder": null,
    "quantity": {
      "externalId": "A/BATCH-001",
      "initialQuantity": "100",
      "availableQuantity": "98",
      "removedQuantity": "2",
      "isBatch": true,
      "inSupplyChain": true,
      "reasons": [
        {
          "reason": "Sold",
          "quantity": "2"
        },
        {
          "reason": "Lost",
          "quantity": "0"
        },
        {
          "reason": "Damaged",
          "quantity": "0"
        },
        {
          "reason": "Spoiled",
          "quantity": "0"
        },
        {
          "reason": "Disposed",
          "quantity": "0"
        },
        {
          "reason": "Other",
          "quantity": "0"
        }
      ],
      "ownAvailableQuantity": "98"
    },
    "fields": [
      {
        "label": "Expiry date",
        "value": "2027-10-01"
      }
    ]
  },
  "events": [
    {
      "id": "120",
      "name": "ProductRegistered",
      "label": "Added to supply chain",
      "occurredAt": "2026-10-09T06:00:00.000Z",
      "organizationId": "0x3333333333333333333333333333333333333333333333333333333333333333",
      "fromId": null,
      "toId": null,
      "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
      "quantity": {
        "quantity": "100",
        "reason": null,
        "reasonText": null,
        "routeId": null,
        "receivedRouteId": null
      }
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### GET /operator/v1/businesses

Request example:

```http
GET /operator/v1/businesses
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "businesses": [
    {
      "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
      "name": "Sample Business",
      "type": "Repair workshop",
      "active": true
    }
  ],
  "truncated": false
}
```

### GET /operator/v1/operations

Recent blockchain write activity; excludes signed transactions and private request payloads.

Request example:

```http
GET /operator/v1/operations
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "operations": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "productId": "0x2222222222222222222222222222222222222222222222222222222222222222",
      "name": "createProduct",
      "status": "CONFIRMED",
      "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
      "blockNumber": "120",
      "createdAt": "2026-10-09T06:00:00.000Z",
      "updatedAt": "2026-10-09T06:00:00.000Z"
    }
  ],
  "truncated": false
}
```

## ERP and POS integration

Register/login normally, create an ERP key, match scanned barcodes through search,
then queue operations after the ERP confirms physical receipt or checkout. Run
the durable ERP worker alongside the API. Each job and each item has its own
idempotency key; the ERP continues using its existing inventory/payment flow.

### POST /operator/v1/integration-keys

Returns the secret once; store it in the ERP server. Supported scopes: products:read, products:create, products:receive, products:remove and jobs:read. Expiry is 1–365 days (default 365).

Request example:

```http
POST /operator/v1/integration-keys
Authorization: Bearer <sessionToken>
Content-Type: application/json
```

```json
{
  "name": "Shop POS",
  "scopes": [
    "products:read",
    "products:remove",
    "jobs:read"
  ],
  "expiresInDays": 365
}
```

Response example (`201`):

```json
{
  "key": {
    "id": "22222222-2222-4222-8222-222222222222",
    "name": "Shop POS",
    "prefix": "tferp_aaaaaaaa",
    "scopes": [
      "jobs:read",
      "products:read",
      "products:remove"
    ],
    "expiresAt": "2027-10-09T06:00:00.000Z",
    "revokedAt": null,
    "createdAt": "2026-10-09T06:00:00.000Z"
  },
  "secret": "tferp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

### GET /operator/v1/integration-keys

Request example:

```http
GET /operator/v1/integration-keys
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "keys": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "name": "Shop POS",
      "prefix": "tferp_aaaaaaaa",
      "scopes": [
        "jobs:read",
        "products:read",
        "products:remove"
      ],
      "expiresAt": "2027-10-09T06:00:00.000Z",
      "revokedAt": null,
      "createdAt": "2026-10-09T06:00:00.000Z"
    }
  ],
  "truncated": false
}
```

### POST /operator/v1/integration-keys/{keyId}/revoke

Revokes a key belonging to the signed-in business.

Request example:

```http
POST /operator/v1/integration-keys/{keyId}/revoke
Authorization: Bearer <sessionToken>
```

Response example (`200`):

```json
{
  "revoked": true
}
```

### GET /integration/v1/me

Request example:

```http
GET /integration/v1/me
Authorization: Bearer <ERP key secret>
```

Response example (`200`):

```json
{
  "keyId": "22222222-2222-4222-8222-222222222222",
  "organizationId": "0x3333333333333333333333333333333333333333333333333333333333333333",
  "scopes": [
    "jobs:read",
    "products:read",
    "products:remove"
  ]
}
```

### GET /integration/v1/scan

Requires products:read. Accepts a TraceForge short/full code or tracking URL. An existing company barcode ID must first be matched through products/search; scan does not resolve arbitrary external barcodes.

Request example:

```http
GET /integration/v1/scan?code=0123456789ab
Authorization: Bearer <ERP key secret>
```

Response example (`200`):

```json
{
  "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "name": "Cola batch",
  "holder": null,
  "closed": false,
  "version": null,
  "canReceive": true,
  "quantity": {
    "externalId": "A/BATCH-001",
    "initialQuantity": "100",
    "availableQuantity": "98",
    "removedQuantity": "2",
    "isBatch": true,
    "inSupplyChain": true,
    "reasons": [
      {
        "reason": "Sold",
        "quantity": "2"
      },
      {
        "reason": "Lost",
        "quantity": "0"
      },
      {
        "reason": "Damaged",
        "quantity": "0"
      },
      {
        "reason": "Spoiled",
        "quantity": "0"
      },
      {
        "reason": "Disposed",
        "quantity": "0"
      },
      {
        "reason": "Other",
        "quantity": "0"
      }
    ],
    "ownAvailableQuantity": "0"
  },
  "routes": [
    {
      "id": "0x4444444444444444444444444444444444444444444444444444444444444444",
      "parentRouteId": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "owner": {
        "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
        "name": "Sample Business"
      },
      "previousOwner": null,
      "receivedQuantity": "100",
      "availableQuantity": "98",
      "version": "1",
      "receivedAt": "1791525600"
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### GET /integration/v1/products

Requires products:read; inventory belongs to the key’s business.

Request example:

```http
GET /integration/v1/products?after=0&limit=50
Authorization: Bearer <ERP key secret>
```

Response example (`200`):

```json
{
  "products": [
    {
      "id": "0x2222222222222222222222222222222222222222222222222222222222222222",
      "name": "Cola batch",
      "description": null,
      "type": "Product",
      "status": null,
      "closed": false,
      "createdAt": "1791525600",
      "holder": null,
      "quantity": {
        "externalId": "A/BATCH-001",
        "initialQuantity": "100",
        "availableQuantity": "98",
        "removedQuantity": "2",
        "isBatch": true,
        "inSupplyChain": true,
        "reasons": [
          {
            "reason": "Sold",
            "quantity": "2"
          },
          {
            "reason": "Lost",
            "quantity": "0"
          },
          {
            "reason": "Damaged",
            "quantity": "0"
          },
          {
            "reason": "Spoiled",
            "quantity": "0"
          },
          {
            "reason": "Disposed",
            "quantity": "0"
          },
          {
            "reason": "Other",
            "quantity": "0"
          }
        ],
        "ownAvailableQuantity": "98"
      },
      "fields": [
        {
          "label": "Expiry date",
          "value": "2027-10-01"
        }
      ]
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### GET /integration/v1/products/search

Requires products:read. Match the ERP’s existing barcode/batch ID to a TraceForge registration and select among duplicate results.

Request example:

```http
GET /integration/v1/products/search?id=A%2FBATCH-001&businessCode=A&limit=50
Authorization: Bearer <ERP key secret>
```

Response example (`200`):

```json
{
  "products": [
    {
      "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
      "shortCode": "0123456789ab",
      "name": "Cola batch",
      "externalId": "A/BATCH-001",
      "origin": {
        "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
        "name": "Sample Business",
        "businessCode": "A"
      },
      "isBatch": true,
      "initialQuantity": "100",
      "availableQuantity": "98",
      "inSupplyChain": true
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### GET /integration/v1/products/{trackingId}/routes

Requires products:read. Fetch available batch sources and current versions before queuing operations.

Request example:

```http
GET /integration/v1/products/{trackingId}/routes?after=0&limit=50
Authorization: Bearer <ERP key secret>
```

Response example (`200`):

```json
{
  "routes": [
    {
      "id": "0x4444444444444444444444444444444444444444444444444444444444444444",
      "parentRouteId": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "owner": {
        "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
        "name": "Sample Business"
      },
      "previousOwner": null,
      "receivedQuantity": "100",
      "availableQuantity": "98",
      "version": "1",
      "receivedAt": "1791525600"
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### POST /integration/v1/jobs

Queues 1–100 create/receive/remove operations. Requires jobs:read plus each products:<action> scope. The job is durably stored before blockchain processing; 202 means queued, not confirmed. Reuse job/item keys only for identical retries. Different lines need different keys. Batch lines require their source/owned route; an optional version can be frozen by the worker when omitted.

Request example:

```http
POST /integration/v1/jobs
Authorization: Bearer <ERP key secret>
Content-Type: application/json
```

```json
{
  "idempotencyKey": "checkout_receipt_001",
  "reference": "RECEIPT-001",
  "occurredAt": "2026-10-09T06:00:00.000Z",
  "operations": [
    {
      "action": "remove",
      "idempotencyKey": "receipt_001_line_001",
      "productCode": "0123456789ab",
      "data": {
        "routeId": "0x4444444444444444444444444444444444444444444444444444444444444444",
        "quantity": 2,
        "version": "1",
        "reason": "Sold",
        "confirmed": true
      }
    }
  ]
}
```

Response example (`202`):

```json
{
  "jobId": "33333333-3333-4333-8333-333333333333",
  "status": "QUEUED",
  "reference": "RECEIPT-001",
  "occurredAt": "2026-10-09T06:00:00.000Z",
  "createdAt": "2026-10-09T06:00:00.000Z",
  "counts": {
    "total": 1,
    "confirmed": 0,
    "failed": 0,
    "cancelled": 0,
    "pending": 1
  },
  "items": [
    {
      "position": 1,
      "operationId": "11111111-1111-4111-8111-111111111111",
      "action": "remove",
      "status": "QUEUED",
      "attempts": 0,
      "error": null,
      "result": null
    }
  ]
}
```

### GET /integration/v1/jobs/{jobId}

Requires jobs:read. Poll until a terminal status: COMPLETED, PARTIAL_FAILURE, FAILED or CANCELLED. Confirmed lines remain confirmed when another line fails; inspect each item’s result/error.

Request example:

```http
GET /integration/v1/jobs/{jobId}
Authorization: Bearer <ERP key secret>
```

Response example (`200`):

```json
{
  "jobId": "33333333-3333-4333-8333-333333333333",
  "status": "COMPLETED",
  "reference": "RECEIPT-001",
  "occurredAt": "2026-10-09T06:00:00.000Z",
  "createdAt": "2026-10-09T06:00:00.000Z",
  "counts": {
    "total": 1,
    "confirmed": 1,
    "failed": 0,
    "cancelled": 0,
    "pending": 0
  },
  "items": [
    {
      "position": 1,
      "operationId": "11111111-1111-4111-8111-111111111111",
      "action": "remove",
      "status": "CONFIRMED",
      "attempts": 1,
      "error": null,
      "result": {
        "operationId": "11111111-1111-4111-8111-111111111111",
        "status": "CONFIRMED",
        "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
        "blockNumber": "120",
        "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
        "removedQuantity": "2",
        "reason": "Sold",
        "reasonText": ""
      }
    }
  ]
}
```

## Public product tracking

### GET /public/v1/tracking/{trackingId}

Resolves only an explicitly published full Tracking ID. Use the returned IDs to request product details/history.

Request example:

```http
GET /public/v1/tracking/{trackingId}
```

Response example (`200`):

```json
{
  "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222"
}
```

### GET /public/v1/short-links/{shortCode}

Resolves a published 12-character short code; mappings remain reserved when sharing is disabled.

Request example:

```http
GET /public/v1/short-links/{shortCode}
```

Response example (`200`):

```json
{
  "shortCode": "0123456789ab",
  "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222"
}
```

### GET /public/v1/products/search

Only explicitly published matches are included. Duplicate printed IDs can produce several results.

Request example:

```http
GET /public/v1/products/search?id=A%2FBATCH-001&businessCode=A&limit=50
```

Response example (`200`):

```json
{
  "products": [
    {
      "trackingId": "0x2222222222222222222222222222222222222222222222222222222222222222",
      "shortCode": "0123456789ab",
      "name": "Cola batch",
      "externalId": "A/BATCH-001",
      "origin": {
        "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
        "name": "Sample Business",
        "businessCode": "A"
      },
      "isBatch": true,
      "initialQuantity": "100",
      "availableQuantity": "98",
      "inSupplyChain": true
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### GET /public/v1/products/{trackingId}/quantity

Original registration quantity, current availability and removal totals; no per-item record is created for bulk removals.

Request example:

```http
GET /public/v1/products/{trackingId}/quantity
```

Response example (`200`):

```json
{
  "externalId": "A/BATCH-001",
  "initialQuantity": "100",
  "availableQuantity": "98",
  "removedQuantity": "2",
  "isBatch": true,
  "inSupplyChain": true,
  "reasons": [
    {
      "reason": "Sold",
      "quantity": "2"
    },
    {
      "reason": "Lost",
      "quantity": "0"
    },
    {
      "reason": "Damaged",
      "quantity": "0"
    },
    {
      "reason": "Spoiled",
      "quantity": "0"
    },
    {
      "reason": "Disposed",
      "quantity": "0"
    },
    {
      "reason": "Other",
      "quantity": "0"
    }
  ]
}
```

### GET /public/v1/products/{trackingId}/routes

Request example:

```http
GET /public/v1/products/{trackingId}/routes?after=0&limit=50
```

Response example (`200`):

```json
{
  "routes": [
    {
      "id": "0x4444444444444444444444444444444444444444444444444444444444444444",
      "parentRouteId": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "owner": {
        "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
        "name": "Sample Business"
      },
      "previousOwner": null,
      "receivedQuantity": "100",
      "availableQuantity": "98",
      "version": "1",
      "receivedAt": "1791525600"
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### GET /public/v1/products/{trackingId}/holders

The after cursor is the last business ID returned. Names follow current business sharing consent.

Request example:

```http
GET /public/v1/products/{trackingId}/holders?limit=50
```

Response example (`200`):

```json
{
  "holders": [
    {
      "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
      "name": "Sample Business",
      "availableQuantity": "98",
      "routeCount": 1
    }
  ],
  "page": {
    "hasMore": false,
    "next": null
  }
}
```

### GET /public/v1/tenants/{tenantId}/entities/{entityId}

Includes approved product metadata fields and quantity summaries. Private metadata documents and actor wallets are excluded.

Request example:

```http
GET /public/v1/tenants/{tenantId}/entities/{entityId}
```

Response example (`200`):

```json
{
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "entityType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "entityTypeLabel": "Product",
  "metadataHash": "0x5555555555555555555555555555555555555555555555555555555555555555",
  "currentState": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "currentStateLabel": null,
  "currentCustodian": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "closed": false,
  "createdAt": "1791525600",
  "closedAt": null,
  "productInfo": {
    "name": "Cola batch",
    "description": null,
    "fields": [
      {
        "label": "Expiry date",
        "value": "2027-10-01"
      }
    ]
  },
  "currentHolder": null,
  "quantity": {
    "externalId": "A/BATCH-001",
    "initialQuantity": "100",
    "availableQuantity": "98",
    "removedQuantity": "2",
    "isBatch": true,
    "inSupplyChain": true,
    "reasons": [
      {
        "reason": "Sold",
        "quantity": "2"
      },
      {
        "reason": "Lost",
        "quantity": "0"
      },
      {
        "reason": "Damaged",
        "quantity": "0"
      },
      {
        "reason": "Spoiled",
        "quantity": "0"
      },
      {
        "reason": "Disposed",
        "quantity": "0"
      },
      {
        "reason": "Other",
        "quantity": "0"
      }
    ]
  }
}
```

### GET /public/v1/tenants/{tenantId}/entities/{entityId}/history

Dated logical history in ascending event-ID order, with consented business names and quantity movements.

Request example:

```http
GET /public/v1/tenants/{tenantId}/entities/{entityId}/history?afterEventId=0&limit=50
```

Response example (`200`):

```json
{
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "entity": {
    "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
    "entityType": "0x9999999999999999999999999999999999999999999999999999999999999999",
    "entityTypeLabel": "Product",
    "metadataHash": "0x5555555555555555555555555555555555555555555555555555555555555555",
    "currentState": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "currentStateLabel": null,
    "currentCustodian": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "closed": false,
    "createdAt": "1791525600",
    "closedAt": null,
    "productInfo": {
      "name": "Cola batch",
      "description": null,
      "fields": [
        {
          "label": "Expiry date",
          "value": "2027-10-01"
        }
      ]
    },
    "currentHolder": null,
    "quantity": {
      "externalId": "A/BATCH-001",
      "initialQuantity": "100",
      "availableQuantity": "98",
      "removedQuantity": "2",
      "isBatch": true,
      "inSupplyChain": true,
      "reasons": [
        {
          "reason": "Sold",
          "quantity": "2"
        },
        {
          "reason": "Lost",
          "quantity": "0"
        },
        {
          "reason": "Damaged",
          "quantity": "0"
        },
        {
          "reason": "Spoiled",
          "quantity": "0"
        },
        {
          "reason": "Disposed",
          "quantity": "0"
        },
        {
          "reason": "Other",
          "quantity": "0"
        }
      ]
    }
  },
  "events": [
    {
      "eventId": "120",
      "eventName": "ProductRegistered",
      "blockNumber": "120",
      "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
      "transactionIndex": 0,
      "logIndex": 0,
      "eventType": null,
      "eventTypeLabel": null,
      "stateAfter": null,
      "stateAfterLabel": null,
      "linkType": null,
      "linkTypeLabel": null,
      "metadataHash": null,
      "evidenceHash": null,
      "occurredAt": "2026-10-09T06:00:00.000Z",
      "quantity": {
        "quantity": null,
        "initialQuantity": "100",
        "reason": null,
        "reasonText": null,
        "sourceRouteId": null,
        "receivedRouteId": null
      },
      "organization": {
        "id": "0x3333333333333333333333333333333333333333333333333333333333333333",
        "name": "Sample Business",
        "type": "Repair workshop"
      },
      "transfer": null
    }
  ],
  "page": {
    "limit": 50,
    "hasMore": false,
    "nextAfterEventId": null
  }
}
```

## Private workspace reads

### GET /v1/auth/me

Request example:

```http
GET /v1/auth/me
Authorization: Bearer <workspace API token>
```

Response example (`200`):

```json
{
  "tokenId": "11111111-1111-4111-8111-111111111111",
  "tokenName": "Private connector",
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "organizationId": "0x3333333333333333333333333333333333333333333333333333333333333333",
  "scopes": [
    "tenant:read",
    "chain:write"
  ]
}
```

### GET /v1/documents/{contentHash}

Requires tenant:read. Returns an imported document only when this token’s workspace can access it.

Request example:

```http
GET /v1/documents/{contentHash}
Authorization: Bearer <workspace API token>
```

Response example (`200`):

```json
{
  "contentHash": "0x5555555555555555555555555555555555555555555555555555555555555555",
  "documentKind": "entity",
  "sourceRef": "product.json",
  "byteLength": "128",
  "document": {
    "schemaVersion": 2,
    "name": "Cola batch",
    "id": "A/BATCH-001",
    "quantity": 100,
    "fields": [
      {
        "label": "Expiry date",
        "value": "2027-10-01"
      }
    ]
  },
  "importedAt": "2026-10-09T06:00:00.000Z"
}
```

### GET /v1/tenants/{tenantId}/entities/{entityId}

Requires tenant:read and the token’s workspace binding.

Request example:

```http
GET /v1/tenants/{tenantId}/entities/{entityId}
Authorization: Bearer <workspace API token>
```

Response example (`200`):

```json
{
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "entityType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "entityTypeLabel": "Product",
  "metadataHash": "0x5555555555555555555555555555555555555555555555555555555555555555",
  "currentState": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "currentStateLabel": null,
  "currentCustodian": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "closed": false,
  "createdAt": "1791525600",
  "closedAt": null,
  "metadata": {
    "schemaVersion": 2,
    "name": "Cola batch",
    "id": "A/BATCH-001",
    "quantity": 100,
    "fields": [
      {
        "label": "Expiry date",
        "value": "2027-10-01"
      }
    ]
  }
}
```

### GET /v1/tenants/{tenantId}/entities/{entityId}/history

Requires tenant:read. Raw indexed events can include accessible metadata/evidence; the example requests a cursor beyond the current history.

Request example:

```http
GET /v1/tenants/{tenantId}/entities/{entityId}/history?afterEventId=900000&limit=50
Authorization: Bearer <workspace API token>
```

Response example (`200`):

```json
{
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "entity": {
    "entityType": "0x9999999999999999999999999999999999999999999999999999999999999999",
    "entityTypeLabel": "Product",
    "metadataHash": "0x5555555555555555555555555555555555555555555555555555555555555555",
    "currentState": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "currentStateLabel": null,
    "currentCustodian": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "closed": false,
    "metadata": {
      "schemaVersion": 2,
      "name": "Cola batch",
      "id": "A/BATCH-001",
      "quantity": 100,
      "fields": [
        {
          "label": "Expiry date",
          "value": "2027-10-01"
        }
      ]
    }
  },
  "events": [],
  "page": {
    "limit": 50,
    "hasMore": false,
    "nextAfterEventId": null
  }
}
```

### GET /v1/tenants/{tenantId}/entities

Requires tenant:read; discovery is scoped to the token’s workspace. Continue with page.nextAfterEventId when hasMore=true.

Request example:

```http
GET /v1/tenants/{tenantId}/entities?afterEventId=900000&limit=50
Authorization: Bearer <workspace API token>
```

Response example (`200`):

```json
{
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entities": [],
  "page": {
    "limit": 50,
    "hasMore": false,
    "nextAfterEventId": null
  }
}
```

### GET /v1/tenants/{tenantId}/organizations

Requires tenant:read; discovery is scoped to the token’s workspace. Continue with page.nextAfterEventId when hasMore=true.

Request example:

```http
GET /v1/tenants/{tenantId}/organizations?afterEventId=900000&limit=50
Authorization: Bearer <workspace API token>
```

Response example (`200`):

```json
{
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "organizations": [],
  "page": {
    "limit": 50,
    "hasMore": false,
    "nextAfterEventId": null
  }
}
```

### GET /v1/tenants/{tenantId}/relationships

Requires tenant:read; discovery is scoped to the token’s workspace. Continue with page.nextAfterEventId when hasMore=true.

Request example:

```http
GET /v1/tenants/{tenantId}/relationships?afterEventId=900000&limit=50
Authorization: Bearer <workspace API token>
```

Response example (`200`):

```json
{
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "relationships": [],
  "page": {
    "limit": 50,
    "hasMore": false,
    "nextAfterEventId": null
  }
}
```

## Generic contract writes

These workspace-level routes support generic contract operations. For product
registration, direct receipt and batch accounting, use the business or ERP routes.
All routes here require a workspace token with chain:write and the correct live
organization/signer permissions. Simulation does not broadcast; broadcast needs
an explicit confirmation and idempotency header.

### GET /v1/auth/preflight

Requires chain:write and an organization-bound token. Optional entityId and requireCustody=true check a specific entity. Response shows selected checks; live role/signer permissions still control writes.

Request example:

```http
GET /v1/auth/preflight?capability=ENTITY_CREATE
Authorization: Bearer <workspace API token>
```

Response example (`200`):

```json
{
  "ready": true,
  "capability": "ENTITY_CREATE",
  "capabilityIndex": 0,
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "organizationId": "0x3333333333333333333333333333333333333333333333333333333333333333",
  "signerAddress": "0x7777777777777777777777777777777777777777",
  "authorizedRoleId": "0x4444444444444444444444444444444444444444444444444444444444444444",
  "checks": [
    {
      "name": "tenant_active",
      "ok": true
    }
  ],
  "entity": null
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/create/simulate

Checks permissions and estimates gas without submitting a transaction. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/create/simulate
Authorization: Bearer <workspace API token>
Content-Type: application/json
```

```json
{
  "entityType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "metadataHash": "0x5555555555555555555555555555555555555555555555555555555555555555",
  "initialState": "0x9999999999999999999999999999999999999999999999999999999999999999"
}
```

Response example (`200`):

```json
{
  "simulated": true,
  "broadcast": false,
  "operation": "createEntity",
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "estimatedGas": "150000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/traces/simulate

Checks permissions and estimates gas without submitting a transaction. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/traces/simulate
Authorization: Bearer <workspace API token>
Content-Type: application/json
```

```json
{
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000"
}
```

Response example (`200`):

```json
{
  "simulated": true,
  "broadcast": false,
  "operation": "recordTrace",
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "estimatedGas": "150000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/state/simulate

Checks permissions and estimates gas without submitting a transaction. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/state/simulate
Authorization: Bearer <workspace API token>
Content-Type: application/json
```

```json
{
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "newState": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000"
}
```

Response example (`200`):

```json
{
  "simulated": true,
  "broadcast": false,
  "operation": "updateEntityState",
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "estimatedGas": "150000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/metadata/simulate

Checks permissions and estimates gas without submitting a transaction. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/metadata/simulate
Authorization: Bearer <workspace API token>
Content-Type: application/json
```

```json
{
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "newMetadataHash": "0x5555555555555555555555555555555555555555555555555555555555555555",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000"
}
```

Response example (`200`):

```json
{
  "simulated": true,
  "broadcast": false,
  "operation": "updateEntityMetadata",
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "estimatedGas": "150000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/links/simulate

Checks permissions and estimates gas without submitting a transaction. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/links/simulate
Authorization: Bearer <workspace API token>
Content-Type: application/json
```

```json
{
  "targetEntityId": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "linkType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000"
}
```

Response example (`200`):

```json
{
  "simulated": true,
  "broadcast": false,
  "operation": "createEntityLink",
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "estimatedGas": "150000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/links/status/simulate

Checks permissions and estimates gas without submitting a transaction. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/links/status/simulate
Authorization: Bearer <workspace API token>
Content-Type: application/json
```

```json
{
  "targetEntityId": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "linkType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "active": true,
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000"
}
```

Response example (`200`):

```json
{
  "simulated": true,
  "broadcast": false,
  "operation": "setEntityLinkActive",
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "estimatedGas": "150000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/close/simulate

Checks permissions and estimates gas without submitting a transaction. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/close/simulate
Authorization: Bearer <workspace API token>
Content-Type: application/json
```

```json
{
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000"
}
```

Response example (`200`):

```json
{
  "simulated": true,
  "broadcast": false,
  "operation": "closeEntity",
  "tenantId": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "entityId": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "estimatedGas": "150000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/create/broadcast

Requires Idempotency-Key: generic_write_001 and confirm=BROADCAST; signs/submits a transaction only when broadcasting is enabled. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/create/broadcast
Authorization: Bearer <workspace API token>
Idempotency-Key: generic_write_001
Content-Type: application/json
```

```json
{
  "entityType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "metadataHash": "0x5555555555555555555555555555555555555555555555555555555555555555",
  "initialState": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "confirm": "BROADCAST"
}
```

Response example (`200`):

```json
{
  "broadcast": true,
  "confirmed": true,
  "recovered": false,
  "operationId": "11111111-1111-4111-8111-111111111111",
  "operation": "createEntity",
  "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
  "blockNumber": "120",
  "gasUsed": "140000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/traces/broadcast

Requires Idempotency-Key: generic_write_001 and confirm=BROADCAST; signs/submits a transaction only when broadcasting is enabled. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/traces/broadcast
Authorization: Bearer <workspace API token>
Idempotency-Key: generic_write_001
Content-Type: application/json
```

```json
{
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "confirm": "BROADCAST"
}
```

Response example (`200`):

```json
{
  "broadcast": true,
  "confirmed": true,
  "recovered": false,
  "operationId": "11111111-1111-4111-8111-111111111111",
  "operation": "recordTrace",
  "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
  "blockNumber": "120",
  "gasUsed": "140000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/state/broadcast

Requires Idempotency-Key: generic_write_001 and confirm=BROADCAST; signs/submits a transaction only when broadcasting is enabled. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/state/broadcast
Authorization: Bearer <workspace API token>
Idempotency-Key: generic_write_001
Content-Type: application/json
```

```json
{
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "newState": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "confirm": "BROADCAST"
}
```

Response example (`200`):

```json
{
  "broadcast": true,
  "confirmed": true,
  "recovered": false,
  "operationId": "11111111-1111-4111-8111-111111111111",
  "operation": "updateEntityState",
  "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
  "blockNumber": "120",
  "gasUsed": "140000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/metadata/broadcast

Requires Idempotency-Key: generic_write_001 and confirm=BROADCAST; signs/submits a transaction only when broadcasting is enabled. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/metadata/broadcast
Authorization: Bearer <workspace API token>
Idempotency-Key: generic_write_001
Content-Type: application/json
```

```json
{
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "newMetadataHash": "0x5555555555555555555555555555555555555555555555555555555555555555",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "confirm": "BROADCAST"
}
```

Response example (`200`):

```json
{
  "broadcast": true,
  "confirmed": true,
  "recovered": false,
  "operationId": "11111111-1111-4111-8111-111111111111",
  "operation": "updateEntityMetadata",
  "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
  "blockNumber": "120",
  "gasUsed": "140000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/links/broadcast

Requires Idempotency-Key: generic_write_001 and confirm=BROADCAST; signs/submits a transaction only when broadcasting is enabled. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/links/broadcast
Authorization: Bearer <workspace API token>
Idempotency-Key: generic_write_001
Content-Type: application/json
```

```json
{
  "targetEntityId": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "linkType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "confirm": "BROADCAST"
}
```

Response example (`200`):

```json
{
  "broadcast": true,
  "confirmed": true,
  "recovered": false,
  "operationId": "11111111-1111-4111-8111-111111111111",
  "operation": "createEntityLink",
  "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
  "blockNumber": "120",
  "gasUsed": "140000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/links/status/broadcast

Requires Idempotency-Key: generic_write_001 and confirm=BROADCAST; signs/submits a transaction only when broadcasting is enabled. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/links/status/broadcast
Authorization: Bearer <workspace API token>
Idempotency-Key: generic_write_001
Content-Type: application/json
```

```json
{
  "targetEntityId": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "linkType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "active": true,
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "confirm": "BROADCAST"
}
```

Response example (`200`):

```json
{
  "broadcast": true,
  "confirmed": true,
  "recovered": false,
  "operationId": "11111111-1111-4111-8111-111111111111",
  "operation": "setEntityLinkActive",
  "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
  "blockNumber": "120",
  "gasUsed": "140000"
}
```

### POST /v1/tenants/{tenantId}/entities/{entityId}/close/broadcast

Requires Idempotency-Key: generic_write_001 and confirm=BROADCAST; signs/submits a transaction only when broadcasting is enabled. Response shows selected fields.

Request example:

```http
POST /v1/tenants/{tenantId}/entities/{entityId}/close/broadcast
Authorization: Bearer <workspace API token>
Idempotency-Key: generic_write_001
Content-Type: application/json
```

```json
{
  "eventType": "0x9999999999999999999999999999999999999999999999999999999999999999",
  "evidenceHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "confirm": "BROADCAST"
}
```

Response example (`200`):

```json
{
  "broadcast": true,
  "confirmed": true,
  "recovered": false,
  "operationId": "11111111-1111-4111-8111-111111111111",
  "operation": "closeEntity",
  "transactionHash": "0x6666666666666666666666666666666666666666666666666666666666666666",
  "blockNumber": "120",
  "gasUsed": "140000"
}
```

## Network bootstrap

### GET /network/v1/bootstrap

Disabled by default (404). Requires its separate private deployment token. Returns 503 for missing/mismatched configuration and no-store responses. The genesis below is abbreviated for illustration; the actual response carries the complete original file. Use make node-fetch to download the verified bundle; this does not elect a validator.

Request example:

```http
GET /network/v1/bootstrap
Authorization: Bearer <bootstrap token>
```

Response example (`200`):

```json
{
  "format": 1,
  "chainId": 9009,
  "genesis": "{\"config\":{\"chainId\":9009,\"qbft\":{\"blockperiodseconds\":2}},\"extraData\":\"0x00\"}",
  "genesisFileHash": "da57e51b54427c70ca0f6cb69301058512ac314f1a07febdf0306e6a609b3e86",
  "genesisHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "bootnodes": [
    "enode://cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc@192.168.1.10:30303"
  ],
  "besuImage": "hyperledger/besu:26.9.0"
}
```

## Documentation endpoints

These routes are served on the private API listener and do not need an account.
Static Swagger assets are served beneath `/docs/static/`.

| Method and request | Response example |
| --- | --- |
| `GET /docs` or `GET /docs/` | `200 text/html` — Swagger UI page |
| `GET /docs/json` | `200 application/json` — OpenAPI document below |
| `GET /openapi.json` | `200 application/json` — the same OpenAPI document |
| `GET /docs/yaml` | `200 application/yaml` — YAML form of the OpenAPI document |

OpenAPI response example (selected fields):

```json
{"openapi":"3.0.3","info":{"title":"TraceForge API","version":"0.18.0"},"paths":{"/health":{"get":{"tags":["system"]}}}}
```
