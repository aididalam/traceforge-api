import {
  decodeEventLog,
} from "viem";

import type {
  Hex,
} from "viem";

import {
  asBytes32,
  chainClient,
  contractAddress,
  readTraceForge,
} from "./chain.js";

import {
  readEntityLink,
} from "./entity-link-read.js";

import {
  markWriteOperationConfirmed,
  markWriteOperationFailed,
  parseOperationRequest,
} from "./write-journal.js";

import type {
  WriteOperationRow,
} from "./write-journal.js";

import {
  traceForgeWriteAbi,
} from "./traceforge-write-abi.js";

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
      // Ignore logs outside the write ABI.
    }
  }

  return decoded;
}

function bodyFor(
  requestBody: Record<
    string,
    unknown
  >,
): Record<
  string,
  unknown
> {
  const body =
    requestBody.body;

  if (
    !body ||
    typeof body !==
    "object" ||
    Array.isArray(
      body,
    )
  ) {
    throw new Error(
      "Stored generic write request body is missing.",
    );
  }

  return body as Record<
    string,
    unknown
  >;
}

function contextFor(
  requestBody: Record<
    string,
    unknown
  >,
): Record<
  string,
  unknown
> {
  const context =
    requestBody.context;

  if (
    !context ||
    typeof context !==
    "object" ||
    Array.isArray(
      context,
    )
  ) {
    return {};
  }

  return context as Record<
    string,
    unknown
  >;
}

function commonTraceMatch(
  event: {
    eventName: string;
    args: any;
  },
  operation: WriteOperationRow,
  requestBody: Record<
    string,
    unknown
  >,
) {
  const body =
    bodyFor(
      requestBody,
    );

  return (
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
      event.args.actor,
      requestBody.signerAddress,
    ) &&

    same(
      event.args.eventType,
      body.eventType,
    ) &&

    same(
      event.args.evidenceHash,
      body.evidenceHash,
    )
  );
}

