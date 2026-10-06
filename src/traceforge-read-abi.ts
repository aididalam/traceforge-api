// Generated from the compiled TraceForge ABI. Refresh with ops/refresh-contract-abi.py.
export const traceForgeReadAbi = [
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "BatchOperationRequired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      }
    ],
    "name": "EntityAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      }
    ],
    "name": "EntityIsClosed",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "linkId",
        "type": "bytes32"
      }
    ],
    "name": "EntityLinkAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "linkId",
        "type": "bytes32"
      }
    ],
    "name": "EntityLinkNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "linkId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "EntityLinkStatusUnchanged",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      }
    ],
    "name": "EntityMetadataUnchanged",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      }
    ],
    "name": "EntityNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "state",
        "type": "bytes32"
      }
    ],
    "name": "EntityStateUnchanged",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "requested",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "available",
        "type": "uint64"
      }
    ],
    "name": "InsufficientQuantity",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidCustodyRecipient",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidEntityId",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidEntityState",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidEntityType",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidEventType",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidEvidenceHash",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidLinkType",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidMetadataHash",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidOrganizationId",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidQuantity",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidRemovalReasonText",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidRoleId",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidRouteId",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidTenantId",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidWallet",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "enum TraceForge.Capability",
        "name": "capability",
        "type": "uint8"
      },
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "MissingCapability",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotBatchProduct",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "expectedOrganizationId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "callerOrganizationId",
        "type": "bytes32"
      }
    ],
    "name": "NotCurrentCustodian",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "routeId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "NotRouteOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "NotTenantAdmin",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "OrganizationAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "OrganizationInactive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "OrganizationNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      }
    ],
    "name": "OrganizationRoleAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      }
    ],
    "name": "OrganizationRoleNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "OwnableInvalidOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "OwnableUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OwnershipRenounceDisabled",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      }
    ],
    "name": "ProductNotFound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ProductRemovalRequired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      }
    ],
    "name": "RoleAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      }
    ],
    "name": "RoleInactive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      }
    ],
    "name": "RoleNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "routeId",
        "type": "bytes32"
      }
    ],
    "name": "RouteAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "routeId",
        "type": "bytes32"
      }
    ],
    "name": "RouteNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      }
    ],
    "name": "SelfEntityLinkNotAllowed",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "expectedVersion",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "actualVersion",
        "type": "uint64"
      }
    ],
    "name": "StaleCustody",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "routeId",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "expectedVersion",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "actualVersion",
        "type": "uint64"
      }
    ],
    "name": "StaleRoute",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      }
    ],
    "name": "TenantAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      }
    ],
    "name": "TenantInactive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "TenantMembershipAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "TenantMembershipInactive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "TenantMembershipNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      }
    ],
    "name": "TenantNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "WalletAlreadyBound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "WalletNotBound",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "sourceRouteId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "receivedRouteId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "fromOrganizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "toOrganizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "quantity",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "sourceAvailableQuantity",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "sourceForwardedQuantity",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "sourceVersion",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "timestamp",
        "type": "uint64"
      }
    ],
    "name": "BatchReceived",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "fromOrganizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "toOrganizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "custodyVersion",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "timestamp",
        "type": "uint64"
      }
    ],
    "name": "CustodyClaimed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "closedAt",
        "type": "uint64"
      }
    ],
    "name": "EntityClosed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "entityType",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "initialState",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "createdAt",
        "type": "uint64"
      }
    ],
    "name": "EntityCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "linkId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "sourceEntityId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "targetEntityId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "linkType",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "createdAt",
        "type": "uint64"
      }
    ],
    "name": "EntityLinkCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "linkId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "sourceEntityId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "targetEntityId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "linkType",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "updatedAt",
        "type": "uint64"
      }
    ],
    "name": "EntityLinkStatusChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "joinedAt",
        "type": "uint64"
      }
    ],
    "name": "OrganizationAddedToTenant",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "createdAt",
        "type": "uint64"
      }
    ],
    "name": "OrganizationRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "assignedAt",
        "type": "uint64"
      }
    ],
    "name": "OrganizationRoleAssigned",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "OrganizationRoleStatusChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "OrganizationStatusChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnershipTransferStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "rootRouteId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "registrationMetadataHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "initialQuantity",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "timestamp",
        "type": "uint64"
      }
    ],
    "name": "ProductRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "routeId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "quantity",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "enum TraceForge.RemovalReason",
        "name": "reason",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reasonText",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "routeAvailableQuantity",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "routeRemovedQuantity",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "version",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "availableQuantity",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "removedQuantity",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "timestamp",
        "type": "uint64"
      }
    ],
    "name": "QuantityRemoved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "enum TraceForge.Capability",
        "name": "capability",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "enabled",
        "type": "bool"
      }
    ],
    "name": "RoleCapabilityChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "createdAt",
        "type": "uint64"
      }
    ],
    "name": "RoleCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "RoleStatusChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "TenantAdminChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "initialAdmin",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "createdAt",
        "type": "uint64"
      }
    ],
    "name": "TenantCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "TenantMembershipStatusChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "TenantStatusChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "stateAfter",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "metadataHashAfter",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "timestamp",
        "type": "uint64"
      }
    ],
    "name": "TraceRecorded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "WalletBound",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "WalletStatusChanged",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "MAX_PRODUCT_QUANTITY",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "acceptOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "addOrganizationToTenant",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      }
    ],
    "name": "assignRoleToOrganization",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "bindWallet",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "sourceRouteId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "receivedRouteId",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "expectedVersion",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "quantity",
        "type": "uint64"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "claimBatch",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "expectedVersion",
        "type": "uint64"
      },
      {
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "claimCustody",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "closeEntity",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "sourceEntityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "targetEntityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "linkType",
        "type": "bytes32"
      }
    ],
    "name": "computeEntityLinkId",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      }
    ],
    "name": "computeRootRouteId",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      }
    ],
    "name": "createBusinessWorkspace",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityType",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "initialState",
        "type": "bytes32"
      }
    ],
    "name": "createEntity",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "sourceEntityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "targetEntityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "linkType",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "createEntityLink",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "linkId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "quantity",
        "type": "uint64"
      }
    ],
    "name": "createProduct",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      }
    ],
    "name": "createRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "initialAdmin",
        "type": "address"
      }
    ],
    "name": "createTenant",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      }
    ],
    "name": "entityExists",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "sourceEntityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "targetEntityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "linkType",
        "type": "bytes32"
      }
    ],
    "name": "entityLinkExists",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "routeId",
        "type": "bytes32"
      }
    ],
    "name": "getBatchRoute",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "organizationId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "parentRouteId",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "receivedQuantity",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "availableQuantity",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "forwardedQuantity",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "removedQuantity",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "version",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "createdAt",
            "type": "uint64"
          },
          {
            "internalType": "bool",
            "name": "exists",
            "type": "bool"
          }
        ],
        "internalType": "struct TraceForge.BatchRoute",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      }
    ],
    "name": "getCustodyVersion",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      }
    ],
    "name": "getEntity",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "entityType",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "metadataHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "currentState",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "currentCustodian",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "createdAt",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "updatedAt",
            "type": "uint64"
          },
          {
            "internalType": "bool",
            "name": "exists",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "closed",
            "type": "bool"
          }
        ],
        "internalType": "struct TraceForge.Entity",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "sourceEntityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "targetEntityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "linkType",
        "type": "bytes32"
      }
    ],
    "name": "getEntityLink",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "sourceEntityId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "targetEntityId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "linkType",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "createdAt",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "updatedAt",
            "type": "uint64"
          },
          {
            "internalType": "bool",
            "name": "exists",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "active",
            "type": "bool"
          }
        ],
        "internalType": "struct TraceForge.EntityLink",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "getOrganization",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bool",
            "name": "exists",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "active",
            "type": "bool"
          },
          {
            "internalType": "bytes32",
            "name": "metadataHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "createdAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct TraceForge.Organization",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      }
    ],
    "name": "getOrganizationRoleAssignment",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bool",
            "name": "exists",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "active",
            "type": "bool"
          },
          {
            "internalType": "uint64",
            "name": "assignedAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct TraceForge.RoleAssignment",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      }
    ],
    "name": "getProduct",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "registrationMetadataHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "originOrganizationId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "rootRouteId",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "initialQuantity",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "availableQuantity",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "removedQuantity",
            "type": "uint64"
          },
          {
            "internalType": "bool",
            "name": "exists",
            "type": "bool"
          }
        ],
        "internalType": "struct TraceForge.Product",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "enum TraceForge.RemovalReason",
        "name": "reason",
        "type": "uint8"
      }
    ],
    "name": "getRemovalTotal",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      }
    ],
    "name": "getRole",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bool",
            "name": "exists",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "active",
            "type": "bool"
          },
          {
            "internalType": "bytes32",
            "name": "metadataHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "capabilityMask",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "createdAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct TraceForge.Role",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      }
    ],
    "name": "getTenant",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bool",
            "name": "exists",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "active",
            "type": "bool"
          },
          {
            "internalType": "bytes32",
            "name": "metadataHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "createdAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct TraceForge.Tenant",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "getTenantMembership",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bool",
            "name": "exists",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "active",
            "type": "bool"
          },
          {
            "internalType": "uint64",
            "name": "joinedAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct TraceForge.TenantMembership",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getWalletBinding",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "organizationId",
            "type": "bytes32"
          },
          {
            "internalType": "bool",
            "name": "active",
            "type": "bool"
          }
        ],
        "internalType": "struct TraceForge.WalletBinding",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "enum TraceForge.Capability",
        "name": "capability",
        "type": "uint8"
      }
    ],
    "name": "hasCapability",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "isActiveTenantMember",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      }
    ],
    "name": "isActiveWalletForOrganization",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "isTenantAdmin",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingOwner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "recordTrace",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      }
    ],
    "name": "registerBusiness",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      }
    ],
    "name": "registerOrganization",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "routeId",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "quantity",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "expectedVersion",
        "type": "uint64"
      },
      {
        "internalType": "enum TraceForge.RemovalReason",
        "name": "reason",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "reasonText",
        "type": "string"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "removeProduct",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "renounceOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "enum TraceForge.Capability",
        "name": "capability",
        "type": "uint8"
      }
    ],
    "name": "roleHasCapability",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "sourceEntityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "targetEntityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "linkType",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      },
      {
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "setEntityLinkActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "setOrganizationActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "setOrganizationRoleActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "setRoleActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "enum TraceForge.Capability",
        "name": "capability",
        "type": "uint8"
      },
      {
        "internalType": "bool",
        "name": "enabled",
        "type": "bool"
      }
    ],
    "name": "setRoleCapability",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "setTenantActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "setTenantAdmin",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "organizationId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "setTenantMembershipActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "setWalletActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "newMetadataHash",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "updateEntityMetadata",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tenantId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "roleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "entityId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "eventType",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "newState",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "updateEntityState",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
