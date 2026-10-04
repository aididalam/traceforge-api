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

const response =
  await fetch(
    `${baseUrl}/v1/tenants/${tenantId}/entities/${entityId}/custody/acceptances/broadcast`,
    {
      method:
        "POST",

      headers: {
        Authorization:
          `Bearer ${token}`,

        "Content-Type":
          "application/json",

        "Idempotency-Key":
          "v012-disabled-acceptance-check",
      },

      body:
        JSON.stringify({
          eventType,
          evidenceHash,

          confirm:
            "BROADCAST",
        }),
    },
  );

const body =
  await response.json();

console.log(
  JSON.stringify(
    body,
    null,
    2,
  ),
);

assert.equal(
  response.status,
  503,
);

assert.equal(
  body.error?.code,
  "broadcast_disabled",
);

console.log();
console.log(
  "ACCEPTANCE BROADCAST DISABLED CHECK PASSED.",
);
console.log(
  "No transaction was submitted.",
);
