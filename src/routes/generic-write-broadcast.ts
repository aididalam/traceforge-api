import {feePlan,requireGasBalance,policy,TransactionPolicyError} from '../transaction-policy.js';
import {
  randomUUID,
} from "node:crypto";

import type {
  FastifyInstance,
} from "fastify";

import {
  encodeFunctionData,
  keccak256,
} from "viem";

import type {
  Hex,
} from "viem";

import {
  authContextFor,
  requireScope,
} from "../auth.js";

import {
  chainClient,
  contractAddress,
} from "../chain.js";

import {
  config,
} from "../config.js";

import {
  genericMutationSpecs,
} from "./generic-write-simulate.js";

import {
  finalizeGenericWriteReceipt,
} from "../generic-write-receipt.js";

import {
  loadOrganizationAccount,
} from "../signer.js";

import {
  traceForgeWriteAbi,
} from "../traceforge-write-abi.js";

import {
  evaluateWritePrincipalSafety,
  hasFailedChecks,
} from "../write-safety.js";

import type {
  WriteCheck,
} from "../write-safety.js";

import {
  canonicalRequestHash,
  getWriteOperation,
  insertPreparedWriteOperation,
  markWriteOperationBroadcast,
  recordWriteOperationError,
  requestIdempotencyKey,
} from "../write-journal.js";

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

function normalizeValue(
  value: unknown,
): unknown {
  if (
    typeof value ===
    "string"
  ) {
    if (
      /^0x[0-9a-fA-F]+$/.test(
        value,
      )
    ) {
      return value.toLowerCase();
    }

    return value;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      normalizeValue,
    );
  }

  if (
    value &&
    typeof value ===
      "object"
  ) {
    return Object.fromEntries(
      Object.entries(
        value as Record<
          string,
          unknown
        >,
      ).map(
        ([
          key,
          entry,
        ]) => [
          key,
          normalizeValue(
            entry,
          ),
        ],
      ),
    );
  }

  return value;
}

function bodySchemaWithConfirm(
  schema: Record<
    string,
    unknown
  >,
) {
  const required =
    Array.isArray(
      schema.required,
    )
      ? [
          ...schema.required,
        ]
      : [];

  if (
    !required.includes(
      "confirm",
    )
  ) {
    required.push(
      "confirm",
    );
  }

  const properties =
    schema.properties &&
    typeof schema.properties ===
      "object" &&
    !Array.isArray(
      schema.properties,
    )
      ? {
          ...schema.properties as Record<
            string,
            unknown
          >,
        }
      : {};

  properties.confirm = {
    type:
      "string",

    const:
      "BROADCAST",
  };

  return {
    ...schema,
    required,
    properties,
  };
}

