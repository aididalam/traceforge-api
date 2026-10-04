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
  appendRecipientSafetyChecks,
  evaluateWritePrincipalSafety,
  hasFailedChecks,
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
  toOrganizationId: string;
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

export async function registerCustodySimulationRoutes(
  app: FastifyInstance,
) {
  app.post<{
    Params: Params;
    Body: Body;
  }>(
    "/v1/tenants/:tenantId/entities/:entityId/custody/proposals/simulate",
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
            "toOrganizationId",
            "eventType",
            "evidenceHash",
          ],

          properties: {
            toOrganizationId: {
              type:
                "string",
              pattern:
                "^0x[0-9a-fA-F]{64}$",
            },

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
          "Custody simulation requires an organization-bound API token.",
        );
      }

      const {
        tenantId,
        entityId,
      } =
        request.params;

      const {
        toOrganizationId,
        eventType,
        evidenceHash,
      } =
        request.body;

      let account;

      try {
        account =
          await loadOrganizationAccount(auth.organizationId);
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

        checks.push({
          name:
            "current_custody",

          ok:
            entity.exists &&
            entity.currentCustodian.toLowerCase() ===
              auth.organizationId.toLowerCase(),

          detail:
            entity.currentCustodian,
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
            "pending_custody_absent",

          ok:
            !pendingExists,
        });

        await appendRecipientSafetyChecks({
          tenantId,
          toOrganizationId,
          checks,
        });

        checks.push({
          name:
            "recipient_differs_from_custodian",

          ok:
            toOrganizationId.toLowerCase() !==
            auth.organizationId.toLowerCase(),
        });

        if (
          hasFailedChecks(
            checks,
          ) ||
          !roleId
        ) {
          reply.code(
            409,
          );

          return {
            simulated:
              false,

            operation:
              "proposeCustodyTransfer",

            tenantId,
            entityId,

            organizationId:
              auth.organizationId,

            signerAddress:
              account.address,

            roleId,

            checks,

            error: {
              code:
                "preflight_failed",

              message:
                "One or more live-chain preflight checks failed.",
            },
          };
        }

        const args =
          [
            tenantId as Hex,
            roleId as Hex,
            entityId as Hex,
            toOrganizationId as Hex,
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
              "proposeCustodyTransfer",

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
              "proposeCustodyTransfer",

            args,

            account:
              account.address,
          });

        return {
          simulated:
            true,

          broadcast:
            false,

          operation:
            "proposeCustodyTransfer",

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

          toOrganizationId,
          eventType,
          evidenceHash,

          estimatedGas:
            estimatedGas.toString(),

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
            "proposeCustodyTransfer",

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
                : "Contract simulation failed.",
          },
        };
      }
    },
  );
}