async function verifyOperation(
  operation: WriteOperationRow,
  events: {
    eventName: string;
    args: any;
  }[],
) {
  const requestBody =
    parseOperationRequest(
      operation.request_json,
    );

  const body =
    bodyFor(
      requestBody,
    );

  const context =
    contextFor(
      requestBody,
    );

  switch (
    operation.operation_name
  ) {
    case "createEntity": {
      const created =
        events.find(
          (event) =>
            event.eventName ===
              "EntityCreated" &&

            same(
              event.args.tenantId,
              operation.tenant_id,
            ) &&

            same(
              event.args.entityId,
              operation.entity_id,
            ) &&

            same(
              event.args.entityType,
              body.entityType,
            ) &&

            same(
              event.args.organizationId,
              operation.organization_id,
            ) &&

            same(
              event.args.actor,
              requestBody.signerAddress,
            ) &&

            same(
              event.args.metadataHash,
              body.metadataHash,
            ) &&

            same(
              event.args.initialState,
              body.initialState,
            ),
        );

      if (
        !created
      ) {
        throw new Error(
          "Expected EntityCreated event was not found.",
        );
      }

      const entity =
        await readTraceForge(
          "getEntity",
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
        !entity.exists ||
        entity.closed ||
        !same(
          entity.entityType,
          body.entityType,
        ) ||
        !same(
          entity.metadataHash,
          body.metadataHash,
        ) ||
        !same(
          entity.currentState,
          body.initialState,
        ) ||
        !same(
          entity.currentCustodian,
          operation.organization_id,
        )
      ) {
        throw new Error(
          "Created entity readback does not match the request.",
        );
      }

      return {
        entity: {
          exists:
            entity.exists,
          closed:
            entity.closed,
          currentCustodian:
            entity.currentCustodian,
          currentState:
            entity.currentState,
          metadataHash:
            entity.metadataHash,
        },
      };
    }

    case "recordTrace": {
      const trace =
        events.find(
          (event) =>
            commonTraceMatch(
              event,
              operation,
              requestBody,
            ),
        );

      if (
        !trace
      ) {
        throw new Error(
          "Expected TraceRecorded event was not found.",
        );
      }

      const entity =
        await readTraceForge(
          "getEntity",
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
        !entity.exists ||
        !same(
          entity.currentState,
          context.currentState,
        ) ||
        !same(
          entity.metadataHash,
          context.metadataHash,
        ) ||
        !same(
          entity.currentCustodian,
          context.currentCustodian,
        ) ||
        Boolean(
          entity.closed,
        ) !==
        Boolean(
          context.closed,
        )
      ) {
        throw new Error(
          "recordTrace unexpectedly changed entity readback state.",
        );
      }

      return {
        entity: {
          exists:
            entity.exists,
          closed:
            entity.closed,
          currentCustodian:
            entity.currentCustodian,
          currentState:
            entity.currentState,
          metadataHash:
            entity.metadataHash,
        },
      };
    }

    case "updateEntityState": {
      const trace =
        events.find(
          (event) =>
            commonTraceMatch(
              event,
              operation,
              requestBody,
            ) &&
            same(
              event.args.stateAfter,
              body.newState,
            ),
        );

      if (
        !trace
      ) {
        throw new Error(
          "Expected state-update TraceRecorded event was not found.",
        );
      }

      const entity =
        await readTraceForge(
          "getEntity",
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
        !entity.exists ||
        entity.closed ||
        !same(
          entity.currentState,
          body.newState,
        ) ||
        !same(
          entity.metadataHash,
          context.metadataHash,
        ) ||
        !same(
          entity.currentCustodian,
          context.currentCustodian,
        )
      ) {
        throw new Error(
          "State-update readback does not match the request.",
        );
      }

      return {
        entity: {
          exists:
            entity.exists,
          closed:
            entity.closed,
          currentCustodian:
            entity.currentCustodian,
          currentState:
            entity.currentState,
          metadataHash:
            entity.metadataHash,
        },
      };
    }

    case "updateEntityMetadata": {
      const trace =
        events.find(
          (event) =>
            commonTraceMatch(
              event,
              operation,
              requestBody,
            ) &&
            same(
              event.args.metadataHashAfter,
              body.newMetadataHash,
            ),
        );

      if (
        !trace
      ) {
        throw new Error(
          "Expected metadata-update TraceRecorded event was not found.",
        );
      }

      const entity =
        await readTraceForge(
          "getEntity",
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
        !entity.exists ||
        entity.closed ||
        !same(
          entity.metadataHash,
          body.newMetadataHash,
        ) ||
        !same(
          entity.currentState,
          context.currentState,
        ) ||
        !same(
          entity.currentCustodian,
          context.currentCustodian,
        )
      ) {
        throw new Error(
          "Metadata-update readback does not match the request.",
        );
      }

      return {
        entity: {
          exists:
            entity.exists,
          closed:
            entity.closed,
          currentCustodian:
            entity.currentCustodian,
          currentState:
            entity.currentState,
          metadataHash:
            entity.metadataHash,
        },
      };
    }

    case "createEntityLink": {
      const created =
        events.find(
          (event) =>
            event.eventName ===
              "EntityLinkCreated" &&

            same(
              event.args.tenantId,
              operation.tenant_id,
            ) &&

            same(
              event.args.sourceEntityId,
              operation.entity_id,
            ) &&

            same(
              event.args.targetEntityId,
              body.targetEntityId,
            ) &&

            same(
              event.args.linkType,
              body.linkType,
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
              event.args.actor,
              requestBody.signerAddress,
            ) &&

            same(
              event.args.eventType,
              body.eventType,
            ) &&

            same(
              event.args.evidenceHash,
              body.evidenceHash,
            ),
        );

      if (
        !created
      ) {
        throw new Error(
          "Expected EntityLinkCreated event was not found.",
        );
      }

      const link: any =
        await readEntityLink(
          operation.tenant_id,
          operation.entity_id,
          String(
            body.targetEntityId,
          ),
          String(
            body.linkType,
          ),
        );

      if (
        !link.exists ||
        !link.active
      ) {
        throw new Error(
          "Created entity link readback is missing or inactive.",
        );
      }

      return {
        link: {
          exists:
            Boolean(
              link.exists,
            ),
          active:
            Boolean(
              link.active,
            ),
        },
      };
    }

    case "setEntityLinkActive": {
      const changed =
        events.find(
          (event) =>
            event.eventName ===
              "EntityLinkStatusChanged" &&

            same(
              event.args.tenantId,
              operation.tenant_id,
            ) &&

            same(
              event.args.sourceEntityId,
              operation.entity_id,
            ) &&

            same(
              event.args.targetEntityId,
              body.targetEntityId,
            ) &&

            same(
              event.args.linkType,
              body.linkType,
            ) &&

            Boolean(
              event.args.active,
            ) ===
            Boolean(
              body.active,
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
              event.args.actor,
              requestBody.signerAddress,
            ) &&

            same(
              event.args.eventType,
              body.eventType,
            ) &&

            same(
              event.args.evidenceHash,
              body.evidenceHash,
            ),
        );

      if (
        !changed
      ) {
        throw new Error(
          "Expected EntityLinkStatusChanged event was not found.",
        );
      }

      const link: any =
        await readEntityLink(
          operation.tenant_id,
          operation.entity_id,
          String(
            body.targetEntityId,
          ),
          String(
            body.linkType,
          ),
        );

      if (
        !link.exists ||
        Boolean(
          link.active,
        ) !==
        Boolean(
          body.active,
        )
      ) {
        throw new Error(
          "Entity link status readback does not match the request.",
        );
      }

      return {
        link: {
          exists:
            Boolean(
              link.exists,
            ),
          active:
            Boolean(
              link.active,
            ),
        },
      };
    }

    case "closeEntity": {
      const closed =
        events.find(
          (event) =>
            event.eventName ===
              "EntityClosed" &&

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
              event.args.actor,
              requestBody.signerAddress,
            ) &&

            same(
              event.args.eventType,
              body.eventType,
            ) &&

            same(
              event.args.evidenceHash,
              body.evidenceHash,
            ),
        );

      const trace =
        events.find(
          (event) =>
            commonTraceMatch(
              event,
              operation,
              requestBody,
            ),
        );

      if (
        !closed ||
        !trace
      ) {
        throw new Error(
          "Expected EntityClosed/TraceRecorded events were not found.",
        );
      }

      const entity =
        await readTraceForge(
          "getEntity",
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
        !entity.exists ||
        !entity.closed
      ) {
        throw new Error(
          "Entity close readback does not match terminal state.",
        );
      }

      return {
        entity: {
          exists:
            entity.exists,
          closed:
            entity.closed,
          currentCustodian:
            entity.currentCustodian,
          currentState:
            entity.currentState,
          metadataHash:
            entity.metadataHash,
        },


      };
    }

    default:
      throw new Error(
        `Unsupported generic write operation: ${operation.operation_name}`,
      );
  }
}

