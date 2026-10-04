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
  readTraceForge,
} from "../chain.js";

import {
  loadOrganizationAccount,
} from "../signer.js";

import {
  evaluateWritePrincipalSafety,
} from "../write-safety.js";

import type {
  WriteCheck,
} from "../write-safety.js";

const capabilityIndexes = {
  ENTITY_CREATE: 0,
  TRACE_RECORD: 1,
  STATE_UPDATE: 2,
  METADATA_UPDATE: 3,
  CUSTODY_TRANSFER: 4,
  ENTITY_LINK: 5,
  ENTITY_CLOSE: 6,
} as const;

type CapabilityName =
  keyof typeof capabilityIndexes;

type PendingCustodyMode =
  | "ignore"
  | "required"
  | "forbidden";

interface Query {
  capability?: string;
  entityId?: string;
  requireCustody?: string;
  pendingCustody?: string;
}

function apiError(
  code: string,
  message: string,
) {
  return {
    error: {
      code,
      message,
    },
  };
}

function boolQuery(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (
    value === undefined
  ) {
    return defaultValue;
  }

  if (
    value === "true"
  ) {
    return true;
  }

  if (
    value === "false"
  ) {
    return false;
  }

  throw new Error(
    "Boolean query values must be true or false.",
  );
}

function capabilityName(
  value: string | undefined,
): CapabilityName {
  if (
    !value ||
    !(value in capabilityIndexes)
  ) {
    throw new Error(
      "capability must be one of ENTITY_CREATE, TRACE_RECORD, STATE_UPDATE, METADATA_UPDATE, CUSTODY_TRANSFER, ENTITY_LINK, ENTITY_CLOSE",
    );
  }

  return value as CapabilityName;
}

function pendingMode(
  value: string | undefined,
): PendingCustodyMode {
  if (
    value === undefined
  ) {
    return "ignore";
  }

  if (
    value === "ignore" ||
    value === "required" ||
    value === "forbidden"
  ) {
    return value;
  }

  throw new Error(
    "pendingCustody must be ignore, required, or forbidden",
  );
}

function bytes32OrNull(
  value: string | undefined,
): Hex | null {
  if (
    value === undefined
  ) {
    return null;
  }

  if (
    !/^0x[0-9a-fA-F]{64}$/.test(
      value,
    )
  ) {
    throw new Error(
      "entityId must be a bytes32 hex value",
    );
  }

  return value.toLowerCase() as Hex;
}

