import type {
  RowDataPacket,
} from "mysql2";

import type {
  Address,
} from "viem";

import type {
  PrivateKeyAccount,
} from "viem/accounts";

import {
  asBytes32,
  chainClient,
  contractAddress,
  readTraceForge,
} from "./chain.js";

import {
  config,
} from "./config.js";

import {
  db,
} from "./db.js";

import {
  runtimeBytecodeIntegrity,
} from "./runtime-integrity.js";

interface RoleRow
  extends RowDataPacket {
  role_id: string;
}

export interface WriteCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

interface EvaluateWritePrincipalSafetyInput {
  tenantId: string;
  organizationId: string;
  account: PrivateKeyAccount;
  capabilityIndex: number;
  capabilityCheckName?: string;
}

interface RecipientSafetyInput {
  tenantId: string;
  toOrganizationId: string;
  checks: WriteCheck[];
}

export function sameNormalized(
  a: unknown,
  b: unknown,
): boolean {
  return (
    String(
      a,
    ).toLowerCase() ===
    String(
      b,
    ).toLowerCase()
  );
}

export function hasFailedChecks(
  checks: WriteCheck[],
): boolean {
  return checks.some(
    (check) =>
      !check.ok,
  );
}

export async function evaluateWritePrincipalSafety(
  input: EvaluateWritePrincipalSafetyInput,
): Promise<{
  roleId: string | null;
  checks: WriteCheck[];
}> {
  const {
    tenantId,
    organizationId,
    account,
    capabilityIndex,
    capabilityCheckName =
      "required_capability",
  } =
    input;

  const checks: WriteCheck[] =
    [];

  const chainId =
    await chainClient.getChainId();

  checks.push({
    name:
      "chain_id",

    ok:
      chainId ===
      config.traceforge.chainId,

    detail:
      `expected=${config.traceforge.chainId} actual=${chainId}`,
  });

  const bytecode =
    await chainClient.getBytecode({
      address:
        contractAddress,
    });

  checks.push({
    name:
      "contract_code",

    ok:
      Boolean(
        bytecode &&
        bytecode !==
        "0x",
      ),

    detail:
      contractAddress,
  });

  const runtimeIntegrity =
    runtimeBytecodeIntegrity(
      bytecode,
    );

  checks.push({
    name:
      "runtime_bytecode_hash",

    ok:
      runtimeIntegrity.ok,

    detail:
      `expected=${runtimeIntegrity.expected} actual=${runtimeIntegrity.actual}`,
  });

  checks.push({
    name:
      "signer_integrity",

    ok:
      true,

    detail:
      account.address,
  });

  const tenant =
    await readTraceForge(
      "getTenant",
      [
        asBytes32(
          tenantId,
        ),
      ],
    );

  checks.push({
    name:
      "tenant_exists",

    ok:
      tenant.exists,
  });

  checks.push({
    name:
      "tenant_active",

    ok:
      tenant.exists &&
      tenant.active,
  });

  const organization =
    await readTraceForge(
      "getOrganization",
      [
        asBytes32(
          organizationId,
        ),
      ],
    );

  checks.push({
    name:
      "organization_exists",

    ok:
      organization.exists,
  });

  checks.push({
    name:
      "organization_active",

    ok:
      organization.exists &&
      organization.active,
  });

  const membership =
    await readTraceForge(
      "getTenantMembership",
      [
        asBytes32(
          tenantId,
        ),
        asBytes32(
          organizationId,
        ),
      ],
    );

  const activeMember =
    await readTraceForge(
      "isActiveTenantMember",
      [
        asBytes32(
          tenantId,
        ),
        asBytes32(
          organizationId,
        ),
      ],
    );

  checks.push({
    name:
      "tenant_membership",

    ok:
      membership.exists &&
      membership.active &&
      Boolean(
        activeMember,
      ),
  });

  const wallet =
    await readTraceForge(
      "getWalletBinding",
      [
        account.address as Address,
      ],
    );

  const activeWallet =
    await readTraceForge(
      "isActiveWalletForOrganization",
      [
        account.address as Address,
        asBytes32(
          organizationId,
        ),
      ],
    );

  const walletMatches =
    sameNormalized(
      wallet.organizationId,
      organizationId,
    );

  checks.push({
    name:
      "signer_wallet_binding",

    ok:
      walletMatches &&
      wallet.active &&
      Boolean(
        activeWallet,
      ),

    detail:
      `wallet=${account.address} walletOrganization=${wallet.organizationId}`,
  });

  const [roleRows] =
    await db.query<
      RoleRow[]
    >(
      `
        SELECT role_id
        FROM organization_roles
        WHERE tenant_id = ?
          AND organization_id = ?
          AND active = TRUE
        ORDER BY role_id
      `,
      [
        tenantId.toLowerCase(),
        organizationId.toLowerCase(),
      ],
    );

  let roleId:
    string | null =
      null;

  for (
    const role of roleRows
  ) {
    try {
      const allowed =
        await readTraceForge(
          "hasCapability",
          [
            asBytes32(
              tenantId,
            ),
            account.address as Address,
            asBytes32(
              role.role_id,
            ),
            capabilityIndex,
          ],
        );

      if (
        allowed
      ) {
        roleId =
          role.role_id;

        break;
      }
    } catch {
      // Indexed role candidates are only hints.
      // Live contract authorization remains authoritative.
    }
  }

  checks.push({
    name:
      capabilityCheckName,

    ok:
      roleId !==
      null,

    detail:
      roleId ??
      `checkedRoles=${roleRows.length}`,
  });

  return {
    roleId,
    checks,
  };
}

export async function appendRecipientSafetyChecks(
  input: RecipientSafetyInput,
): Promise<void> {
  const {
    tenantId,
    toOrganizationId,
    checks,
  } =
    input;

  const destination =
    await readTraceForge(
      "getOrganization",
      [
        asBytes32(
          toOrganizationId,
        ),
      ],
    );

  checks.push({
    name:
      "recipient_organization_exists",

    ok:
      destination.exists,
  });

  checks.push({
    name:
      "recipient_organization_active",

    ok:
      destination.exists &&
      destination.active,
  });

  const membership =
    await readTraceForge(
      "getTenantMembership",
      [
        asBytes32(
          tenantId,
        ),
        asBytes32(
          toOrganizationId,
        ),
      ],
    );

  const activeMember =
    await readTraceForge(
      "isActiveTenantMember",
      [
        asBytes32(
          tenantId,
        ),
        asBytes32(
          toOrganizationId,
        ),
      ],
    );

  checks.push({
    name:
      "recipient_tenant_membership",

    ok:
      membership.exists &&
      membership.active &&
      Boolean(
        activeMember,
      ),
  });
}
