import type {RowDataPacket} from 'mysql2';
import {db} from './db.js';
import {chainClient,readTraceForge} from './chain.js';
import {zeroHash} from 'viem';
import {policy} from './transaction-policy.js';

let observedBlock:bigint|null=null,advancedAt=0;
export async function deploymentReadiness(){
 const [schema]=await db.query<RowDataPacket[]>("SELECT COUNT(*) n FROM api_schema_migrations WHERE migration_name IN ('012_ui_sessions.sql','013_wallet_nonce_index.sql','014_public_transaction_attempts.sql','015_receipt_approval.sql','016_receipt_expiry_index.sql')");
 if(Number(schema[0].n)!==5)throw Error('Deployment migrations missing');
 // A v0.2 deployment's bytecode pin alone does not prove the approval ABI exists.
 if(await readTraceForge('approvedReceiptRequests',[zeroHash]))throw Error('Invalid approval contract');
 // The transport verifies chain ID and contract bytecode before using an RPC.
 const block=await chainClient.getBlockNumber({cacheTime:0});
 if(block!==observedBlock){observedBlock=block;advancedAt=Date.now();}
 if(Date.now()-advancedAt>(policy.public?180000:30000))throw Error('Block production stalled');
 if(policy.public){const finalized=await chainClient.getBlock({blockTag:'finalized'});if(finalized.number==null||finalized.number>block)throw Error('Finality unavailable');}
}
