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

const bytes32A =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

const bytes32B =
  "0x2222222222222222222222222222222222222222222222222222222222222222";

const targetEntityId =
  "0x27a444081505c5189cff279c4578288b88ad0ec42d5fb347b03037e4d1f072d4";

const linkType =
  "0xb546ddebf2cc54c215beee5b56c25b19cd4e03d9ef5628d869b5a8528fc95d01";

const cases = [
  {
    path:
      "create/broadcast",

    body: {
      entityType:
        bytes32A,
      metadataHash:
        bytes32B,
      initialState:
        bytes32A,
      confirm:
        "BROADCAST",
    },
  },

  {
    path:
      "traces/broadcast",

    body: {
      eventType:
        bytes32A,
      evidenceHash:
        bytes32B,
      confirm:
        "BROADCAST",
    },
  },

  {
    path:
      "state/broadcast",

    body: {
      eventType:
        bytes32A,
      newState:
        bytes32B,
      evidenceHash:
        bytes32A,
      confirm:
        "BROADCAST",
    },
  },

  {
    path:
      "metadata/broadcast",

    body: {
      eventType:
        bytes32A,
      newMetadataHash:
        bytes32B,
      evidenceHash:
        bytes32A,
      confirm:
        "BROADCAST",
    },
  },

  {
    path:
      "links/broadcast",

    body: {
      targetEntityId,
      linkType,
      eventType:
        bytes32A,
      evidenceHash:
        bytes32B,
      confirm:
        "BROADCAST",
    },
  },

  {
    path:
      "links/status/broadcast",

    body: {
      targetEntityId,
      linkType,
      active:
        false,
      eventType:
        bytes32A,
      evidenceHash:
        bytes32B,
      confirm:
        "BROADCAST",
    },
  },

  {
    path:
      "close/broadcast",

    body: {
      eventType:
        bytes32A,
      evidenceHash:
        bytes32B,
      confirm:
        "BROADCAST",
    },
  },
];

const beforeResponse =
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
  beforeResponse.status,
  200,
);

const before =
  await beforeResponse.json();

for (
  const [
    index,
    testCase,
  ] of cases.entries()
) {
  const response =
    await fetch(
      `${baseUrl}/v1/tenants/${tenantId}/entities/${entityId}/${testCase.path}`,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${token}`,

          "Content-Type":
            "application/json",

          "Idempotency-Key":
            `v015-disabled-generic-${index + 1}`,
        },

        body:
          JSON.stringify(
            testCase.body,
          ),
      },
    );

  const body =
    await response.json();

  assert.equal(
    response.status,
    503,
    `${testCase.path} should be disabled`,
  );

  assert.equal(
    body.error?.code,
    "broadcast_disabled",
    `${testCase.path} should return broadcast_disabled`,
  );
}

const afterResponse =
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
  afterResponse.status,
  200,
);

const after =
  await afterResponse.json();

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

console.log(
  "GENERIC BROADCAST DISABLED CHECK PASSED.",
);

console.log(
  "All 7 generic broadcast routes returned 503 broadcast_disabled.",
);

console.log(
  "Entity read model remained unchanged.",
);

console.log(
  "No transaction was intentionally submitted.",
);