export async function finalizeGenericWriteReceipt(
  operation: WriteOperationRow,
) {
  const receipt =
    await chainClient.waitForTransactionReceipt({
      hash:
        operation.transaction_hash as Hex,

      confirmations:
        1,
    });

  const blockNumber =
    receipt.blockNumber.toString();

  const gasUsed =
    receipt.gasUsed.toString();

  if (
    receipt.status !==
    "success"
  ) {
    await markWriteOperationFailed(
      operation.operation_id,
      "transaction_reverted",
      "Transaction receipt status was not success.",
      blockNumber,
      gasUsed,
      true,
    );

    throw new Error(
      "Generic write transaction reverted.",
    );
  }

  try {
    const result =
      await verifyOperation(
        operation,
        decodedEvents(
          receipt.logs,
        ),
      );

    await markWriteOperationConfirmed(
      operation.operation_id,
      blockNumber,
      gasUsed,
    );

    return {
      confirmed:
        true,

      transactionHash:
        operation.transaction_hash,

      blockNumber,
      gasUsed,

      ...result,
    };
  } catch (
    error
  ) {
    const message =
      error instanceof Error
        ? error.message
        : "Generic write receipt verification failed.";

    await markWriteOperationFailed(
      operation.operation_id,
      "receipt_verification_failed",
      message,
      blockNumber,
      gasUsed,
      true,
    );

    throw error;
  }
}
