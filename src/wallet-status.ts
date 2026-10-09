import type {RowDataPacket} from 'mysql2/promise';
import {formatEther} from 'viem';
import {db} from './db.js';
import {chainClient} from './chain.js';
import {policy} from './transaction-policy.js';
try {
 const [rows]=await db.query<RowDataPacket[]>('SELECT organization_id,business_name,wallet_address FROM business_wallets ORDER BY organization_id');
 for(const row of rows)console.log(JSON.stringify({business:row.business_name,address:row.wallet_address,
   balance:formatEther(await chainClient.getBalance({address:row.wallet_address})),symbol:policy.symbol}));
}finally{await db.end();}
