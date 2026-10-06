import {
  createPublicClient,
  http,
} from "viem";

import type {
  Address,
  Hex,
} from "viem";

import {
  config,
} from "./config.js";

import {
  traceForgeReadAbi,
} from "./traceforge-read-abi.js";

export const chainClient =
  createPublicClient({
    transport:
      http(
        config.traceforge.rpcUrl,
      ),
  });

export const contractAddress =
  config.traceforge.contractAddress as Address;

export async function readTraceForge(
  functionName:
    | "getTenant"
    | "getOrganization"
    | "getWalletBinding"
    | "isActiveWalletForOrganization"
    | "getTenantMembership"
    | "isActiveTenantMember"
    | "hasCapability"
    | "entityExists"
    | "getEntity"
    | "getCustodyVersion"
    | "getProduct"
    | "getBatchRoute"
    | "getRemovalTotal",
  args: readonly unknown[],
): Promise<any> {
  return chainClient.readContract({
    address:
      contractAddress,

    abi:
      traceForgeReadAbi,

    functionName:
      functionName as any,

    args:
      args as any,
  } as any);
}

export function asBytes32(
  value: string,
): Hex {
  return value as Hex;
}
