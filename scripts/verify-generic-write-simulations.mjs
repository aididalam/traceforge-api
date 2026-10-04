import assert from "node:assert/strict";

import {
  readFileSync,
} from "node:fs";

import {
  homedir,
} from "node:os";

import {
  resolve,
} from "node:path";

const baseUrl =
  process.env.TRACEFORGE_API_URL ??
  "http://127.0.0.1:3000";

const tenantId =
  "0x99fcc8dda979ffa767f086d31e451e8f244ecdf1334f5af2af4f6b397aff30e2";

const entityId =
  "0x098dec8d5207ed3dd8a04fd03193c758c650884d39f9d471e6d95336c4a1a569";

const producerOrganizationId =
  "0x19cb2dd8952a626d9254af21690cefaf9dba00e701bcd6805ac85a5d18cab11a";

const producerWallet =
  "0xA3f42A848A3A5675E959426e3c7258d0C7f0C019";

const producerRoleId =
  "0xede905a271a8865b215f3d2d41a77155680c369834a15a16af84bc0d2cb60a26";

const eventType =
  "0x156f6a165352cf67cc8ebf8a74cf58b8dbc65e08dfdffb51bcfd3cc3bde1882e";

const evidenceHash =
  "0xa2a204914470d4dc01ca5be8bd87ca488ada476f3f3402aad113ad079f4e6a36";

const token =
  readFileSync(
    resolve(
      homedir(),
      ".traceforge",
      "secrets",
      "api-sandbox-producer-writer.token",
    ),
    "utf8",
  ).trim();

const routes = [
  "/v1/tenants/{tenantId}/entities/{entityId}/create/simulate",
  "/v1/tenants/{tenantId}/entities/{entityId}/traces/simulate",
  "/v1/tenants/{tenantId}/entities/{entityId}/state/simulate",
  "/v1/tenants/{tenantId}/entities/{entityId}/metadata/simulate",
  "/v1/tenants/{tenantId}/entities/{entityId}/links/simulate",
  "/v1/tenants/{tenantId}/entities/{entityId}/links/status/simulate",
  "/v1/tenants/{tenantId}/entities/{entityId}/close/simulate",
];

const openApiResponse =
  await fetch(
    `${baseUrl}/openapi.json`,
  );

assert.equal(
  openApiResponse.status,
  200,
);

const openApi =
  await openApiResponse.json();

for (
  const path of routes
) {
  assert.ok(
    openApi.paths?.[path]?.post,
    `Missing POST route: ${path}`,
  );
}

const readEntity =
  async () => {
    const response =
      await fetch(
        `${baseUrl}/v1/tenants/${tenantId}/entities/${entityId}`,
        {
          headers: {
            Authorization:
              `Bearer ${token}`,
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
  await readEntity();

const traceResponse =
  await fetch(
    `${baseUrl}/v1/tenants/${tenantId}/entities/${entityId}/traces/simulate`,
    {
      method:
        "POST",

      headers: {
        Authorization:
          `Bearer ${token}`,

        "Content-Type":
          "application/json",
      },

      body:
        JSON.stringify({
          eventType,
          evidenceHash,
        }),
    },
  );

const trace =
  await traceResponse.json();

console.log(
  JSON.stringify(
    trace,
    null,
    2,
  ),
);

assert.equal(
  traceResponse.status,
  200,
);

assert.equal(
  trace.simulated,
  true,
);

assert.equal(
  trace.broadcast,
  false,
);

assert.equal(
  trace.operation,
  "recordTrace",
);

assert.equal(
  trace.organizationId?.toLowerCase(),
  producerOrganizationId.toLowerCase(),
);

assert.equal(
  trace.signerAddress?.toLowerCase(),
  producerWallet.toLowerCase(),
);

assert.equal(
  trace.roleId?.toLowerCase(),
  producerRoleId.toLowerCase(),
);

const after =
  await readEntity();

assert.equal(
  after.currentState,
  before.currentState,
);

assert.equal(
  after.metadataHash,
  before.metadataHash,
);

assert.equal(
  after.currentCustodian?.toLowerCase(),
  before.currentCustodian?.toLowerCase(),
);

assert.equal(
  after.closed,
  before.closed,
);

const createExistingResponse =
  await fetch(
    `${baseUrl}/v1/tenants/${tenantId}/entities/${entityId}/create/simulate`,
    {
      method:
        "POST",

      headers: {
        Authorization:
          `Bearer ${token}`,

        "Content-Type":
          "application/json",
      },

      body:
        JSON.stringify({
          entityType:
            "0xa7a318e10600421edf76d4178817bf2a41f7a09102c28792770d5bcd819767ff",

          metadataHash:
            before.metadataHash,

          initialState:
            before.currentState,
        }),
    },
  );

const createExisting =
  await createExistingResponse.json();

assert.equal(
  createExistingResponse.status,
  409,
);

assert.equal(
  createExisting.simulated,
  false,
);

assert.equal(
  createExisting.broadcast,
  false,
);

assert.equal(
  createExisting.error?.code,
  "preflight_failed",
);

assert.ok(
  createExisting.checks?.some(
    (check) =>
      check.name ===
        "entity_absent" &&
      check.ok ===
        false,
  ),
);

console.log();
console.log(
  "GENERIC WRITE SIMULATION VERIFIED.",
);
console.log(
  "recordTrace simulated successfully without broadcasting.",
);
console.log(
  "createEntity correctly rejected an existing entity before simulation.",
);
console.log(
  "Entity read model remained unchanged.",
);
