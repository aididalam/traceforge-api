import { randomUUID } from "node:crypto";
import { BaseError, ContractFunctionRevertedError, createWalletClient, decodeEventLog, defineChain, encodeFunctionData, http, keccak256, zeroHash } from "viem";
import type { Hex } from "viem";
import type { RowDataPacket } from "mysql2/promise";
import { businessReceiptMatches } from "./business-receipt.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { chainClient, contractAddress } from "./chain.js";
import { traceForgeWriteAbi as abi } from "./traceforge-write-abi.js";
import { loadOrganizationAccount } from "./signer.js";
import { runtimeBytecodeIntegrity } from "./runtime-integrity.js";
import { canonicalRequestHash, getWriteOperation, insertPreparedWriteOperation, markWriteOperationBroadcast,
  markWriteOperationConfirmed, markWriteOperationFailed } from "./write-journal.js";
import type { WriteOperationRow } from "./write-journal.js";

export class BusinessProblem extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export type BusinessCall = "registerBusiness" | "createBusinessWorkspace" | "createEntity" | "createProduct" | "claimCustody" | "claimBatch" | "removeProduct" | "closeEntity";
export interface BusinessWrite {
  accountId: string; organizationId: string; tenantId: string; entityId: string;
  operation: BusinessCall; args: readonly unknown[]; idempotencyKey: string; expectedEvent: string;
}
const chain = defineChain({ id: config.traceforge.chainId, name: "TraceForge", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.traceforge.rpcUrl] } } });
const safeResult = (row: WriteOperationRow) => ({ operationId: row.operation_id, status: row.status,
  transactionHash: row.transaction_hash, blockNumber: row.block_number == null ? null : String(row.block_number) });

// The journal is written before broadcast. Retries send the identical signed transaction,
// and the wallet lock prevents two application requests from allocating the same nonce.
export async function businessWrite(input: BusinessWrite) {
  if (!config.traceforge.broadcastEnabled) throw new BusinessProblem("writes_disabled", 503);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.idempotencyKey)) throw new BusinessProblem("invalid_request", 400);
  const key = canonicalRequestHash({ organizationId: input.organizationId, key: input.idempotencyKey }).slice(2);
  const account = await loadOrganizationAccount(input.organizationId);
  const conn = await db.getConnection();
  const lock = "tf-write:" + account.address.toLowerCase();
  let locked = false;
  try {
    const [locks] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?,5) AS acquired", [lock]);
    locked = Number(locks[0].acquired) === 1;
    if (!locked) throw new BusinessProblem("business_busy", 429);
    const request = { chainId: config.traceforge.chainId, contractAddress, organizationId: input.organizationId,
      tenantId: input.tenantId, entityId: input.entityId, operation: input.operation,
      args: input.args.map(value => typeof value === "bigint" ? value.toString() : value), signerAddress: account.address };
    const requestHash = canonicalRequestHash(request);
    let operation = await getWriteOperation(input.tenantId, input.operation, key);
    if (operation && (operation.request_hash !== requestHash || operation.organization_id !== input.organizationId))
      throw new BusinessProblem("request_conflict");
    if (operation?.status === "FAILED") throw new BusinessProblem("operation_failed");
    if (operation?.status === "CONFIRMED") return safeResult(operation);
    if (!operation) {
      // An uncertain earlier write may not yet be visible to the RPC nonce query.
      // Recover it with its original key before allocating another transaction.
      const [pending] = await conn.query<RowDataPacket[]>(
        "SELECT operation_id FROM chain_write_operations WHERE organization_id=? AND status IN ('PREPARED','BROADCAST') LIMIT 1",
        [input.organizationId]);
      if (pending.length) throw new BusinessProblem("business_busy", 429);
      const [chainId, code] = await Promise.all([chainClient.getChainId(), chainClient.getBytecode({ address: contractAddress })]);
      if (chainId !== config.traceforge.chainId || !runtimeBytecodeIntegrity(code).ok)
        throw new BusinessProblem("chain_unavailable", 503);
      // Contract simulation is the authoritative authorization check, including active business,
      // holder-only close, terminal state and the expected custody version.
      try {
        await chainClient.simulateContract({ address: contractAddress, abi, functionName: input.operation,
          args: input.args as any, account: account.address } as any);
      } catch (error) {
        const reverted = error instanceof BaseError && error.walk(cause => cause instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError;
        throw new BusinessProblem(reverted ? "operation_not_allowed" : "chain_unavailable", reverted ? 409 : 503);
      }
      const data = encodeFunctionData({ abi, functionName: input.operation, args: input.args as any } as any);
      const nonce = await chainClient.getTransactionCount({ address: account.address, blockTag: "pending" });
      const gasEstimate = await chainClient.estimateGas({ account: account.address, to: contractAddress, data, gasPrice: 0n });
      const gasLimit = (gasEstimate * 120n + 99n) / 100n;
      const wallet = createWalletClient({ account, chain, transport: http(config.traceforge.rpcUrl) });
      const serialized = await wallet.signTransaction({ to: contractAddress, data, nonce, gas: gasLimit, gasPrice: 0n, type: "legacy" });
      const operationId = randomUUID();
      await insertPreparedWriteOperation({ operationId, idempotencyKey: key, requestHash, tokenId: input.accountId,
        tenantId: input.tenantId, organizationId: input.organizationId, entityId: input.entityId, operationName: input.operation,
        roleId: zeroHash, transactionHash: keccak256(serialized), serializedTransaction: serialized, nonce,
        gasEstimate: gasEstimate.toString(), gasLimit: gasLimit.toString(), requestJson: request });
      operation = (await getWriteOperation(input.tenantId, input.operation, key))!;
    }
    await markWriteOperationBroadcast(operation.operation_id);
    try {
      if (operation.serialized_transaction) await chainClient.sendRawTransaction({ serializedTransaction: operation.serialized_transaction as Hex });
    } catch {
      // It may already be mined or submitted; inspect this exact transaction before deciding.
    }
    let receipt;
    try { receipt = await chainClient.waitForTransactionReceipt({ hash: operation.transaction_hash as Hex, timeout: 15000 }); }
    catch { return { ...safeResult(operation), status: "BROADCAST" }; }
    if (receipt.status !== "success") {
      await markWriteOperationFailed(operation.operation_id, "transaction_reverted", "Contract rejected this operation.",
        receipt.blockNumber.toString(), receipt.gasUsed.toString(), true);
      throw new BusinessProblem("operation_not_allowed");
    }
    const events = receipt.logs.filter(log => log.address.toLowerCase() === contractAddress.toLowerCase()).flatMap(log => {
      try { return [decodeEventLog({ abi, topics: log.topics, data: log.data })]; } catch { return []; }
    });
    const event = events.find(event => event.eventName === input.expectedEvent);
    if (!event) throw new BusinessProblem("receipt_unverified", 503);
    const args = event.args as unknown as Record<string, unknown>;
    if(!businessReceiptMatches(input,args,account.address))throw new BusinessProblem("receipt_unverified",503);
    await markWriteOperationConfirmed(operation.operation_id, receipt.blockNumber.toString(), receipt.gasUsed.toString());
    return { ...safeResult(operation), status: "CONFIRMED", blockNumber: receipt.blockNumber.toString() };
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [lock]);
    conn.release();
  }
}
