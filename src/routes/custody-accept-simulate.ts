import type {
  FastifyInstance,
} from "fastify";

import type {
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
  loadOrganizationAccount,
} from "../signer.js";

import {
  evaluateWritePrincipalSafety,
  hasFailedChecks,
  sameNormalized,
} from "../write-safety.js";

import type {
  WriteCheck,
} from "../write-safety.js";

import {
  traceForgeWriteAbi,
} from "../traceforge-write-abi.js";

interface Params {
  tenantId: string;
  entityId: string;
}

interface Body {
  eventType: string;
  evidenceHash: string;
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

      const checks: WriteCheck[] =
        [];

      try {
        const principalSafety =
          await evaluateWritePrincipalSafety({
            tenantId,

            organizationId:
              auth.organizationId,

            account,

            capabilityIndex:
              4,

            capabilityCheckName:
              "custody_transfer_capability",
          });

        checks.push(
          ...principalSafety.checks,
        );

        const roleId =
          principalSafety.roleId;

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
              sameNormalized(
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
              sameNormalized(
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
              !sameNormalized(
                auth.organizationId,
                entity.currentCustodian,
              ),

            detail:
              `currentCustodian=${entity.currentCustodian}`,
          });
        }

        if (
          hasFailedChecks(
            checks,
          ) ||
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
