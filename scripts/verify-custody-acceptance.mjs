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

import {
  keccak256,
  stringToHex,
  toHex,
} from "viem";

const baseUrl =
  process.env.TRACEFORGE_API_URL ??
  "http://127.0.0.1:3000";

const tenantId =
  "0x99fcc8dda979ffa767f086d31e451e8f244ecdf1334f5af2af4f6b397aff30e2";

const entityId =
  "0x098dec8d5207ed3dd8a04fd03193c758c650884d39f9d471e6d95336c4a1a569";

const producerOrganizationId =
  "0x19cb2dd8952a626d9254af21690cefaf9dba00e701bcd6805ac85a5d18cab11a";

const distributorOrganizationId =
  "0x6d143f0625d0664c5d27b4a6e17141c05dc24eac70cd8a20552f620264b40f5f";

const producerWallet =
  "0xA3f42A848A3A5675E959426e3c7258d0C7f0C019";

const producerRoleId =
  "0xede905a271a8865b215f3d2d41a77155680c369834a15a16af84bc0d2cb60a26";

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

const evidencePath =
  resolve(
    process.cwd(),
    "../contracts/bootstrap/evidence-sandbox-batch-001-custody-return-accepted.json",
  );

const evidenceBytes =
  readFileSync(
    evidencePath,
  );

const evidence =
  JSON.parse(
    evidenceBytes.toString(
      "utf8",
    ),
  );

const eventType =
  keccak256(
    stringToHex(
      evidence.event,
    ),
  );

const evidenceHash =
  keccak256(
    toHex(
      evidenceBytes,
    ),
  );

const simulationResponse =
  await fetch(
    `${baseUrl}/v1/tenants/${tenantId}/entities/${entityId}/custody/acceptances/simulate`,
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

const simulation =
  await simulationResponse.json();

console.log(
  JSON.stringify(
    simulation,
    null,
    2,
  ),
);

assert.equal(
  simulationResponse.status,
  200,
);

assert.equal(
  simulation.simulated,
  true,
);

assert.equal(
  simulation.broadcast,
  false,
);

assert.equal(
  simulation.operation,
  "acceptCustodyTransfer",
);

assert.equal(
  simulation.organizationId?.toLowerCase(),
  producerOrganizationId.toLowerCase(),
);

assert.equal(
  simulation.signerAddress?.toLowerCase(),
  producerWallet.toLowerCase(),
);

assert.equal(
  simulation.roleId?.toLowerCase(),
  producerRoleId.toLowerCase(),
);

assert.equal(
  simulation.currentCustodian?.toLowerCase(),
  distributorOrganizationId.toLowerCase(),
);

assert.equal(
  simulation.pendingCustody?.exists,
  true,
);

assert.equal(
  simulation.pendingCustody?.fromOrganizationId?.toLowerCase(),
  distributorOrganizationId.toLowerCase(),
);

assert.equal(
  simulation.pendingCustody?.toOrganizationId?.toLowerCase(),
  producerOrganizationId.toLowerCase(),
);

const entityResponse =
  await fetch(
    `${baseUrl}/v1/tenants/${tenantId}/entities/${entityId}`,
    {
      headers: {
        Authorization:
          `Bearer ${token}`,
      },
    },
  );

const entity =
  await entityResponse.json();

assert.equal(
  entityResponse.status,
  200,
);

const currentCustodian =
  entity.currentCustodian ??
  entity.entity?.currentCustodian;

assert.equal(
  currentCustodian?.toLowerCase(),
  distributorOrganizationId.toLowerCase(),
);

console.log();
console.log(
  "CUSTODY ACCEPTANCE SIMULATION VERIFIED.",
);
console.log(
  `eventType:    ${eventType}`,
);
console.log(
  `evidenceHash: ${evidenceHash}`,
);
console.log(
  "No transaction was broadcast and custody remains with the distributor.",
);
