import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  tmpdir,
} from "node:os";

import {
  resolve,
} from "node:path";

import {
  spawnSync,
} from "node:child_process";

const validator =
  resolve(
    process.cwd(),
    "scripts/validate-generic-provenance.mjs",
  );

const source =
  resolve(
    process.cwd(),
    "../contracts/deployments/9009/operations/entity-sandbox-batch-001-generic-record-trace-proof-001.json",
  );

const temp =
  mkdtempSync(
    resolve(
      tmpdir(),
      "traceforge-provenance-v1-",
    ),
  );

function run(
  filename,
) {
  return spawnSync(
    process.execPath,
    [
      validator,
      filename,
    ],
    {
      encoding:
        "utf8",
    },
  );
}

try {
  const valid =
    resolve(
      temp,
      "entity-valid-generic-proof.json",
    );

  cpSync(
    source,
    valid,
  );

  const validResult =
    run(
      valid,
    );

  if (
    validResult.status !==
      0
  ) {
    throw new Error(
      `Valid generic provenance was rejected:\n${validResult.stderr}${validResult.stdout}`,
    );
  }

  const base =
    JSON.parse(
      readFileSync(
        source,
        "utf8",
      ),
    );

  const secretLeak = {
    ...base,

    apiWrite: {
      ...base.apiWrite,

      serializedTransaction:
        "0xdeadbeef",
    },
  };

  const secretFile =
    resolve(
      temp,
      "entity-secret-generic-proof.json",
    );

  writeFileSync(
    secretFile,
    JSON.stringify(
      secretLeak,
      null,
      2,
    ),
  );

  const secretResult =
    run(
      secretFile,
    );

  if (
    secretResult.status ===
      0
  ) {
    throw new Error(
      "Secret-bearing generic provenance was accepted.",
    );
  }

  const missingEvidence = {
    ...base,

    operation: {
      ...base.operation,
    },
  };

  delete missingEvidence
    .operation
    .evidenceHash;

  const missingEvidenceFile =
    resolve(
      temp,
      "entity-missing-evidence-generic-proof.json",
    );

  writeFileSync(
    missingEvidenceFile,
    JSON.stringify(
      missingEvidence,
      null,
      2,
    ),
  );

  const evidenceResult =
    run(
      missingEvidenceFile,
    );

  if (
    evidenceResult.status ===
      0
  ) {
    throw new Error(
      "recordTrace provenance without evidenceHash was accepted.",
    );
  }

  const unresolved =
    structuredClone(
      base,
    );

  unresolved.verification
    .traceResolution
    .evidence = {
      resolved:
        9,
      total:
        10,
      unresolved:
        0,
    };

  const unresolvedFile =
    resolve(
      temp,
      "entity-bad-resolution-generic-proof.json",
    );

  writeFileSync(
    unresolvedFile,
    JSON.stringify(
      unresolved,
      null,
      2,
    ),
  );

  const unresolvedResult =
    run(
      unresolvedFile,
    );

  if (
    unresolvedResult.status ===
      0
  ) {
    throw new Error(
      "Inconsistent resolution counts were accepted.",
    );
  }

  console.log(
    "GENERIC PROVENANCE VALIDATOR VERIFIED.",
  );

  console.log(
    "Valid v1 document accepted.",
  );

  console.log(
    "Serialized transaction leak rejected.",
  );

  console.log(
    "Missing recordTrace evidence rejected.",
  );

  console.log(
    "Inconsistent resolution counts rejected.",
  );
} finally {
  rmSync(
    temp,
    {
      recursive:
        true,
      force:
        true,
    },
  );
}
