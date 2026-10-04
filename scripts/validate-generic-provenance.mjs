import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";

import {
  basename,
  resolve,
} from "node:path";

const bytes32 =
  /^0x[0-9a-fA-F]{64}$/;

const address =
  /^0x[0-9a-fA-F]{40}$/;

const decimal =
  /^[0-9]+$/;

const genericOperations =
  new Set([
    "createEntity",
    "recordTrace",
    "updateEntityState",
    "updateEntityMetadata",
    "createEntityLink",
    "setEntityLinkActive",
    "closeEntity",
  ]);

const expectedEvents = {
  createEntity: [
    "EntityCreated",
  ],

  recordTrace: [
    "TraceRecorded",
  ],

  updateEntityState: [
    "TraceRecorded",
  ],

  updateEntityMetadata: [
    "TraceRecorded",
  ],

  createEntityLink: [
    "EntityLinkCreated",
  ],

  setEntityLinkActive: [
    "EntityLinkStatusChanged",
  ],

  closeEntity: [
    "EntityClosed",
    "TraceRecorded",
  ],
};

const forbiddenKeys =
  new Set([
    "privateKey",
    "private_key",
    "serializedTransaction",
    "serialized_transaction",
    "token",
    "apiToken",
    "api_token",
    "bearerToken",
    "bearer_token",
    "password",
    "mysqlPassword",
    "mysql_password",
    "secret",
    "mnemonic",
    "seedPhrase",
    "seed_phrase",
  ]);

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
        ) &&
        entry.name.includes(
          "-generic-",
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

function requireBoolean(
  value,
  expected,
  label,
) {
  if (
    typeof value !==
      "boolean"
  ) {
    throw new Error(
      `${label} must be boolean.`,
    );
  }

  if (
    expected !==
      undefined &&
    value !==
      expected
  ) {
    throw new Error(
      `${label} must equal ${expected}.`,
    );
  }
}

function requireInteger(
  value,
  label,
  minimum =
    0,
) {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < minimum
  ) {
    throw new Error(
      `${label} must be an integer >= ${minimum}.`,
    );
  }
}

function assertSecretFree(
  value,
  label,
) {
  if (
    Array.isArray(
      value,
    )
  ) {
    value.forEach(
      (
        entry,
        index,
      ) =>
        assertSecretFree(
          entry,
          `${label}[${index}]`,
        ),
    );

    return;
  }

  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return;
  }

  for (
    const [
      key,
      entry,
    ] of Object.entries(
      value,
    )
  ) {
    if (
      forbiddenKeys.has(
        key,
      )
    ) {
      throw new Error(
        `${label}.${key} is forbidden in public provenance.`,
      );
    }

    assertSecretFree(
      entry,
      `${label}.${key}`,
    );
  }
}

function requireFields(
  object,
  fields,
  label,
) {
  for (
    const field of fields
  ) {
    if (
      object[field] ===
        undefined
    ) {
      throw new Error(
        `${label}.${field} is required.`,
      );
    }
  }
}

