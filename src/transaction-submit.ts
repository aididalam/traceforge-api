import {parseTransaction,recoverTransactionAddress,keccak256} from 'viem';
import type {Hex,PrivateKeyAccount,TransactionSerialized} from 'viem';
import type {RowDataPacket} from 'mysql2/promise';
import {db} from './db.js';
import {chainClient,contractAddress} from './chain.js';
import {config} from './config.js';
import {policy,feePlan,requireGasBalance,receiptFinalized,TransactionPolicyError} from './transaction-policy.js';
import type {FeePlan} from './transaction-policy.js';
import type {WriteOperationRow} from './write-journal.js';

// A fee replacement keeps the original nonce and payload. Every signed attempt
// is stored before submission; either the original or replacement can finalize.
export async function submitPublicTransaction(operation:WriteOperationRow,account:PrivateKeyAccount) {
  if(!policy.public)throw Error('Public transaction handler requires public mode');
  const lock=await db.getConnection();let acquired=false;
  const lockName='tf-fee:'+operation.operation_id;
  try{
    const [locks]=await lock.query<RowDataPacket[]>('SELECT GET_LOCK(?,5) acquired',[lockName]);
    acquired=Number(locks[0].acquired)===1;
    if(!acquired)throw new TransactionPolicyError('transaction_pending');
    if(operation.serialized_transaction)await db.query(`INSERT IGNORE INTO chain_write_attempts
      (transaction_hash,operation_id,serialized_transaction) VALUES (?,?,?)`,
      [operation.transaction_hash,operation.operation_id,operation.serialized_transaction]);
    const [attempts]=await db.query<RowDataPacket[]>('SELECT * FROM chain_write_attempts WHERE operation_id=? ORDER BY attempt_id',[operation.operation_id]);
    for(const attempt of attempts){
      let receipt;
      try{receipt=await chainClient.getTransactionReceipt({hash:attempt.transaction_hash as Hex});}catch{continue;}
      const block=await chainClient.getBlock({blockNumber:receipt.blockNumber});
      if(block.hash!==receipt.blockHash)continue;
      if(!await receiptFinalized(chainClient,receipt))return null;
      await db.query('UPDATE chain_write_operations SET transaction_hash=?,serialized_transaction=? WHERE operation_id=?',
        [attempt.transaction_hash,attempt.serialized_transaction,operation.operation_id]);
      operation.transaction_hash=attempt.transaction_hash;
      operation.serialized_transaction=attempt.serialized_transaction;
      return receipt;
    }
    const latest=attempts.at(-1);
    if(!latest?.serialized_transaction)throw new TransactionPolicyError('transaction_pending');
    let serialized=latest.serialized_transaction as Hex;
    const tx=parseTransaction(serialized);
    if(tx.chainId!==config.traceforge.chainId||tx.to?.toLowerCase()!==contractAddress.toLowerCase()||
       tx.nonce!==Number(operation.nonce)||(await recoverTransactionAddress({serializedTransaction:serialized as TransactionSerialized})).toLowerCase()!==account.address.toLowerCase())
      throw new TransactionPolicyError('transaction_identity_mismatch');
    if(Date.now()-new Date(latest.created_at).getTime()>=policy.retrySeconds*1000){
      const previous:FeePlan=tx.type==='eip1559'?{type:'eip1559',maxFeePerGas:tx.maxFeePerGas!,maxPriorityFeePerGas:tx.maxPriorityFeePerGas!}:
        {type:'legacy',gasPrice:tx.gasPrice!};
      const fees=await feePlan(chainClient,policy,previous);
      await requireGasBalance(chainClient,account.address,tx.gas!,fees,tx.value??0n);
      serialized=await account.signTransaction({chainId:config.traceforge.chainId,to:tx.to,data:tx.data,value:tx.value??0n,
        nonce:tx.nonce,gas:tx.gas,...fees} as any);
      await db.query('INSERT INTO chain_write_attempts (transaction_hash,operation_id,serialized_transaction) VALUES (?,?,?)',
        [keccak256(serialized),operation.operation_id,serialized]);
    }
    const hash=keccak256(serialized);
    await db.query("UPDATE chain_write_operations SET transaction_hash=?,serialized_transaction=?,status='BROADCAST' WHERE operation_id=?",
      [hash,serialized,operation.operation_id]);
    operation.transaction_hash=hash;operation.serialized_transaction=serialized;
    try{await chainClient.sendRawTransaction({serializedTransaction:serialized});}catch{}
    return null;
  }finally{if(acquired)await lock.query('SELECT RELEASE_LOCK(?)',[lockName]);lock.release();}
}
