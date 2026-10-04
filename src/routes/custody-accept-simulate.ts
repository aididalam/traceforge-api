import type {
  FastifyInstance,
} from "fastify";

import type {
  RowDataPacket,
} from "mysql2";

import type {
  Address,
  Hex,
} from "viem";

import {
  authContextFor,
  requireScope,
} from "../auth.js";

import {
  asBytes32,
  chainClient,
  contractAddress,
  readTraceForge,
} from "../chain.js";

import {
  config,
} from "../config.js";

import {
  db,
} from "../db.js";

import {
  loadOrganizationAccount,
} from "../signer.js";

import {
  traceForgeWriteAbi,
} from "../traceforge-write-abi.js";

const custodyTransferCapability =
  4;

interface Params {
  tenantId: string;
  entityId: string;
}

interface Body {
  eventType: string;
  evidenceHash: string;
}

interface RoleRow
  extends RowDataPacket {
  role_id: string;
}

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

function apiError(
  code: string,
  message: string,
  extra?: Record<
    string,
    unknown
  >,
) {
  return {
    error: {
      code,
      message,
      ...extra,
    },
  };
}

function same(
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

export async function registerCustodyAcceptanceSimulationRoutes(
  app: FastifyInstance,
) {
  app.post<{
    Params: Params;
    Body: Body;
  }>(
    "/v1/tenants/:tenantId/entities/:entityId/custody/acceptances/simulate",
    {
      schema: {
        tags: [
          "chain",
          "custody",
        ],

        params: {
          type:
            "object",

          required: [
            "tenantId",
            "entityId",
          ],

          properties: {
            tenantId: {
              type:
                "string",
              pattern:
                "^0x[0-9a-fA-F]{64}$",
            },

            entityId: {
              type:
                "string",
              pattern:
                "^0x[0-9a-fA-F]{64}$",
            },
          },
        },

        body: {
          type:
            "object",

          additionalProperties:
            false,

          required: [
            "eventType",
            "evidenceHash",
          ],

          properties: {
            eventType: {
              type:
                "string",
              pattern:
                "^0x[0-9a-fA-F]{64}$",
            },

            evidenceHash: {
              type:
                "string",
              pattern:
                "^0x[0-9a-fA-F]{64}$",
            },
          },
        },
      },
    },
    async (
      request,
      reply,
    ) => {
      if (
        !requireScope(
          request,
          reply,
          "chain:write",
        )
      ) {
        return;
      }

      const auth =
        authContextFor(
          request,
        );

      if (
        !auth.organizationId
      ) {
        reply.code(
          403,
        );

        return apiError(
          "organization_binding_required",
          "Custody acceptance simulation requires an organization-bound API token.",
        );
      }

      const {
        tenantId,
        entityId,
      } =
        request.params;

      const {
        eventType,
        evidenceHash,
      } =
        request.body;

      let account;

      try {
        account =
          await loadOrganizationAccount(
            auth.organizationId,
          );
      } catch (
        error
      ) {
        request.log.error(
          error,
        );

        reply.code(
          503,
        );

        return apiError(
          "signer_unavailable",
          error instanceof Error
            ? error.message
            : "Signer is unavailable.",
        );
      }

      const checks: Check[] =
        [];

      try {
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
                auth.organizationId,
              ),
            ],
          );

        checks.push({
          name:
            "organization_active",
          ok:
            organization.exists &&
            organization.active,
        });

        const activeWallet =
          await readTraceForge(
            "isActiveWalletForOrganization",
            [
              account.address as Address,
              asBytes32(
                auth.organizationId,
              ),
            ],
          );

        checks.push({
          name:
            "signer_wallet_binding",
          ok:
            Boolean(
              activeWallet,
            ),
        });

        const membership =
          await readTraceForge(
            "isActiveTenantMember",
            [
              asBytes32(
                tenantId,
              ),
              asBytes32(
                auth.organizationId,
              ),
            ],
          );

        checks.push({
          name:
            "tenant_membership",
          ok:
            Boolean(
              membership,
            ),
        });

        const entity =
          await readTraceForge(
            "getEntity",
            [
              asBytes32(
                tenantId,
              ),
              asBytes32(
                entityId,
              ),
            ],
          );

        checks.push({
          name:
            "entity_exists",
          ok:
            entity.exists,
        });

        checks.push({
          name:
            "entity_open",
          ok:
            entity.exists &&
            !entity.closed,
        });

        const pendingExists =
          await readTraceForge(
            "hasPendingCustodyTransfer",
            [
              asBytes32(
                tenantId,
              ),
              asBytes32(
                entityId,
              ),
            ],
          );

        checks.push({
          name:
            "pending_custody_exists",
          ok:
            Boolean(
              pendingExists,
            ),
        });

        let pending: any =
          null;

        if (
          pendingExists
        ) {
          pending =
            await readTraceForge(
              "getPendingCustodyTransfer",
              [
                asBytes32(
                  tenantId,
                ),
                asBytes32(
                  entityId,
                ),
              ],
            );

          checks.push({
            name:
              "pending_recipient",
            ok:
              same(
                pending.toOrganizationId,
                auth.organizationId,
              ),
            detail:
              `toOrganizationId=${pending.toOrganizationId}`,
          });

          checks.push({
            name:
              "pending_source_matches_current_custody",
            ok:
              entity.exists &&
              same(
                pending.fromOrganizationId,
                entity.currentCustodian,
              ),
            detail:
              `from=${pending.fromOrganizationId} current=${entity.currentCustodian}`,
          });

          checks.push({
            name:
              "recipient_not_current_custodian",
            ok:
              entity.exists &&
              !same(
                auth.organizationId,
                entity.currentCustodian,
              ),
            detail:
              `currentCustodian=${entity.currentCustodian}`,
          });
        }

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
              auth.organizationId,
            ],
          );

        let roleId:
          string | null =
            null;

        for (
          const role of roleRows
        ) {
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
                custodyTransferCapability,
              ],
            );

          if (
            allowed
          ) {
            roleId =
              role.role_id;

            break;
          }
        }

        checks.push({
          name:
            "custody_transfer_capability",
          ok:
            roleId !==
            null,
          detail:
            roleId ??
            `checkedRoles=${roleRows.length}`,
        });

        const failed =
          checks.filter(
            (check) =>
              !check.ok,
          );

        if (
          failed.length >
            0 ||
          !roleId ||
          !pending
        ) {
          reply.code(
            409,
          );

          return {
            simulated:
              false,

            broadcast:
              false,

            operation:
              "acceptCustodyTransfer",

            tenantId,
            entityId,

            organizationId:
              auth.organizationId,

            signerAddress:
              account.address,

            roleId,

            pendingCustody:
              pending,

            checks,

            error: {
              code:
                "preflight_failed",

              message:
                "One or more live-chain custody acceptance checks failed.",
            },
          };
        }

        const args =
          [
            tenantId as Hex,
            roleId as Hex,
            entityId as Hex,
            eventType as Hex,
            evidenceHash as Hex,
          ] as const;

        const simulation =
          await chainClient.simulateContract({
            address:
              contractAddress,

            abi:
              traceForgeWriteAbi,

            functionName:
              "acceptCustodyTransfer",

            args,

            account,
          });

        const estimatedGas =
          await chainClient.estimateContractGas({
            address:
              contractAddress,

            abi:
              traceForgeWriteAbi,

            functionName:
              "acceptCustodyTransfer",

            args,

            account:
              account.address,

            gasPrice:
              0n,
          });

        return {
          simulated:
            true,

          broadcast:
            false,

          operation:
            "acceptCustodyTransfer",

          chainId:
            config.traceforge.chainId,

          contractAddress,

          tenantId,
          entityId,

          organizationId:
            auth.organizationId,

          signerAddress:
            account.address,

          roleId,

          eventType,
          evidenceHash,

          estimatedGas:
            estimatedGas.toString(),

          pendingCustody: {
            exists:
              true,

            fromOrganizationId:
              pending.fromOrganizationId,

            toOrganizationId:
              pending.toOrganizationId,

            proposedBy:
              pending.proposedBy,

            proposedAt:
              String(
                pending.proposedAt,
              ),
          },

          currentCustodian:
            entity.currentCustodian,

          request: {
            to:
              simulation.request.address,

            functionName:
              simulation.request.functionName,
          },

          checks,
        };
      } catch (
        error
      ) {
        request.log.error(
          error,
        );

        reply.code(
          409,
        );

        return {
          simulated:
            false,

          broadcast:
            false,

          operation:
            "acceptCustodyTransfer",

          tenantId,
          entityId,

          organizationId:
            auth.organizationId,

          signerAddress:
            account.address,

          checks,

          error: {
            code:
              "simulation_failed",

            message:
              error instanceof Error
                ? error.message
                : "Custody acceptance simulation failed.",
          },
        };
      }
    },
  );
}