function validateOperation(
  value,
  label,
) {
  const operation =
    requireObject(
      value,
      label,
    );

  if (
    !genericOperations.has(
      operation.name,
    )
  ) {
    throw new Error(
      `${label}.name is not a supported generic operation.`,
    );
  }

  const evidenceFields = [
    "eventType",
    "evidenceHash",
  ];

  switch (
    operation.name
  ) {
    case "createEntity":
      requireFields(
        operation,
        [
          "entityType",
          "metadataHash",
          "initialState",
        ],
        label,
      );

      for (
        const field of [
          "entityType",
          "metadataHash",
          "initialState",
        ]
      ) {
        requirePattern(
          operation[field],
          bytes32,
          `${label}.${field}`,
        );
      }

      break;

    case "recordTrace":
    case "closeEntity":
      requireFields(
        operation,
        evidenceFields,
        label,
      );
      break;

    case "updateEntityState":
      requireFields(
        operation,
        [
          ...evidenceFields,
          "newState",
        ],
        label,
      );

      requirePattern(
        operation.newState,
        bytes32,
        `${label}.newState`,
      );

      break;

    case "updateEntityMetadata":
      requireFields(
        operation,
        [
          ...evidenceFields,
          "newMetadataHash",
        ],
        label,
      );

      requirePattern(
        operation.newMetadataHash,
        bytes32,
        `${label}.newMetadataHash`,
      );

      break;

    case "createEntityLink":
      requireFields(
        operation,
        [
          ...evidenceFields,
          "targetEntityId",
          "linkType",
        ],
        label,
      );

      requirePattern(
        operation.targetEntityId,
        bytes32,
        `${label}.targetEntityId`,
      );

      requirePattern(
        operation.linkType,
        bytes32,
        `${label}.linkType`,
      );

      break;

    case "setEntityLinkActive":
      requireFields(
        operation,
        [
          ...evidenceFields,
          "targetEntityId",
          "linkType",
          "active",
        ],
        label,
      );

      requirePattern(
        operation.targetEntityId,
        bytes32,
        `${label}.targetEntityId`,
      );

      requirePattern(
        operation.linkType,
        bytes32,
        `${label}.linkType`,
      );

      requireBoolean(
        operation.active,
        undefined,
        `${label}.active`,
      );

      break;
  }

  if (
    operation.name !==
      "createEntity"
  ) {
    requirePattern(
      operation.eventType,
      bytes32,
      `${label}.eventType`,
    );

    requirePattern(
      operation.evidenceHash,
      bytes32,
      `${label}.evidenceHash`,
    );
  }

  if (
    operation.evidenceFile !==
      undefined
  ) {
    if (
      typeof operation.evidenceFile !==
        "string" ||
      !/^bootstrap\/[A-Za-z0-9._/-]+\.json$/.test(
        operation.evidenceFile,
      )
    ) {
      throw new Error(
        `${label}.evidenceFile must be a relative bootstrap JSON path.`,
      );
    }
  }

  if (
    operation.timestamp !==
      undefined
  ) {
    requirePattern(
      operation.timestamp,
      decimal,
      `${label}.timestamp`,
    );
  }

  return operation;
}

