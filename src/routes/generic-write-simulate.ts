import type {
  FastifyInstance,
} from "fastify";

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
} from "../write-safety.js";

import type {
  WriteCheck,
} from "../write-safety.js";

import {
  traceForgeWriteAbi,
} from "../traceforge-write-abi.js";

const bytes32Schema = {
  type:
    "string",
  pattern:
    "^0x[0-9a-fA-F]{64}$",
} as const;

interface MutationSpec {
  path: string;
  operation: string;
  capabilityIndex: number;
  capabilityCheckName: string;
  bodySchema: Record<
    string,
    unknown
  >;
  prepareChecks: (
    tenantId: string,
    entityId: string,
    body: Record<
      string,
      unknown
    >,
    checks: WriteCheck[],
  ) => Promise<
    Record<
      string,
      unknown
    >
  >;
  buildArgs: (
    tenantId: string,
    roleId: string,
    entityId: string,
    body: Record<
      string,
      unknown
    >,
  ) => readonly unknown[];
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

async function existingOpenEntityChecks(
  tenantId: string,
  entityId: string,
  checks: WriteCheck[],
) {
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

  return entity;
}

async function createChecks(
  tenantId: string,
  entityId: string,
  _body: Record<
    string,
    unknown
  >,
  checks: WriteCheck[],
) {
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
      "entity_absent",
    ok:
      !entity.exists,
  });

  return {
    existingEntity:
      entity.exists,
  };
}

async function entityChecks(
  tenantId: string,
  entityId: string,
  _body: Record<
    string,
    unknown
  >,
  checks: WriteCheck[],
) {
  const entity =
    await existingOpenEntityChecks(
      tenantId,
      entityId,
      checks,
    );

  return {
    currentCustodian:
      entity.currentCustodian,
    currentState:
      entity.currentState,
    metadataHash:
      entity.metadataHash,
    closed:
      entity.closed,
  };
}

async function linkChecks(
  tenantId: string,
  entityId: string,
  body: Record<
    string,
    unknown
  >,
  checks: WriteCheck[],
) {
  const source =
    await existingOpenEntityChecks(
      tenantId,
      entityId,
      checks,
    );

  const targetEntityId =
    String(
      body.targetEntityId,
    );

  const target =
    await readTraceForge(
      "getEntity",
      [
        asBytes32(
          tenantId,
        ),
        asBytes32(
          targetEntityId,
        ),
      ],
    );

  checks.push({
    name:
      "target_entity_exists",
    ok:
      target.exists,
  });

  checks.push({
    name:
      "target_entity_open",
    ok:
      target.exists &&
      !target.closed,
  });

  checks.push({
    name:
      "distinct_entities",
    ok:
      entityId.toLowerCase() !==
      targetEntityId.toLowerCase(),
  });

  return {
    sourceCustodian:
      source.currentCustodian,
    targetEntityId,
    targetCustodian:
      target.currentCustodian,
  };
}

async function closeChecks(
  tenantId: string,
  entityId: string,
  body: Record<
    string,
    unknown
  >,
  checks: WriteCheck[],
) {
  const context =
    await entityChecks(
      tenantId,
      entityId,
      body,
      checks,
    );

  const pending =
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
      "pending_custody_forbidden",
    ok:
      !pending,
  });

  return {
    ...context,
    pendingCustody:
      Boolean(
        pending,
      ),
  };
}

