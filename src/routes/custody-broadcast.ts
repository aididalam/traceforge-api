import {
  createHash,
  randomUUID,
} from "node:crypto";

import type {
  FastifyInstance,
} from "fastify";

import type {
  RowDataPacket,
} from "mysql2";

import {
  decodeEventLog,
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

const operationName =
  "proposeCustodyTransfer";

interface Params {
  tenantId: string;
  entityId: string;
}

interface Body {
  toOrganizationId: string;
  eventType: string;
  evidenceHash: string;
  confirm: string;
}

interface OperationRow
  extends RowDataPacket {
  operation_id: string;
  idempotency_key: string;
  request_hash: string;
  token_id: string;
  tenant_id: string;
  organization_id: string;
  entity_id: string;
  operation_name: string;
  role_id: string;
  status: string;
  transaction_hash: string;
  serialized_transaction:
    | string
    | null;
  nonce: string | number;
  gas_estimate: string | number;
  gas_limit: string | number;
  block_number:
    | string
    | number
    | null;
  gas_used:
    | string
    | number
    | null;
  request_json:
    | string
    | Record<string, unknown>;
  error_code:
    | string
    | null;
  error_message:
    | string
    | null;
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

function requestHash(
  value: Record<
    string,
    unknown
  >,
): `0x${string}` {
  const json =
    JSON.stringify(
      value,
    );

  const digest =
    createHash(
      "sha256",
    )
      .update(
        json,
        "utf8",
      )
      .digest(
        "hex",
      );

  return `0x${digest}`;
}

function idempotencyKey(
  request: {
    headers: Record<
      string,
      unknown
    >;
  },
): string | null {
  const raw =
    request.headers[
      "idempotency-key"
    ];

  if (
    typeof raw !==
    "string"
  ) {
    return null;
  }

  const value =
    raw.trim();

  if (
    value.length < 8 ||
    value.length > 128
  ) {
    return null;
  }

  return value;
}

function parseRequestJson(
  value:
    | string
    | Record<
        string,
        unknown
      >,
): Record<
  string,
  unknown
> {
  if (
    typeof value ===
    "string"
  ) {
    return JSON.parse(
      value,
    ) as Record<
      string,
      unknown
    >;
  }

  return value;
}

function decodedEvents(
  logs: readonly any[],
) {
  const decoded:
    {
      eventName: string;
      args: any;
    }[] =
      [];

  for (
    const log of logs
  ) {
    if (
      !same(
        log.address,
        contractAddress,
      )
    ) {
      continue;
    }

    try {
      const event =
        decodeEventLog({
          abi:
            traceForgeWriteAbi,
          data:
            log.data,
          topics:
            log.topics,
        });

      decoded.push({
        eventName:
          event.eventName,
        args:
          event.args,
      });
    } catch {
      // Ignore unrelated logs.
    }
  }

  return decoded;
}

async function finalizeReceipt(
  operation: OperationRow,
) {
  const hash =
    operation.transaction_hash as Hex;

  const receipt =
    await chainClient.waitForTransactionReceipt({
      hash,
      confirmations:
        1,
    });

  if (
    receipt.status !==
    "success"
  ) {
    await db.query(
      `
        UPDATE chain_write_operations
        SET
          status = 'FAILED',
          block_number = ?,
          gas_used = ?,
          error_code =
            'transaction_reverted',
          error_message =
            'Transaction receipt status was not success.'
        WHERE operation_id = ?
      `,
      [
        receipt.blockNumber.toString(),
        receipt.gasUsed.toString(),
        operation.operation_id,
      ],
    );

    throw new Error(
      "Broadcast transaction reverted.",
    );
  }

  const requestBody =
    parseRequestJson(
      operation.request_json,
    );

  const events =
    decodedEvents(
      receipt.logs,
    );

  const proposal =
    events.find(
      (event) =>
        event.eventName ===
          "CustodyTransferProposed" &&
        same(
          event.args.tenantId,
          operation.tenant_id,
        ) &&
        same(
          event.args.entityId,
          operation.entity_id,
        ) &&
        same(
          event.args.fromOrganizationId,
          operation.organization_id,
        ) &&
        same(
          event.args.toOrganizationId,
          requestBody.toOrganizationId,
        ) &&
        same(
          event.args.roleId,
          operation.role_id,
        ) &&
        same(
          event.args.eventType,
          requestBody.eventType,
        ) &&
        same(
          event.args.evidenceHash,
          requestBody.evidenceHash,
        ),
    );

  const trace =
    events.find(
      (event) =>
        event.eventName ===
          "TraceRecorded" &&
        same(
          event.args.tenantId,
          operation.tenant_id,
        ) &&
        same(
          event.args.entityId,
          operation.entity_id,
        ) &&
        same(
          event.args.organizationId,
          operation.organization_id,
        ) &&
        same(
          event.args.roleId,
          operation.role_id,
        ) &&
        same(
          event.args.eventType,
          requestBody.eventType,
        ) &&
        same(
          event.args.evidenceHash,
          requestBody.evidenceHash,
        ),
    );

  if (
    !proposal ||
    !trace
  ) {
    await db.query(
      `
        UPDATE chain_write_operations
        SET
          status = 'FAILED',
          block_number = ?,
          gas_used = ?,
          error_code =
            'receipt_event_mismatch',
          error_message =
            'Expected custody/trace events were not found in the successful receipt.'
        WHERE operation_id = ?
      `,
      [
        receipt.blockNumber.toString(),
        receipt.gasUsed.toString(),
        operation.operation_id,
      ],
    );

    throw new Error(
      "Successful transaction did not contain the expected custody events.",
    );
  }

  const pendingExists =
    await readTraceForge(
      "hasPendingCustodyTransfer",
      [
        asBytes32(
          operation.tenant_id,
        ),
        asBytes32(
          operation.entity_id,
        ),
      ],
    );

  if (
    !pendingExists
  ) {
    throw new Error(
      "Receipt succeeded but pending custody transfer is absent during readback.",
    );
  }

  const pending =
    await readTraceForge(
      "getPendingCustodyTransfer",
      [
        asBytes32(
          operation.tenant_id,
        ),
        asBytes32(
          operation.entity_id,
        ),
      ],
    );

  if (
    !same(
      pending.fromOrganizationId,
      operation.organization_id,
    ) ||
    !same(
      pending.toOrganizationId,
      requestBody.toOrganizationId,
    )
  ) {
    throw new Error(
      "Pending custody readback does not match the broadcast request.",
    );
  }

  await db.query(
    `
      UPDATE chain_write_operations
      SET
        status = 'CONFIRMED',
        block_number = ?,
        gas_used = ?,
        serialized_transaction = NULL,
        error_code = NULL,
        error_message = NULL
      WHERE operation_id = ?
    `,
    [
      receipt.blockNumber.toString(),
      receipt.gasUsed.toString(),
      operation.operation_id,
    ],
  );

  return {
    confirmed:
      true,

    transactionHash:
      operation.transaction_hash,

    blockNumber:
      receipt.blockNumber.toString(),

    gasUsed:
      receipt.gasUsed.toString(),

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
  };
}

async function existingOperation(
  tenantId: string,
  key: string,
): Promise<
  OperationRow | null
> {
  const [rows] =
    await db.query<
      OperationRow[]
    >(
      `
        SELECT *
        FROM chain_write_operations
        WHERE tenant_id = ?
          AND operation_name = ?
          AND idempotency_key = ?
        LIMIT 1
      `,
      [
        tenantId,
        operationName,
        key,
      ],
    );

  return rows[0] ??
    null;
}

export async function registerCustodyBroadcastRoutes(
  app: FastifyInstance,
) {
  app.post<{
    Params: Params;
    Body: Body;
  }>(
    "/v1/tenants/:tenantId/entities/:entityId/custody/proposals/broadcast",
    {
      schema: {
        tags: [
          "chain",
          "custody",
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

        body: {
          type:
            "object",

          additionalProperties:
            false,

          required: [
            "toOrganizationId",
            "eventType",
            "evidenceHash",
            "confirm",
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

            confirm: {
              type:
                "string",
              const:
                "BROADCAST",
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
          "Custody broadcast requires an organization-bound API token.",
        );
      }

      const key =
        idempotencyKey(
          request as any,
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
        request.params;

      const {
        toOrganizationId,
        eventType,
        evidenceHash,
      } =
        request.body;

      const canonicalRequest = {
        tenantId:
          tenantId.toLowerCase(),

        entityId:
          entityId.toLowerCase(),

        toOrganizationId:
          toOrganizationId.toLowerCase(),

        eventType:
          eventType.toLowerCase(),

        evidenceHash:
          evidenceHash.toLowerCase(),
      };

      const hash =
        requestHash(
          canonicalRequest,
        );

      const existing =
        await existingOperation(
          tenantId.toLowerCase(),
          key,
        );

      if (
        existing
      ) {
        if (
          existing.request_hash !==
          hash
        ) {
          reply.code(
            409,
          );

          return apiError(
            "idempotency_conflict",
            "This Idempotency-Key was already used with a different request.",
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
              // It may already be in the node's pool or chain.
            }
          }

          try {
            const finalized =
              await finalizeReceipt(
                existing,
              );

            return {
              broadcast:
                true,

              recovered:
                true,

              operationId:
                existing.operation_id,

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
              error instanceof Error
                ? error.message
                : "Unable to recover the previous broadcast yet.",

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
          "The previous operation failed.",

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
            broadcast:
              false,

            confirmed:
              false,

            operation:
              operationName,

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

        await chainClient.simulateContract({
          address:
            contractAddress,

          abi:
            traceForgeWriteAbi,

          functionName:
            operationName,

          args,

          account,
        });

        const gasEstimate =
          await chainClient.estimateContractGas({
            address:
              contractAddress,

            abi:
              traceForgeWriteAbi,

            functionName:
              operationName,

            args,

            account:
              account.address,

            gasPrice:
              0n,
          });

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
              traceForgeWriteAbi,

            functionName:
              operationName,

            args,
          });

        const serializedTransaction =
          await account.signTransaction({
            chainId:
              config.traceforge.chainId,

            type:
              "legacy",

            to:
              contractAddress,

            data,

            gas:
              gasLimit,

            gasPrice:
              0n,

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

        await db.query(
          `
            INSERT INTO chain_write_operations (
              operation_id,
              idempotency_key,
              request_hash,
              token_id,
              tenant_id,
              organization_id,
              entity_id,
              operation_name,
              role_id,
              status,
              transaction_hash,
              serialized_transaction,
              nonce,
              gas_estimate,
              gas_limit,
              request_json
            )
            VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?,
              'PREPARED',
              ?, ?, ?, ?, ?, ?
            )
          `,
          [
            operationId,
            key,
            hash,
            auth.tokenId,
            tenantId.toLowerCase(),
            auth.organizationId,
            entityId.toLowerCase(),
            operationName,
            roleId,
            transactionHash,
            serializedTransaction,
            nonce,
            gasEstimate.toString(),
            gasLimit.toString(),
            JSON.stringify(
              canonicalRequest,
            ),
          ],
        );

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

          await db.query(
            `
              UPDATE chain_write_operations
              SET status = 'BROADCAST'
              WHERE operation_id = ?
            `,
            [
              operationId,
            ],
          );
        } catch (
          error
        ) {
          await db.query(
            `
              UPDATE chain_write_operations
              SET
                error_code =
                  'broadcast_submit_error',
                error_message = ?
              WHERE operation_id = ?
            `,
            [
              error instanceof Error
                ? error.message
                : "Unknown broadcast submission error.",
              operationId,
            ],
          );

          // Keep PREPARED + signed transaction for idempotent recovery.
          throw error;
        }

        const prepared =
          await existingOperation(
            tenantId.toLowerCase(),
            key,
          );

        if (
          !prepared
        ) {
          throw new Error(
            "Prepared write operation could not be reloaded.",
          );
        }

        const finalized =
          await finalizeReceipt(
            prepared,
          );

        return {
          broadcast:
            true,

          recovered:
            false,

          operationId,

          operation:
            operationName,

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
        request.log.error(
          error,
        );

        reply.code(
          409,
        );

        return apiError(
          "broadcast_failed",
          error instanceof Error
            ? error.message
            : "Custody broadcast failed.",

          {
            checks,
          },
        );
      }
    },
  );
}