function validateApiWrite(
  value,
  label,
) {
  const write =
    requireObject(
      value,
      label,
    );

  requireFields(
    write,
    [
      "operationId",
      "idempotencyKey",
      "nonce",
      "gasEstimate",
      "gasLimit",
      "status",
    ],
    label,
  );

  if (
    typeof write.operationId !==
      "string" ||
    write.operationId.length ===
      0
  ) {
    throw new Error(
      `${label}.operationId must be a non-empty string.`,
    );
  }

  if (
    typeof write.idempotencyKey !==
      "string" ||
    write.idempotencyKey.length <
      8 ||
    write.idempotencyKey.length >
      128
  ) {
    throw new Error(
      `${label}.idempotencyKey must be 8-128 characters.`,
    );
  }

  for (
    const field of [
      "nonce",
      "gasEstimate",
      "gasLimit",
    ]
  ) {
    requirePattern(
      write[field],
      decimal,
      `${label}.${field}`,
    );
  }

  if (
    write.status !==
      "CONFIRMED"
  ) {
    throw new Error(
      `${label}.status must equal CONFIRMED.`,
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

  for (
    const field of [
      "blockNumber",
      "gasUsed",
    ]
  ) {
    requirePattern(
      transaction[field],
      decimal,
      `${label}.${field}`,
    );
  }

  if (
    transaction.receiptStatus !==
      "success"
  ) {
    throw new Error(
      `${label}.receiptStatus must equal success.`,
    );
  }

  requireInteger(
    transaction.logCount,
    `${label}.logCount`,
    1,
  );
}

function validateIndexedEvent(
  value,
  label,
) {
  const event =
    requireObject(
      value,
      label,
    );

  requirePattern(
    event.eventId,
    decimal,
    `${label}.eventId`,
  );

  if (
    typeof event.eventName !==
      "string"
  ) {
    throw new Error(
      `${label}.eventName must be a string.`,
    );
  }

  requireInteger(
    event.logIndex,
    `${label}.logIndex`,
    0,
  );

  for (
    const field of [
      "stateAfter",
      "metadataHashAfter",
      "linkId",
    ]
  ) {
    if (
      event[field] !==
        undefined
    ) {
      requirePattern(
        event[field],
        bytes32,
        `${label}.${field}`,
      );
    }
  }

  if (
    event.active !==
      undefined
  ) {
    requireBoolean(
      event.active,
      undefined,
      `${label}.active`,
    );
  }

  return event;
}

function validateResolution(
  value,
  label,
) {
  const count =
    requireObject(
      value,
      label,
    );

  for (
    const field of [
      "resolved",
      "total",
      "unresolved",
    ]
  ) {
    requireInteger(
      count[field],
      `${label}.${field}`,
      0,
    );
  }

  if (
    count.resolved +
      count.unresolved !==
    count.total
  ) {
    throw new Error(
      `${label}: resolved + unresolved must equal total.`,
    );
  }
}

function validateVerification(
  value,
  label,
  operation,
) {
  const verification =
    requireObject(
      value,
      label,
    );

  for (
    const field of [
      "receiptConfirmed",
      "journalConfirmed",
      "serializedTransactionCleared",
      "indexerReconciled",
      "broadcastDisabledAfterWrite",
    ]
  ) {
    requireBoolean(
      verification[field],
      true,
      `${label}.${field}`,
    );
  }

  for (
    const field of [
      "finalState",
      "finalMetadataHash",
      "finalCustodianOrganizationId",
      "finalLinkId",
    ]
  ) {
    if (
      verification[field] !==
        undefined
    ) {
      requirePattern(
        verification[field],
        bytes32,
        `${label}.${field}`,
      );
    }
  }

  if (
    verification.traceResolution !==
      undefined
  ) {
    const resolution =
      requireObject(
        verification.traceResolution,
        `${label}.traceResolution`,
      );

    if (
      resolution.metadata !==
        undefined
    ) {
      validateResolution(
        resolution.metadata,
        `${label}.traceResolution.metadata`,
      );
    }

    if (
      resolution.evidence !==
        undefined
    ) {
      validateResolution(
        resolution.evidence,
        `${label}.traceResolution.evidence`,
      );
    }
  }

  if (
    operation.name ===
      "recordTrace"
  ) {
    for (
      const field of [
        "stateUnchanged",
        "metadataUnchanged",
        "custodyUnchanged",
        "entityRemainsOpen",
      ]
    ) {
      requireBoolean(
        verification[field],
        true,
        `${label}.${field}`,
      );
    }

    requirePattern(
      verification.finalState,
      bytes32,
      `${label}.finalState`,
    );

    requirePattern(
      verification.finalMetadataHash,
      bytes32,
      `${label}.finalMetadataHash`,
    );

    requirePattern(
      verification.finalCustodianOrganizationId,
      bytes32,
      `${label}.finalCustodianOrganizationId`,
    );
  }

  if (
    operation.name ===
      "updateEntityState"
  ) {
    requireBoolean(
      verification.stateUpdated,
      true,
      `${label}.stateUpdated`,
    );

    requirePattern(
      verification.finalState,
      bytes32,
      `${label}.finalState`,
    );

    if (
      verification.finalState.toLowerCase() !==
      operation.newState.toLowerCase()
    ) {
      throw new Error(
        `${label}.finalState must match operation.newState.`,
      );
    }
  }

  if (
    operation.name ===
      "updateEntityMetadata"
  ) {
    requireBoolean(
      verification.metadataUpdated,
      true,
      `${label}.metadataUpdated`,
    );

    requirePattern(
      verification.finalMetadataHash,
      bytes32,
      `${label}.finalMetadataHash`,
    );

    if (
      verification.finalMetadataHash.toLowerCase() !==
      operation.newMetadataHash.toLowerCase()
    ) {
      throw new Error(
        `${label}.finalMetadataHash must match operation.newMetadataHash.`,
      );
    }
  }

  if (
    operation.name ===
      "closeEntity"
  ) {
    requireBoolean(
      verification.entityClosed,
      true,
      `${label}.entityClosed`,
    );
  }

  if (
    operation.name ===
      "createEntity"
  ) {
    requireBoolean(
      verification.entityCreated,
      true,
      `${label}.entityCreated`,
    );
  }

  if (
    operation.name ===
      "createEntityLink"
  ) {
    requireBoolean(
      verification.linkCreated,
      true,
      `${label}.linkCreated`,
    );
  }

  if (
    operation.name ===
      "setEntityLinkActive"
  ) {
    requireBoolean(
      verification.linkStatusUpdated,
      true,
      `${label}.linkStatusUpdated`,
    );

    requireBoolean(
      verification.finalLinkActive,
      operation.active,
      `${label}.finalLinkActive`,
    );
  }
}

function validateGenericProvenance(
  document,
  filename,
) {
  const root =
    requireObject(
      document,
      filename,
    );

  assertSecretFree(
    root,
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

  requireBoolean(
    root.complete,
    true,
    `${filename}.complete`,
  );

  const network =
    requireObject(
      root.network,
      `${filename}.network`,
    );

  requireInteger(
    network.chainId,
    `${filename}.network.chainId`,
    1,
  );

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

  requirePattern(
    contract.runtimeBytecodeHash,
    bytes32,
    `${filename}.contract.runtimeBytecodeHash`,
  );

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

  requirePattern(
    entity.organizationId,
    bytes32,
    `${filename}.entity.organizationId`,
  );

  requirePattern(
    entity.roleId,
    bytes32,
    `${filename}.entity.roleId`,
  );

  requirePattern(
    entity.signerAddress,
    address,
    `${filename}.entity.signerAddress`,
  );

  const operation =
    validateOperation(
      root.operation,
      `${filename}.operation`,
    );

  validateApiWrite(
    root.apiWrite,
    `${filename}.apiWrite`,
  );

  validateTransaction(
    root.transaction,
    `${filename}.transaction`,
  );

  const events =
    [];

  if (
    root.indexedEvent !==
      undefined
  ) {
    if (
      root.indexedEvents !==
        undefined
    ) {
      throw new Error(
        `${filename}: use indexedEvent or indexedEvents, not both.`,
      );
    }

    events.push(
      validateIndexedEvent(
        root.indexedEvent,
        `${filename}.indexedEvent`,
      ),
    );
  } else {
    if (
      !Array.isArray(
        root.indexedEvents,
      ) ||
      root.indexedEvents.length ===
        0
    ) {
      throw new Error(
        `${filename}: indexedEvent or non-empty indexedEvents is required.`,
      );
    }

    root.indexedEvents.forEach(
      (
        event,
        index,
      ) => {
        events.push(
          validateIndexedEvent(
            event,
            `${filename}.indexedEvents[${index}]`,
          ),
        );
      },
    );
  }

  for (
    const expected of expectedEvents[
      operation.name
    ]
  ) {
    if (
      !events.some(
        (event) =>
          event.eventName ===
          expected,
      )
    ) {
      throw new Error(
        `${filename}: expected indexed event ${expected} is missing for ${operation.name}.`,
      );
    }
  }

  validateVerification(
    root.verification,
    `${filename}.verification`,
    operation,
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
      !basename(
        filename,
      ).includes(
        "-generic-",
      )
    ) {
      if (
        genericOperations.has(
          document?.operation?.name,
        )
      ) {
        throw new Error(
          `${filename}: generic operation provenance filenames must contain "-generic-".`,
        );
      }

      continue;
    }

    validateGenericProvenance(
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
    "No generic operation provenance JSON documents were found.",
  );
}

console.log();
console.log(
  `Validated ${checked} generic operation provenance document(s).`,
);
