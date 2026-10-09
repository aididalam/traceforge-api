import {policy} from './transaction-policy.js';
import {
  createHash,
} from "node:crypto";

import type {
  RowDataPacket,
} from "mysql2";

import {
  db,
} from "./db.js";

export interface WriteOperationRow
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

  nonce:
    | string
    | number;

  gas_estimate:
    | string
    | number;

  gas_limit:
    | string
    | number;

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
    | Record<
        string,
        unknown
      >;

  error_code:
    | string
    | null;

  error_message:
    | string
    | null;
}

export function canonicalRequestHash(
  value: Record<
    string,
    unknown
  >,
): `0x${string}` {
  const digest =
    createHash(
      "sha256",
    )
      .update(
        JSON.stringify(
          value,
        ),
        "utf8",
      )
      .digest(
        "hex",
      );

  return `0x${digest}`;
}

export function requestIdempotencyKey(
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

export function parseOperationRequest(
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

export async function getWriteOperation(
  tenantId: string,
  operationName: string,
  idempotencyKey: string,
): Promise<
  WriteOperationRow | null
> {
  const [rows] =
    await db.query<
      WriteOperationRow[]
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
        tenantId.toLowerCase(),
        operationName,
        idempotencyKey,
      ],
    );

  return rows[0] ??
    null;
}

export async function insertPreparedWriteOperation(
  input: {
    operationId: string;
    idempotencyKey: string;
    requestHash: string;
    tokenId: string;
    tenantId: string;
    organizationId: string;
    entityId: string;
    operationName: string;
    roleId: string;
    transactionHash: string;
    serializedTransaction: string;
    nonce: number;
    gasEstimate: string;
    gasLimit: string;
    requestJson: Record<
      string,
      unknown
    >;
  },
) {
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
      input.operationId,
      input.idempotencyKey,
      input.requestHash,
      input.tokenId,
      input.tenantId.toLowerCase(),
      input.organizationId.toLowerCase(),
      input.entityId.toLowerCase(),
      input.operationName,
      input.roleId.toLowerCase(),
      input.transactionHash.toLowerCase(),
      input.serializedTransaction,
      input.nonce,
      input.gasEstimate,
      input.gasLimit,
      JSON.stringify(
        input.requestJson,
      ),
    ],
  );
}

export async function markWriteOperationBroadcast(
  operationId: string,
) {
  await db.query(
    `
      UPDATE chain_write_operations
      SET
        status = 'BROADCAST',
        error_code = NULL,
        error_message = NULL
      WHERE operation_id = ?
    `,
    [
      operationId,
    ],
  );
}

export async function markWriteOperationConfirmed(
  operationId: string,
  blockNumber: string,
  gasUsed: string,
) {
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
      blockNumber,
      gasUsed,
      operationId,
    ],
  );
  if(policy.public)await db.query('UPDATE chain_write_attempts SET serialized_transaction=NULL WHERE operation_id=?',[operationId]);
}

export async function markWriteOperationFailed(
  operationId: string,
  errorCode: string,
  errorMessage: string,
  blockNumber:
    | string
    | null =
      null,
  gasUsed:
    | string
    | null =
      null,
  clearSerializedTransaction =
    false,
) {
  await db.query(
    `
      UPDATE chain_write_operations
      SET
        status = 'FAILED',
        block_number = COALESCE(?, block_number),
        gas_used = COALESCE(?, gas_used),
        serialized_transaction =
          CASE
            WHEN ? THEN NULL
            ELSE serialized_transaction
          END,
        error_code = ?,
        error_message = ?
      WHERE operation_id = ?
    `,
    [
      blockNumber,
      gasUsed,
      clearSerializedTransaction,
      errorCode,
      errorMessage,
      operationId,
    ],
  );
  if(policy.public&&clearSerializedTransaction)await db.query('UPDATE chain_write_attempts SET serialized_transaction=NULL WHERE operation_id=?',[operationId]);
}

export async function recordWriteOperationError(
  operationId: string,
  errorCode: string,
  errorMessage: string,
) {
  await db.query(
    `
      UPDATE chain_write_operations
      SET
        error_code = ?,
        error_message = ?
      WHERE operation_id = ?
    `,
    [
      errorCode,
      errorMessage,
      operationId,
    ],
  );
}