const mutationSpecs:
MutationSpec[] = [
  {
    path:
      "/v1/tenants/:tenantId/entities/:entityId/create/simulate",

    operation:
      "createEntity",

    capabilityIndex:
      0,

    capabilityCheckName:
      "entity_create_capability",

    bodySchema: {
      type:
        "object",

      additionalProperties:
        false,

      required: [
        "entityType",
        "metadataHash",
        "initialState",
      ],

      properties: {
        entityType:
          bytes32Schema,

        metadataHash:
          bytes32Schema,

        initialState:
          bytes32Schema,
      },
    },

    prepareChecks:
      createChecks,

    buildArgs: (
      tenantId,
      roleId,
      entityId,
      body,
    ) => [
      asBytes32(
        tenantId,
      ),
      asBytes32(
        roleId,
      ),
      asBytes32(
        entityId,
      ),
      asBytes32(
        String(
          body.entityType,
        ),
      ),
      asBytes32(
        String(
          body.metadataHash,
        ),
      ),
      asBytes32(
        String(
          body.initialState,
        ),
      ),
    ],
  },

  {
    path:
      "/v1/tenants/:tenantId/entities/:entityId/traces/simulate",

    operation:
      "recordTrace",

    capabilityIndex:
      1,

    capabilityCheckName:
      "trace_record_capability",

    bodySchema: {
      type:
        "object",

      additionalProperties:
        false,

      required: [
        "eventType",
        "evidenceHash",
      ],

      properties: {
        eventType:
          bytes32Schema,

        evidenceHash:
          bytes32Schema,
      },
    },

    prepareChecks:
      entityChecks,

    buildArgs: (
      tenantId,
      roleId,
      entityId,
      body,
    ) => [
      asBytes32(
        tenantId,
      ),
      asBytes32(
        roleId,
      ),
      asBytes32(
        entityId,
      ),
      asBytes32(
        String(
          body.eventType,
        ),
      ),
      asBytes32(
        String(
          body.evidenceHash,
        ),
      ),
    ],
  },

  {
    path:
      "/v1/tenants/:tenantId/entities/:entityId/state/simulate",

    operation:
      "updateEntityState",

    capabilityIndex:
      2,

    capabilityCheckName:
      "state_update_capability",

    bodySchema: {
      type:
        "object",

      additionalProperties:
        false,

      required: [
        "eventType",
        "newState",
        "evidenceHash",
      ],

      properties: {
        eventType:
          bytes32Schema,

        newState:
          bytes32Schema,

        evidenceHash:
          bytes32Schema,
      },
    },

    prepareChecks:
      entityChecks,

    buildArgs: (
      tenantId,
      roleId,
      entityId,
      body,
    ) => [
      asBytes32(
        tenantId,
      ),
      asBytes32(
        roleId,
      ),
      asBytes32(
        entityId,
      ),
      asBytes32(
        String(
          body.eventType,
        ),
      ),
      asBytes32(
        String(
          body.newState,
        ),
      ),
      asBytes32(
        String(
          body.evidenceHash,
        ),
      ),
    ],
  },

  {
    path:
      "/v1/tenants/:tenantId/entities/:entityId/metadata/simulate",

    operation:
      "updateEntityMetadata",

    capabilityIndex:
      3,

    capabilityCheckName:
      "metadata_update_capability",

    bodySchema: {
      type:
        "object",

      additionalProperties:
        false,

      required: [
        "eventType",
        "newMetadataHash",
        "evidenceHash",
      ],

      properties: {
        eventType:
          bytes32Schema,

        newMetadataHash:
          bytes32Schema,

        evidenceHash:
          bytes32Schema,
      },
    },

    prepareChecks:
      entityChecks,

    buildArgs: (
      tenantId,
      roleId,
      entityId,
      body,
    ) => [
      asBytes32(
        tenantId,
      ),
      asBytes32(
        roleId,
      ),
      asBytes32(
        entityId,
      ),
      asBytes32(
        String(
          body.eventType,
        ),
      ),
      asBytes32(
        String(
          body.newMetadataHash,
        ),
      ),
      asBytes32(
        String(
          body.evidenceHash,
        ),
      ),
    ],
  },

  {
    path:
      "/v1/tenants/:tenantId/entities/:entityId/links/simulate",

    operation:
      "createEntityLink",

    capabilityIndex:
      5,

    capabilityCheckName:
      "entity_link_capability",

    bodySchema: {
      type:
        "object",

      additionalProperties:
        false,

      required: [
        "targetEntityId",
        "linkType",
        "eventType",
        "evidenceHash",
      ],

      properties: {
        targetEntityId:
          bytes32Schema,

        linkType:
          bytes32Schema,

        eventType:
          bytes32Schema,

        evidenceHash:
          bytes32Schema,
      },
    },

    prepareChecks:
      linkChecks,

    buildArgs: (
      tenantId,
      roleId,
      entityId,
      body,
    ) => [
      asBytes32(
        tenantId,
      ),
      asBytes32(
        roleId,
      ),
      asBytes32(
        entityId,
      ),
      asBytes32(
        String(
          body.targetEntityId,
        ),
      ),
      asBytes32(
        String(
          body.linkType,
        ),
      ),
      asBytes32(
        String(
          body.eventType,
        ),
      ),
      asBytes32(
        String(
          body.evidenceHash,
        ),
      ),
    ],
  },

  {
    path:
      "/v1/tenants/:tenantId/entities/:entityId/links/status/simulate",

    operation:
      "setEntityLinkActive",

    capabilityIndex:
      5,

    capabilityCheckName:
      "entity_link_capability",

    bodySchema: {
      type:
        "object",

      additionalProperties:
        false,

      required: [
        "targetEntityId",
        "linkType",
        "active",
        "eventType",
        "evidenceHash",
      ],

      properties: {
        targetEntityId:
          bytes32Schema,

        linkType:
          bytes32Schema,

        active: {
          type:
            "boolean",
        },

        eventType:
          bytes32Schema,

        evidenceHash:
          bytes32Schema,
      },
    },

    prepareChecks:
      linkChecks,

    buildArgs: (
      tenantId,
      roleId,
      entityId,
      body,
    ) => [
      asBytes32(
        tenantId,
      ),
      asBytes32(
        roleId,
      ),
      asBytes32(
        entityId,
      ),
      asBytes32(
        String(
          body.targetEntityId,
        ),
      ),
      asBytes32(
        String(
          body.linkType,
        ),
      ),
      Boolean(
        body.active,
      ),
      asBytes32(
        String(
          body.eventType,
        ),
      ),
      asBytes32(
        String(
          body.evidenceHash,
        ),
      ),
    ],
  },

  {
    path:
      "/v1/tenants/:tenantId/entities/:entityId/close/simulate",

    operation:
      "closeEntity",

    capabilityIndex:
      6,

    capabilityCheckName:
      "entity_close_capability",

    bodySchema: {
      type:
        "object",

      additionalProperties:
        false,

      required: [
        "eventType",
        "evidenceHash",
      ],

      properties: {
        eventType:
          bytes32Schema,

        evidenceHash:
          bytes32Schema,
      },
    },

    prepareChecks:
      closeChecks,

    buildArgs: (
      tenantId,
      roleId,
      entityId,
      body,
    ) => [
      asBytes32(
        tenantId,
      ),
      asBytes32(
        roleId,
      ),
      asBytes32(
        entityId,
      ),
      asBytes32(
        String(
          body.eventType,
        ),
      ),
      asBytes32(
        String(
          body.evidenceHash,
        ),
      ),
    ],
  },
];

