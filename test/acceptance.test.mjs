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

const writerTokenFile =
  process.env.TRACEFORGE_WRITER_TOKEN_FILE ??
  resolve(
    homedir(),
    ".traceforge/secrets/api-sandbox-writer.token",
  );

const writerToken =
  process.env.TRACEFORGE_WRITER_TOKEN ??
  readLocalFile(
    writerTokenFile,
    "utf8",
  ).trim();

const producerWriterTokenFile =
  process.env.TRACEFORGE_PRODUCER_WRITER_TOKEN_FILE ??
  resolve(
    homedir(),
    ".traceforge/secrets/api-sandbox-producer-writer.token",
  );

const producerWriterToken =
  process.env.TRACEFORGE_PRODUCER_WRITER_TOKEN ??
  readLocalFile(
    producerWriterTokenFile,
    "utf8",
  ).trim();

const producerWalletAddress =
  process.env.TRACEFORGE_TEST_PRODUCER_WALLET ??
  "0xA3f42A848A3A5675E959426e3c7258d0C7f0C019";

const producerRoleId =
  process.env.TRACEFORGE_TEST_PRODUCER_ROLE_ID ??
  "0xede905a271a8865b215f3d2d41a77155680c369834a15a16af84bc0d2cb60a26";

const distributorOrganizationId =
  process.env.TRACEFORGE_TEST_DISTRIBUTOR_ORG_ID ??
  "0x6d143f0625d0664c5d27b4a6e17141c05dc24eac70cd8a20552f620264b40f5f";

const distributorRoleId =
  process.env.TRACEFORGE_TEST_DISTRIBUTOR_ROLE_ID ??
  "0x5027b0e868d0fd05911c89da388fdd1393cc1ba493938df52179c481df0c00d3";

const producerOrganizationId =
  process.env.TRACEFORGE_TEST_PRODUCER_ORG_ID ??
  "0x19cb2dd8952a626d9254af21690cefaf9dba00e701bcd6805ac85a5d18cab11a";

const custodyProposalEventType =
  process.env.TRACEFORGE_TEST_CUSTODY_PROPOSAL_EVENT_TYPE ??
  "0x18abdf6d7f077cf392fc5218ce1cdd22017ca21480a9828a6fa2d8f086bb480b";

const custodyProposalEvidenceHash =
  process.env.TRACEFORGE_TEST_CUSTODY_PROPOSAL_EVIDENCE_HASH ??
  "0x2c27d8a4909372e10142f1c47099a0de6b48d7d2a3b190da5a68a920a3b031c8";



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

