export const traceForgeWriteAbi = [
  {
    type:
      "event",
    name:
      "CustodyTransferred",
    anonymous:
      false,
    inputs: [
      {
        indexed:
          true,
        name:
          "tenantId",
        type:
          "bytes32",
      },
      {
        indexed:
          true,
        name:
          "entityId",
        type:
          "bytes32",
      },
      {
        indexed:
          true,
        name:
          "fromOrganizationId",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "toOrganizationId",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "roleId",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "actor",
        type:
          "address",
      },
      {
        indexed:
          false,
        name:
          "eventType",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "evidenceHash",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "acceptedAt",
        type:
          "uint64",
      },
    ],
  },

  {
    type:
      "function",
    name:
      "acceptCustodyTransfer",
    stateMutability:
      "nonpayable",
    inputs: [
      {
        name:
          "tenantId",
        type:
          "bytes32",
      },
      {
        name:
          "roleId",
        type:
          "bytes32",
      },
      {
        name:
          "entityId",
        type:
          "bytes32",
      },
      {
        name:
          "eventType",
        type:
          "bytes32",
      },
      {
        name:
          "evidenceHash",
        type:
          "bytes32",
      },
    ],
    outputs: [],
  },

  {
    type:
      "function",
    name:
      "proposeCustodyTransfer",
    stateMutability:
      "nonpayable",
    inputs: [
      {
        name:
          "tenantId",
        type:
          "bytes32",
      },
      {
        name:
          "roleId",
        type:
          "bytes32",
      },
      {
        name:
          "entityId",
        type:
          "bytes32",
      },
      {
        name:
          "toOrganizationId",
        type:
          "bytes32",
      },
      {
        name:
          "eventType",
        type:
          "bytes32",
      },
      {
        name:
          "evidenceHash",
        type:
          "bytes32",
      },
    ],
    outputs: [],
  },

  {
    type:
      "event",
    name:
      "CustodyTransferProposed",
    anonymous:
      false,
    inputs: [
      {
        indexed:
          true,
        name:
          "tenantId",
        type:
          "bytes32",
      },
      {
        indexed:
          true,
        name:
          "entityId",
        type:
          "bytes32",
      },
      {
        indexed:
          true,
        name:
          "fromOrganizationId",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "toOrganizationId",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "roleId",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "actor",
        type:
          "address",
      },
      {
        indexed:
          false,
        name:
          "eventType",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "evidenceHash",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "proposedAt",
        type:
          "uint64",
      },
    ],
  },

  {
    type:
      "event",
    name:
      "TraceRecorded",
    anonymous:
      false,
    inputs: [
      {
        indexed:
          true,
        name:
          "tenantId",
        type:
          "bytes32",
      },
      {
        indexed:
          true,
        name:
          "entityId",
        type:
          "bytes32",
      },
      {
        indexed:
          true,
        name:
          "eventType",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "organizationId",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "roleId",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "actor",
        type:
          "address",
      },
      {
        indexed:
          false,
        name:
          "evidenceHash",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "stateAfter",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "metadataHashAfter",
        type:
          "bytes32",
      },
      {
        indexed:
          false,
        name:
          "timestamp",
        type:
          "uint64",
      },
    ],
  },
  {
    type:
      "function",
    name:
      "createEntity",
    stateMutability:
      "nonpayable",
    inputs: [
      { name: "tenantId", type: "bytes32" },
      { name: "roleId", type: "bytes32" },
      { name: "entityId", type: "bytes32" },
      { name: "entityType", type: "bytes32" },
      { name: "metadataHash", type: "bytes32" },
      { name: "initialState", type: "bytes32" },
    ],
    outputs: [],
  },

  {
    type:
      "function",
    name:
      "recordTrace",
    stateMutability:
      "nonpayable",
    inputs: [
      { name: "tenantId", type: "bytes32" },
      { name: "roleId", type: "bytes32" },
      { name: "entityId", type: "bytes32" },
      { name: "eventType", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },

  {
    type:
      "function",
    name:
      "updateEntityState",
    stateMutability:
      "nonpayable",
    inputs: [
      { name: "tenantId", type: "bytes32" },
      { name: "roleId", type: "bytes32" },
      { name: "entityId", type: "bytes32" },
      { name: "eventType", type: "bytes32" },
      { name: "newState", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },

  {
    type:
      "function",
    name:
      "updateEntityMetadata",
    stateMutability:
      "nonpayable",
    inputs: [
      { name: "tenantId", type: "bytes32" },
      { name: "roleId", type: "bytes32" },
      { name: "entityId", type: "bytes32" },
      { name: "eventType", type: "bytes32" },
      { name: "newMetadataHash", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },

  {
    type:
      "function",
    name:
      "createEntityLink",
    stateMutability:
      "nonpayable",
    inputs: [
      { name: "tenantId", type: "bytes32" },
      { name: "roleId", type: "bytes32" },
      { name: "sourceEntityId", type: "bytes32" },
      { name: "targetEntityId", type: "bytes32" },
      { name: "linkType", type: "bytes32" },
      { name: "eventType", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },

  {
    type:
      "function",
    name:
      "setEntityLinkActive",
    stateMutability:
      "nonpayable",
    inputs: [
      { name: "tenantId", type: "bytes32" },
      { name: "roleId", type: "bytes32" },
      { name: "sourceEntityId", type: "bytes32" },
      { name: "targetEntityId", type: "bytes32" },
      { name: "linkType", type: "bytes32" },
      { name: "active", type: "bool" },
      { name: "eventType", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },

  {
    type:
      "function",
    name:
      "closeEntity",
    stateMutability:
      "nonpayable",
    inputs: [
      { name: "tenantId", type: "bytes32" },
      { name: "roleId", type: "bytes32" },
      { name: "entityId", type: "bytes32" },
      { name: "eventType", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },

] as const;