export async function registerGenericWriteSimulationRoutes(
  app: FastifyInstance,
) {
  for (
    const spec of mutationSpecs
  ) {
    app.post(
      spec.path,
      {
        schema: {
          tags: [
            "chain",
            "write",
            "simulation",
          ],

          params: {
            type:
              "object",

            required: [
              "tenantId",
              "entityId",
            ],

            properties: {
              tenantId:
                bytes32Schema,

              entityId:
                bytes32Schema,
            },
          },

          body:
            spec.bodySchema,
        },
      },
      async (
        request: any,
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
            "Generic write simulation requires an organization-bound API token.",
          );
        }

        const {
          tenantId,
          entityId,
        } =
          request.params as {
            tenantId: string;
            entityId: string;
          };

        const body =
          request.body as Record<
            string,
            unknown
          >;

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

        const checks:
          WriteCheck[] =
            [];

        try {
          const principal =
            await evaluateWritePrincipalSafety({
              tenantId,

              organizationId:
                auth.organizationId,

              account,

              capabilityIndex:
                spec.capabilityIndex,

              capabilityCheckName:
                spec.capabilityCheckName,
            });

          checks.push(
            ...principal.checks,
          );

          const roleId =
            principal.roleId;

          const context =
            await spec.prepareChecks(
              tenantId,
              entityId,
              body,
              checks,
            );

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

              broadcast:
                false,

              operation:
                spec.operation,

              tenantId,
              entityId,

              organizationId:
                auth.organizationId,

              signerAddress:
                account.address,

              roleId,

              inputs:
                body,

              context,
              checks,

              error: {
                code:
                  "preflight_failed",

                message:
                  "One or more live-chain generic write checks failed.",
              },
            };
          }

          const args =
            spec.buildArgs(
              tenantId,
              roleId,
              entityId,
              body,
            );

          const simulation =
            await chainClient.simulateContract({
              address:
                contractAddress,

              abi:
                traceForgeWriteAbi as any,

              functionName:
                spec.operation as any,

              args:
                args as any,

              account,
            } as any);

          const estimatedGas =
            await chainClient.estimateContractGas({
              address:
                contractAddress,

              abi:
                traceForgeWriteAbi as any,

              functionName:
                spec.operation as any,

              args:
                args as any,

              account:
                account.address,

              gasPrice:
                0n,
            } as any);

          return {
            simulated:
              true,

            broadcast:
              false,

            operation:
              spec.operation,

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

            inputs:
              body,

            context,

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
              spec.operation,

            tenantId,
            entityId,

            organizationId:
              auth.organizationId,

            signerAddress:
              account.address,

            inputs:
              body,

            checks,

            error: {
              code:
                "simulation_failed",

              message:
                error instanceof Error
                  ? error.message
                  : "Generic write simulation failed.",
            },
          };
        }
      },
    );
  }
}
