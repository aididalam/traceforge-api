import {
  readFileSync as readLocalFile,
} from "node:fs";

import {
  homedir,
} from "node:os";

import {
  resolve,
} from "node:path";

import test from "node:test";
import assert from "node:assert/strict";

const baseUrl =
  process.env.API_BASE_URL ??
  "http://127.0.0.1:3000";

const tokenFile =
  process.env.TRACEFORGE_API_TOKEN_FILE ??
  resolve(
    homedir(),
    ".traceforge/secrets/api-sandbox.token",
  );

const apiToken =
  process.env.TRACEFORGE_API_TOKEN ??
  readLocalFile(
    tokenFile,
    "utf8",
  ).trim();


const tenantId =
  process.env.TRACEFORGE_TEST_TENANT_ID ??
  "0x99fcc8dda979ffa767f086d31e451e8f244ecdf1334f5af2af4f6b397aff30e2";

const batchId =
  process.env.TRACEFORGE_TEST_BATCH_ID ??
  "0x098dec8d5207ed3dd8a04fd03193c758c650884d39f9d471e6d95336c4a1a569";

const itemId =
  process.env.TRACEFORGE_TEST_ITEM_ID ??
  "0x27a444081505c5189cff279c4578288b88ad0ec42d5fb347b03037e4d1f072d4";

const batchMetadataHash =
  process.env.TRACEFORGE_TEST_BATCH_METADATA_HASH ??
  "0x8a275375d6dca9355e8acc9db74e8f292c1559954700c31d47a0f2e92b3375fa";

async function getJson(
  path,
  {
    authenticated = true,
    token = apiToken,
  } = {},
) {
  const headers =
    authenticated
      ? {
          Authorization:
            `Bearer ${token}`,
        }
      : {};

  const response =
    await fetch(
      `${baseUrl}${path}`,
      {
        headers,
      },
    );

  const body =
    await response.json();

  return {
    response,
    body,
  };
}

test(
  "health and readiness",
  async () => {
    const health =
      await getJson(
        "/health",
      );

    assert.equal(
      health.response.status,
      200,
    );

    assert.equal(
      health.body.service,
      "traceforge-api",
    );

    assert.equal(
      health.body.status,
      "ok",
    );

    const ready =
      await getJson(
        "/ready",
      );

    assert.equal(
      ready.response.status,
      200,
    );

    assert.equal(
      ready.body.database,
      "ok",
    );

    assert.equal(
      ready.body.status,
      "ready",
    );
  },
);

test(
  "current batch resolves metadata and semantics",
  async () => {
    const {
      response,
      body,
    } =
      await getJson(
        `/v1/tenants/${tenantId}/entities/${batchId}`,
      );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      body.entityId,
      batchId,
    );

    assert.equal(
      body.entityTypeLabel,
      "Batch",
    );

    assert.equal(
      body.currentStateLabel,
      "Packed",
    );

    assert.equal(
      body.closed,
      false,
    );

    assert.equal(
      body.metadataHash,
      batchMetadataHash,
    );

    assert.equal(
      body.metadata?.slug,
      "sandbox-batch-001",
    );

    assert.equal(
      body.metadata?.revision,
      2,
    );
  },
);

test(
  "closed item resolves terminal lifecycle",
  async () => {
    const {
      response,
      body,
    } =
      await getJson(
        `/v1/tenants/${tenantId}/entities/${itemId}`,
      );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      body.entityTypeLabel,
      "Item",
    );

    assert.equal(
      body.currentStateLabel,
      "Created",
    );

    assert.equal(
      body.closed,
      true,
    );

    assert.ok(
      body.closedAt,
    );
  },
);

test(
  "document lookup resolves exact metadata hash",
  async () => {
    const {
      response,
      body,
    } =
      await getJson(
        `/v1/documents/${batchMetadataHash}`,
      );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      body.contentHash,
      batchMetadataHash,
    );

    assert.equal(
      body.documentKind,
      "entity",
    );

    assert.equal(
      body.document?.slug,
      "sandbox-batch-001",
    );

    assert.equal(
      body.document?.revision,
      2,
    );
  },
);

test(
  "batch history resolves verified semantic labels",
  async () => {
    const {
      response,
      body,
    } =
      await getJson(
        `/v1/tenants/${tenantId}/entities/${batchId}/history?limit=20`,
      );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      body.entity.entityTypeLabel,
      "Batch",
    );

    assert.equal(
      body.entity.currentStateLabel,
      "Packed",
    );

    const byEventId =
      new Map(
        body.events.map(
          (event) => [
            event.eventId,
            event,
          ],
        ),
      );

    assert.equal(
      byEventId.get("17")?.eventTypeLabel,
      "Batch Registered",
    );

    assert.equal(
      byEventId.get("18")?.eventTypeLabel,
      "Batch Packed",
    );

    assert.equal(
      byEventId.get("18")?.stateAfterLabel,
      "Packed",
    );

    assert.equal(
      byEventId.get("35")?.eventTypeLabel,
      "Custody Transfer Accepted",
    );

    assert.equal(
      byEventId.get("38")?.linkTypeLabel,
      "Contains",
    );

    assert.equal(
      byEventId.get("40")?.eventTypeLabel,
      "Entity Link Enabled",
    );
  },
);