async function postJson(
  path,
  body,
  {
    authenticated = true,
    token = apiToken,
  } = {},
) {
  const headers = {
    "Content-Type":
      "application/json",
    ...(authenticated
      ? {
          Authorization:
            `Bearer ${token}`,
        }
      : {}),
  };

  const response =
    await fetch(
      `${baseUrl}${path}`,
      {
        method:
          "POST",
        headers,
        body:
          JSON.stringify(
            body,
          ),
      },
    );

  const responseBody =
    await response.json();

  return {
    response,
    body:
      responseBody,
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
  "broadcast endpoint is disabled by default",
  async () => {
    const response =
      await fetch(
        `${baseUrl}/v1/tenants/${tenantId}/entities/${batchId}/custody/proposals/broadcast`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${writerToken}`,

            "Content-Type":
              "application/json",

            "Idempotency-Key":
              "acceptance-disabled-broadcast",
          },

          body:
            JSON.stringify({
              toOrganizationId:
                producerOrganizationId,

              eventType:
                custodyProposalEventType,

              evidenceHash:
                custodyProposalEvidenceHash,

              confirm:
                "BROADCAST",
            }),
        },
      );

    const body =
      await response.json();

    assert.equal(
      response.status,
      503,
    );

    assert.equal(
      body.error?.code,
      "broadcast_disabled",
    );
  },
);

test(
  "custody proposal simulation never broadcasts",
  async () => {
    const response =
      await fetch(
        `${baseUrl}/v1/tenants/${tenantId}/entities/${batchId}/custody/proposals/simulate`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${writerToken}`,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              toOrganizationId:
                "0x19cb2dd8952a626d9254af21690cefaf9dba00e701bcd6805ac85a5d18cab11a",

              eventType:
                "0x18abdf6d7f077cf392fc5218ce1cdd22017ca21480a9828a6fa2d8f086bb480b",

              evidenceHash:
                "0x38067f2f281599aa06f0e5b14283560dd5ec1613fbfc8204ec58c4018c2c797f",
            }),
        },
      );

    const body =
      await response.json();

    assert.ok(
      response.status === 200 ||
      response.status === 409,
    );

    assert.notEqual(
      body.broadcast,
      true,
    );

    assert.equal(
      body.operation,
      "proposeCustodyTransfer",
    );

    if (
      response.status === 200
    ) {
      assert.equal(
        body.simulated,
        true,
      );
    } else {
      assert.equal(
        body.simulated,
        false,
      );

      assert.ok(
        [
          "preflight_failed",
          "simulation_failed",
        ].includes(
          body.error?.code,
        ),
      );
    }

    assert.equal(
      body.transactionHash,
      undefined,
    );
  },
);
test(
  "custody proposal simulation does not mutate live chain state",
  async () => {
    const liveState =
      async () => {
        const response =
          await fetch(
            `${baseUrl}/v1/auth/preflight?capability=CUSTODY_TRANSFER&entityId=${batchId}&pendingCustody=ignore`,
            {
              headers: {
                Authorization:
                  `Bearer ${writerToken}`,
              },
            },
          );

        assert.equal(
          response.status,
          200,
        );

        return response.json();
      };

    const before =
      await liveState();

    const simulationResponse =
      await fetch(
        `${baseUrl}/v1/tenants/${tenantId}/entities/${batchId}/custody/proposals/simulate`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${writerToken}`,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              toOrganizationId:
                "0x19cb2dd8952a626d9254af21690cefaf9dba00e701bcd6805ac85a5d18cab11a",

              eventType:
                "0x18abdf6d7f077cf392fc5218ce1cdd22017ca21480a9828a6fa2d8f086bb480b",

              evidenceHash:
                "0x38067f2f281599aa06f0e5b14283560dd5ec1613fbfc8204ec58c4018c2c797f",
            }),
        },
      );

    const simulation =
      await simulationResponse.json();

    assert.ok(
      simulationResponse.status === 200 ||
      simulationResponse.status === 409,
    );

    assert.notEqual(
      simulation.broadcast,
      true,
    );

    const after =
      await liveState();

    assert.equal(
      after.entity?.closed,
      before.entity?.closed,
    );

    assert.equal(
      after.entity?.currentCustodian?.toLowerCase(),
      before.entity?.currentCustodian?.toLowerCase(),
    );

    assert.deepEqual(
      after.pendingCustody,
      before.pendingCustody,
    );
  },
);
test(
  "read-only token cannot simulate custody proposal",
  async () => {
    const {
      response,
      body,
    } =
      await postJson(
        `/v1/tenants/${tenantId}/entities/${batchId}/custody/proposals/simulate`,
        {
          toOrganizationId:
            producerOrganizationId,

          eventType:
            custodyProposalEventType,

          evidenceHash:
            custodyProposalEvidenceHash,
        },
      );

    assert.equal(
      response.status,
      403,
    );

    assert.equal(
      body.error?.code,
      "insufficient_scope",
    );
  },
);

test(
  "live chain preflight authorizes the distributor writer independent of entity phase",
  async () => {
    const response =
      await fetch(
        `${baseUrl}/v1/auth/preflight?capability=CUSTODY_TRANSFER`,
        {
          headers: {
            Authorization:
              `Bearer ${writerToken}`,
          },
        },
      );

    const body =
      await response.json();

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      body.ready,
      true,
    );

    assert.equal(
      body.capability,
      "CUSTODY_TRANSFER",
    );

    assert.equal(
      body.capabilityIndex,
      4,
    );

    assert.equal(
      body.organizationId?.toLowerCase(),
      "0x6d143f0625d0664c5d27b4a6e17141c05dc24eac70cd8a20552f620264b40f5f",
    );

    assert.equal(
      body.authorizedRoleId?.toLowerCase(),
      "0x5027b0e868d0fd05911c89da388fdd1393cc1ba493938df52179c481df0c00d3",
    );
  },
);

test(
  "organization-aware preflight selects the producer signer",
  async () => {
    const {
      response,
      body,
    } =
      await getJson(
        "/v1/auth/preflight?capability=CUSTODY_TRANSFER",
        {
          token:
            producerWriterToken,
        },
      );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      body.ready,
      true,
    );

    assert.equal(
      body.organizationId?.toLowerCase(),
      producerOrganizationId.toLowerCase(),
    );

    assert.equal(
      body.signerAddress?.toLowerCase(),
      producerWalletAddress.toLowerCase(),
    );

    assert.equal(
      body.authorizedRoleId?.toLowerCase(),
      producerRoleId.toLowerCase(),
    );

    const runtimeHash =
      body.checks.find(
        (check) =>
          check.name ===
          "runtime_bytecode_hash",
      );

    assert.equal(
      runtimeHash?.ok,
      true,
    );

    const signerBinding =
      body.checks.find(
        (check) =>
          check.name ===
          "signer_wallet_binding",
      );

    assert.equal(
      signerBinding?.ok,
      true,
    );
  },
);

test(
  "read-only token is rejected by chain write preflight",
  async () => {
    const {
      response,
      body,
    } =
      await getJson(
        "/v1/auth/preflight?capability=CUSTODY_TRANSFER",
      );

    assert.equal(
      response.status,
      403,
    );

    assert.equal(
      body.error?.code,
      "insufficient_scope",
    );
  },
);

test(
  "live chain preflight detects a closed entity",
  async () => {
    const {
      response,
      body,
    } =
      await getJson(
        `/v1/auth/preflight?capability=ENTITY_CLOSE&entityId=${itemId}&requireCustody=true`,
        {
          token:
            writerToken,
        },
      );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      body.ready,
      false,
    );

    const entityOpen =
      body.checks.find(
        (check) =>
          check.name ===
          "entity_open",
      );

    assert.equal(
      entityOpen?.ok,
      false,
    );

    const custody =
      body.checks.find(
        (check) =>
          check.name ===
          "current_custody",
      );

    assert.equal(
      custody?.ok,
      true,
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

    assert.ok(
      body.paths?.[
        "/v1/auth/preflight"
      ],
    );

    assert.ok(
      body.paths?.[
        "/v1/tenants/{tenantId}/entities/{entityId}/custody/proposals/simulate"
      ],
    );

    assert.ok(
      body.paths?.[
        "/v1/tenants/{tenantId}/entities/{entityId}/custody/proposals/broadcast"
      ],
    );
  },
);
