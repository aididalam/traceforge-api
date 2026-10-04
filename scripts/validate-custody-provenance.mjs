import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";

import {
  resolve,
} from "node:path";

const bytes32 =
  /^0x[0-9a-fA-F]{64}$/;

const address =
  /^0x[0-9a-fA-F]{40}$/;

const decimal =
  /^[0-9]+$/;

const defaultTarget =
  resolve(
    process.cwd(),
    "../contracts/deployments/9009/operations",
  );

const targets =
  process.argv.slice(
    2,
  ).length > 0
    ? process.argv.slice(
        2,
      )
    : [
        defaultTarget,
      ];

function filesFor(
  target,
) {
  const absolute =
    resolve(
      target,
    );

  const info =
    statSync(
      absolute,
    );

  if (
    info.isFile()
  ) {
    return [
      absolute,
    ];
  }

  if (
    !info.isDirectory()
  ) {
    throw new Error(
      `Unsupported provenance target: ${absolute}`,
    );
  }

  return readdirSync(
    absolute,
    {
      withFileTypes:
        true,
    },
  )
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(
          ".json",
        ),
    )
    .map(
      (entry) =>
        resolve(
          absolute,
          entry.name,
        ),
    )
    .sort();
}

function requireObject(
  value,
  label,
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(
      value,
    )
  ) {
    throw new Error(
      `${label} must be an object.`,
    );
  }

  return value;
}

function requirePattern(
  value,
  pattern,
  label,
) {
  if (
    typeof value !==
      "string" ||
    !pattern.test(
      value,
    )
  ) {
    throw new Error(
      `${label} has an invalid format.`,
    );
  }
}

function validateEvidence(
  value,
  label,
) {
  const evidence =
    requireObject(
      value,
      label,
    );

  requirePattern(
    evidence.eventType,
    bytes32,
    `${label}.eventType`,
  );

  requirePattern(
    evidence.evidenceHash,
    bytes32,
    `${label}.evidenceHash`,
  );

  if (
    evidence.proposedAt !==
      undefined
  ) {
    requirePattern(
      evidence.proposedAt,
      decimal,
      `${label}.proposedAt`,
    );
  }

  if (
    evidence.acceptedAt !==
      undefined
  ) {
    requirePattern(
      evidence.acceptedAt,
      decimal,
      `${label}.acceptedAt`,
    );
  }
}

function validateTransaction(
  value,
  label,
) {
  const transaction =
    requireObject(
      value,
      label,
    );

  requirePattern(
    transaction.hash,
    bytes32,
    `${label}.hash`,
  );

  requirePattern(
    transaction.blockNumber,
    decimal,
    `${label}.blockNumber`,
  );

  requirePattern(
    transaction.gasUsed,
    decimal,
    `${label}.gasUsed`,
  );
}

function validateApiWrite(
  value,
  label,
) {
  if (
    value ===
    undefined
  ) {
    return;
  }

  const write =
    requireObject(
      value,
      label,
    );

  if (
    write.signerAddress !==
      undefined
  ) {
    requirePattern(
      write.signerAddress,
      address,
      `${label}.signerAddress`,
    );
  }

  if (
    write.roleId !==
      undefined
  ) {
    requirePattern(
      write.roleId,
      bytes32,
      `${label}.roleId`,
    );
  }

  for (
    const field of [
      "nonce",
      "gasEstimate",
      "gasLimit",
    ]
  ) {
    if (
      write[field] !==
        undefined
    ) {
      requirePattern(
        write[field],
        decimal,
        `${label}.${field}`,
      );
    }
  }
}

function validateCustodyProvenance(
  document,
  filename,
) {
  const root =
    requireObject(
      document,
      filename,
    );

  if (
    root.schemaVersion !==
      1
  ) {
    throw new Error(
      `${filename}: schemaVersion must equal 1.`,
    );
  }

  if (
    typeof root.complete !==
      "boolean"
  ) {
    throw new Error(
      `${filename}: complete must be boolean.`,
    );
  }

  const network =
    requireObject(
      root.network,
      `${filename}.network`,
    );

  if (
    !Number.isSafeInteger(
      network.chainId,
    ) ||
    network.chainId <= 0
  ) {
    throw new Error(
      `${filename}.network.chainId must be a positive integer.`,
    );
  }

  const contract =
    requireObject(
      root.contract,
      `${filename}.contract`,
    );

  requirePattern(
    contract.address,
    address,
    `${filename}.contract.address`,
  );

  if (
    contract.runtimeBytecodeHash !==
      undefined
  ) {
    requirePattern(
      contract.runtimeBytecodeHash,
      bytes32,
      `${filename}.contract.runtimeBytecodeHash`,
    );
  }

  const entity =
    requireObject(
      root.entity,
      `${filename}.entity`,
    );

  requirePattern(
    entity.entityId,
    bytes32,
    `${filename}.entity.entityId`,
  );

  const custody =
    requireObject(
      root.custody,
      `${filename}.custody`,
    );

  requirePattern(
    custody.fromOrganizationId,
    bytes32,
    `${filename}.custody.fromOrganizationId`,
  );

  requirePattern(
    custody.toOrganizationId,
    bytes32,
    `${filename}.custody.toOrganizationId`,
  );

  validateEvidence(
    custody.proposal,
    `${filename}.custody.proposal`,
  );

  const transactions =
    requireObject(
      root.transactions,
      `${filename}.transactions`,
    );

  validateTransaction(
    transactions.proposal,
    `${filename}.transactions.proposal`,
  );

  if (
    root.complete
  ) {
    validateEvidence(
      custody.acceptance,
      `${filename}.custody.acceptance`,
    );

    validateTransaction(
      transactions.acceptance,
      `${filename}.transactions.acceptance`,
    );
  } else {
    if (
      custody.acceptance !==
        undefined
    ) {
      validateEvidence(
        custody.acceptance,
        `${filename}.custody.acceptance`,
      );
    }

    if (
      transactions.acceptance !==
        undefined
    ) {
      validateTransaction(
        transactions.acceptance,
        `${filename}.transactions.acceptance`,
      );
    }
  }

  validateApiWrite(
    root.apiWrite,
    `${filename}.apiWrite`,
  );

  if (
    root.apiWrites !==
      undefined
  ) {
    const writes =
      requireObject(
        root.apiWrites,
        `${filename}.apiWrites`,
      );

    validateApiWrite(
      writes.proposal,
      `${filename}.apiWrites.proposal`,
    );

    validateApiWrite(
      writes.acceptance,
      `${filename}.apiWrites.acceptance`,
    );
  }

  requireObject(
    root.verification,
    `${filename}.verification`,
  );
}

let checked =
  0;

for (
  const target of targets
) {
  for (
    const filename of filesFor(
      target,
    )
  ) {
    const document =
      JSON.parse(
        readFileSync(
          filename,
          "utf8",
        ),
      );

    if (
      !document ||
      typeof document !==
        "object" ||
      !document.custody
    ) {
      continue;
    }

    validateCustodyProvenance(
      document,
      filename,
    );

    checked +=
      1;

    console.log(
      `PASS ${filename}`,
    );
  }
}

if (
  checked ===
  0
) {
  throw new Error(
    "No custody provenance JSON documents were found.",
  );
}

console.log();
console.log(
  `Validated ${checked} custody provenance document(s).`,
);