export async function registerGenericWriteBroadcastRoutes(
  app: FastifyInstance,
) {
  for (
    const spec of genericMutationSpecs
  ) {
    const path =
      spec.path.replace(
        /\/simulate$/,
        "/broadcast",
      );

    app.post(
      path,
      {
        schema: {
          tags: [
            "chain",
            "write",
            "broadcast",
          ],

          headers: {
            type:
              "object",

            required: [
              "idempotency-key",
            ],

            properties: {
              "idempotency-key": {
                type:
                  "string",

                minLength:
                  8,

                maxLength:
                  128,
              },
            },
          },

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

          body:
            bodySchemaWithConfirm(
              spec.bodySchema,
            ),
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

        if (
          !config.traceforge.broadcastEnabled
        ) {
          reply.code(
            503,
          );

          return apiError(
            "broadcast_disabled",
            "Blockchain broadcasting is disabled by server configuration.",
          );
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
            "Generic write broadcast requires an organization-bound API token.",
          );
        }

        const key =
          requestIdempotencyKey(
            request,
          );

        if (
          !key
        ) {
          reply.code(
            400,
          );

          return apiError(
            "invalid_idempotency_key",
            "A valid Idempotency-Key header is required.",
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

        const {
          confirm:
            _confirm,
          ...rawBody
        } =
          request.body as Record<
            string,
            unknown
          >;

        const body =
          normalizeValue(
            rawBody,
          ) as Record<
            string,
            unknown
          >;

        const canonicalRequest = {
          tenantId:
            tenantId.toLowerCase(),

          organizationId:
            auth.organizationId.toLowerCase(),

          entityId:
            entityId.toLowerCase(),

          body,
        };

        const requestHash =
          canonicalRequestHash(
            canonicalRequest,
          );

        const existing =
          await getWriteOperation(
            tenantId,
            spec.operation,
            key,
          );

        if (
          existing
        ) {
          if (
            existing.request_hash !==
            requestHash
          ) {
            reply.code(
              409,
            );

            return apiError(
              "idempotency_conflict",
              "This Idempotency-Key was already used with a different generic write request.",
            );
          }

          if (
            existing.status ===
            "CONFIRMED"
          ) {
            return {
              broadcast:
                true,

              confirmed:
                true,

              recovered:
                true,

              operationId:
                existing.operation_id,

              operation:
                existing.operation_name,

              transactionHash:
                existing.transaction_hash,

              blockNumber:
                existing.block_number ===
                null
                  ? null
                  : String(
                      existing.block_number,
                    ),

              gasUsed:
                existing.gas_used ===
                null
                  ? null
                  : String(
                      existing.gas_used,
                    ),
            };
          }

          if (
            existing.status ===
              "PREPARED" ||
            existing.status ===
              "BROADCAST"
          ) {
            if (
              existing.serialized_transaction
            ) {
              try {
                await chainClient.sendRawTransaction({
                  serializedTransaction:
                    existing.serialized_transaction as Hex,
                });
              } catch {
                // It may already be in the node pool or chain.
              }
            }

            try {
              const finalized =
                await finalizeGenericWriteReceipt(
                  existing,
                );

              return {
                broadcast:
                  true,

                recovered:
                  true,

                operationId:
                  existing.operation_id,

                operation:
                  existing.operation_name,

                ...finalized,
              };
            } catch (
              error
            ) {
              reply.code(
                409,
              );

              return apiError(
                "broadcast_recovery_pending",
                error instanceof Error && !policy.public
                  ? error.message
                  : "Unable to recover the previous generic write yet.",

                {
                  operationId:
                    existing.operation_id,

                  transactionHash:
                    existing.transaction_hash,
                },
              );
            }
          }

          reply.code(
            409,
          );

          return apiError(
            "operation_failed",
            existing.error_message ??
            "The previous generic write operation failed.",

            {
              operationId:
                existing.operation_id,

              transactionHash:
                existing.transaction_hash,
            },
          );
        }

        let account;

        try {
          account =
            await loadOrganizationAccount(
              auth.organizationId,
            );
        } catch (
          error
        ) {
          request.log.error(policy.public ? {code:"public_rpc_error"} : error);

          reply.code(
            503,
          );

          return apiError(
            "signer_unavailable",
            error instanceof Error && !policy.public
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
              broadcast:
                false,

              confirmed:
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

          const fees=await feePlan(chainClient);
          const gasEstimate =
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

            } as any);

          const gasLimit =
            (
              gasEstimate *
              120n +
              99n
            ) /
            100n;

          const nonce =
            await chainClient.getTransactionCount({
              address:
                account.address,

              blockTag:
                "pending",
            });

          const data =
            encodeFunctionData({
              abi:
                traceForgeWriteAbi as any,

              functionName:
                spec.operation as any,

              args:
                args as any,
            } as any);

          await requireGasBalance(chainClient,account.address,gasLimit,fees);
          const serializedTransaction =
            await account.signTransaction({
              chainId:
                config.traceforge.chainId,


              to:
                contractAddress,

              data,

              gas:
                gasLimit,

              ...fees,

              nonce,

              value:
                0n,
            });

          const transactionHash =
            keccak256(
              serializedTransaction,
            );

          const operationId =
            randomUUID();

          await insertPreparedWriteOperation({
            operationId,

            idempotencyKey:
              key,

            requestHash,

            tokenId:
              auth.tokenId,

            tenantId,

            organizationId:
              auth.organizationId,

            entityId,

            operationName:
              spec.operation,

            roleId,

            transactionHash,

            serializedTransaction,

            nonce,

            gasEstimate:
              gasEstimate.toString(),

            gasLimit:
              gasLimit.toString(),

            requestJson: {
              ...canonicalRequest,

              context,

              signerAddress:
                account.address.toLowerCase(),
            },
          });

          try {
            const sentHash =
              await chainClient.sendRawTransaction({
                serializedTransaction,
              });

            if (
              !same(
                sentHash,
                transactionHash,
              )
            ) {
              throw new Error(
                "Node returned a transaction hash that differs from the locally signed hash.",
              );
            }

            await markWriteOperationBroadcast(
              operationId,
            );
          } catch (
            error
          ) {
            await recordWriteOperationError(
              operationId,
              "broadcast_submit_error",
              error instanceof Error && !policy.public
                ? error.message
                : "Unknown generic broadcast submission error.",
            );

            // Keep PREPARED + the exact serialized transaction for same-key recovery.
            throw error;
          }

          const prepared =
            await getWriteOperation(
              tenantId,
              spec.operation,
              key,
            );

          if (
            !prepared
          ) {
            throw new Error(
              "Prepared generic write operation could not be reloaded.",
            );
          }

          const finalized =
            await finalizeGenericWriteReceipt(
              prepared,
            );

          return {
            broadcast:
              true,

            recovered:
              false,

            operationId,

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

            gasEstimate:
              gasEstimate.toString(),

            gasLimit:
              gasLimit.toString(),

            nonce:
              String(
                nonce,
              ),

            checks,

            ...finalized,
          };
        } catch (
          error
        ) {
          request.log.error(policy.public ? {code:"public_rpc_error"} : error);

          reply.code(policy.public ? 503 : 409);

          return apiError(
            policy.public ? (error instanceof TransactionPolicyError ? error.code : "chain_unavailable") : "broadcast_failed",
            error instanceof Error && !policy.public
              ? error.message
              : "Generic write broadcast failed.",

            {
              checks,
            },
          );
        }
      },
    );
  }
}
