import {
  asBytes32,
  chainClient,
  contractAddress,
} from "./chain.js";

const getEntityLinkAbi = (
  [
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
  }
]
) as const;

export async function readEntityLink(
  tenantId: string,
  sourceEntityId: string,
  targetEntityId: string,
  linkType: string,
) {
  return chainClient.readContract({
    address:
      contractAddress,

    abi:
      getEntityLinkAbi,

    functionName:
      "getEntityLink",

    args: [
      asBytes32(
        tenantId,
      ),
      asBytes32(
        sourceEntityId,
      ),
      asBytes32(
        targetEntityId,
      ),
      asBytes32(
        linkType,
      ),
    ],
  });
}