export async function registerPreflightRoutes(
  app: FastifyInstance,
) {
  app.get<{
    Querystring: Query;
  }>(
    "/v1/auth/preflight",
    {
      schema: {
        tags: [
          "auth",
          "chain",
        ],

        querystring: {
          type:
            "object",

          required: [
            "capability",
          ],

          properties: {
            capability: {
              type:
                "string",
            },

            entityId: {
              type:
                "string",
              pattern:
                "^0x[0-9a-fA-F]{64}$",
            },

            requireCustody: {
              type:
                "string",
            },

            pendingCustody: {
              type:
                "string",
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
          "chain:write preflight requires an organization-bound API token.",
        );
      }

      let capability: CapabilityName;
      let entityId: Hex | null;
      let requireCustody: boolean;
      let custodyMode:
        PendingCustodyMode;

      try {
        capability =
          capabilityName(
            request.query.capability,
          );

        entityId =
          bytes32OrNull(
            request.query.entityId,
          );

        requireCustody =
          boolQuery(
            request.query.requireCustody,
            false,
          );

        custodyMode =
          pendingMode(
            request.query.pendingCustody,
          );
      } catch (
        error
      ) {
        reply.code(
          400,
        );

        return apiError(
          "invalid_preflight_request",
          error instanceof Error
            ? error.message
            : "Invalid preflight request.",
        );
      }

      if (
        (
          requireCustody ||
          custodyMode !==
            "ignore"
        ) &&
        !entityId
      ) {
        reply.code(
          400,
        );

        return apiError(
          "entity_required",
          "entityId is required for custody or pending-custody checks.",
        );
      }

      const checks: WriteCheck[] =
        [];

      let account;

      try {
        account =
          await loadOrganizationAccount(
            auth.organizationId,
          );

        checks.push({
          name:
            "signer_configured",

          ok:
            true,

          detail:
            account.address,
        });
      } catch (
        error
      ) {
        request.log.error(
          error,
        );

        checks.push({
          name:
            "signer_configured",

          ok:
            false,

          detail:
            error instanceof Error
              ? error.message
              : "Signer is unavailable.",
        });

        return {
          ready:
            false,

          capability,

          capabilityIndex:
            capabilityIndexes[
              capability
            ],

          tenantId:
            auth.tenantId,

          organizationId:
            auth.organizationId,

          signerAddress:
            null,

          authorizedRoleId:
            null,

          checks,
        };
      }

      const signerAddress =
        account.address;

      try {
        const principalSafety =
          await evaluateWritePrincipalSafety({
            tenantId:
              auth.tenantId,

            organizationId:
              auth.organizationId,

            account,

            capabilityIndex:
              capabilityIndexes[
                capability
              ],

            capabilityCheckName:
              "required_capability",
          });

        checks.push(
          ...principalSafety.checks,
        );

        const authorizedRoleId =
          principalSafety.roleId;

        let entity:
          any =
            null;

        let pending:
          any =
            null;

        if (
          entityId
        ) {
          const entityResult =
            await readTraceForge(
              "getEntity",
              [
                asBytes32(
                  auth.tenantId,
                ),
                entityId,
              ],
            );

          entity =
            entityResult;

          checks.push({
            name:
              "entity_exists",
            ok:
              entityResult.exists,
          });

          checks.push({
            name:
              "entity_open",
            ok:
              entityResult.exists &&
              !entityResult.closed,
          });

          if (
            requireCustody
          ) {
            checks.push({
              name:
                "current_custody",
              ok:
                entityResult.exists &&
                entityResult.currentCustodian.toLowerCase() ===
                  auth.organizationId.toLowerCase(),
              detail:
                `currentCustodian=${entityResult.currentCustodian}`,
            });
          }

          if (
            custodyMode !==
            "ignore"
          ) {
            const pendingExists =
              await readTraceForge(
                "hasPendingCustodyTransfer",
                [
                  asBytes32(
                    auth.tenantId,
                  ),
                  entityId,
                ],
              );

            if (
              pendingExists
            ) {
              pending =
                await readTraceForge(
                  "getPendingCustodyTransfer",
                  [
                    asBytes32(
                      auth.tenantId,
                    ),
                    entityId,
                  ],
                );
            }

            checks.push({
              name:
                "pending_custody",
              ok:
                custodyMode ===
                "required"
                  ? Boolean(
                      pendingExists,
                    )
                  : !pendingExists,
              detail:
                `mode=${custodyMode} exists=${pendingExists}`,
            });
          }
        }

        const ready =
          checks.every(
            (check) =>
              check.ok,
          );

        return {
          ready,
          capability,
          capabilityIndex:
            capabilityIndexes[
              capability
            ],

          tenantId:
            auth.tenantId,

          organizationId:
            auth.organizationId,

          signerAddress,

          authorizedRoleId,

          entityId,

          entity:
            entity
              ? {
                  exists:
                    "exists" in entity
                      ? entity.exists
                      : false,
                  closed:
                    "closed" in entity
                      ? entity.closed
                      : null,
                  currentCustodian:
                    "currentCustodian" in entity
                      ? entity.currentCustodian
                      : null,
                }
              : null,

          pendingCustody:
            pending &&
            "exists" in pending
              ? {
                  exists:
                    pending.exists,
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
                }
              : null,

          checks,
        };
      } catch (
        error
      ) {
        request.log.error(
          error,
        );

        checks.push({
          name:
            "chain_rpc",
          ok:
            false,
          detail:
            error instanceof Error
              ? error.message
              : "Unknown chain RPC error.",
        });

        return {
          ready:
            false,
          capability,
          capabilityIndex:
            capabilityIndexes[
              capability
            ],
          tenantId:
            auth.tenantId,
          organizationId:
            auth.organizationId,
          signerAddress,
          authorizedRoleId:
            null,
          checks,
        };
      }
    },
  );
}
