import type {RowDataPacket} from 'mysql2';
import {db} from './db.js';
import {chainClient} from './chain.js';

let observedBlock:bigint|null=null,advancedAt=0;
export async function deploymentReadiness(){
 const [schema]=await db.query<RowDataPacket[]>("SELECT COUNT(*) n FROM api_schema_migrations WHERE migration_name IN ('012_ui_sessions.sql','013_wallet_nonce_index.sql')");
 if(Number(schema[0].n)!==2)throw Error('Deployment migrations missing');
 // The transport verifies chain ID and contract bytecode before using an RPC.
 const block=await chainClient.getBlockNumber({cacheTime:0});
 if(block!==observedBlock){observedBlock=block;advancedAt=Date.now();}
 if(Date.now()-advancedAt>30000)throw Error('Block production stalled');
}