test(
  "tenant discovery returns entities, organizations, and relationships",
  async () => {
    const entities =
      await getJson(
        `/v1/tenants/${tenantId}/entities?limit=10`,
      );

    assert.equal(
      entities.response.status,
      200,
    );

    assert.equal(
      entities.body.entities.length,
      2,
    );

    assert.deepEqual(
      entities.body.entities.map(
        (entity) =>
          entity.entityTypeLabel,
      ),
      [
        "Batch",
        "Item",
      ],
    );

    const organizations =
      await getJson(
        `/v1/tenants/${tenantId}/organizations?limit=10`,
      );

    assert.equal(
      organizations.response.status,
      200,
    );

    assert.equal(
      organizations.body.organizations.length,
      2,
    );

    assert.deepEqual(
      organizations.body.organizations.map(
        (organization) =>
          organization.metadata?.slug,
      ),
      [
        "sandbox-producer",
        "sandbox-distributor",
      ],
    );

    const relationships =
      await getJson(
        `/v1/tenants/${tenantId}/relationships?limit=10`,
      );

    assert.equal(
      relationships.response.status,
      200,
    );

    assert.equal(
      relationships.body.relationships.length,
      1,
    );

    assert.equal(
      relationships.body.relationships[0].linkTypeLabel,
      "Contains",
    );

    assert.equal(
      relationships.body.relationships[0].active,
      true,
    );
  },
);

test(
  "entity discovery cursor returns the second page exactly once",
  async () => {
    const first =
      await getJson(
        `/v1/tenants/${tenantId}/entities?limit=1`,
      );

    assert.equal(
      first.response.status,
      200,
    );

    assert.equal(
      first.body.entities.length,
      1,
    );

    assert.equal(
      first.body.page.hasMore,
      true,
    );

    assert.ok(
      first.body.page.nextAfterEventId,
    );

    const cursor =
      first.body.page.nextAfterEventId;

    const second =
      await getJson(
        `/v1/tenants/${tenantId}/entities?limit=1&afterEventId=${cursor}`,
      );

    assert.equal(
      second.response.status,
      200,
    );

    assert.equal(
      second.body.entities.length,
      1,
    );

    assert.equal(
      second.body.entities[0].entityId,
      itemId,
    );

    assert.equal(
      second.body.page.hasMore,
      false,
    );

    assert.equal(
      second.body.page.nextAfterEventId,
      null,
    );
  },
);

test(
  "authenticated token exposes its principal and scopes",
  async () => {
    const {
      response,
      body,
    } =
      await getJson(
        "/v1/auth/me",
      );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      body.tenantId,
      tenantId,
    );

    assert.equal(
      body.organizationId,
      null,
    );

    assert.ok(
      body.scopes.includes(
        "tenant:read",
      ),
    );

    assert.equal(
      body.scopes.includes(
        "chain:write",
      ),
      false,
    );
  },
);

test(
  "protected API rejects missing authentication",
  async () => {
    const {
      response,
      body,
    } =
      await getJson(
        `/v1/tenants/${tenantId}/entities?limit=1`,
        {
          authenticated:
            false,
        },
      );

    assert.equal(
      response.status,
      401,
    );

    assert.equal(
      body.error?.code,
      "authentication_required",
    );
  },
);

test(
  "tenant token cannot cross tenant boundary",
  async () => {
    const otherTenant =
      `0x${"11".repeat(32)}`;

    const {
      response,
      body,
    } =
      await getJson(
        `/v1/tenants/${otherTenant}/entities?limit=1`,
      );

    assert.equal(
      response.status,
      403,
    );

    assert.equal(
      body.error?.code,
      "tenant_access_denied",
    );
  },
);

test(
  "invalid identifiers return structured API errors",
  async () => {
    const {
      response,
      body,
    } =
      await getJson(
        "/v1/tenants/bad/entities/bad",
      );

    assert.equal(
      response.status,
      400,
    );

    assert.equal(
      body.error?.code,
      "invalid_request",
    );

    assert.equal(
      typeof body.error?.message,
      "string",
    );
  },
);

test(
  "OpenAPI document is exposed",
  async () => {
    const {
      response,
      body,
    } =
      await getJson(
        "/openapi.json",
      );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      body.openapi,
      "3.0.3",
    );

    assert.equal(
      body.info?.title,
      "TraceForge API",
    );

    assert.ok(
      body.paths?.[
        "/v1/tenants/{tenantId}/entities"
      ],
    );

    assert.ok(
      body.paths?.[
        "/v1/tenants/{tenantId}/organizations"
      ],
    );

    assert.ok(
      body.paths?.[
        "/v1/tenants/{tenantId}/relationships"
      ],
    );
  },
);
