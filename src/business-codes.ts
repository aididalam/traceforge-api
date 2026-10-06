import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export function normalizeBusinessCode(value:unknown):string {
 if(typeof value!=="string"||!/^[A-Z0-9]{1,16}$/.test(value.trim().toUpperCase()))throw new Error("Invalid business code.");
 return value.trim().toUpperCase();
}

export async function backfillBusinessCodes(db:Pick<Pool,"query"|"getConnection">):Promise<number>{
 const [rows]=await db.query<RowDataPacket[]>("SELECT organization_id FROM business_wallets ORDER BY created_at,organization_id");
 for(const row of rows){
  const connection=await db.getConnection();
  try{await connection.beginTransaction();await reserveBusinessCode(connection,row.organization_id);await connection.commit();}
  catch(error){await connection.rollback();throw error;}
  finally{connection.release();}
 }
 return rows.length;
}
export function businessCodeAt(length:number,ordinal:bigint):string {
 if(length<1||length>16||ordinal<0n||ordinal>=36n**BigInt(length))throw new Error("Invalid business code sequence.");
 let code="";
 for(let i=0;i<length;i++){code=alphabet[Number(ordinal%36n)]+code;ordinal/=36n;}
 return code;
}
// Caller owns a transaction. Lock a real business row, then the shared allocator.
export async function reserveBusinessCode(conn:Pick<PoolConnection,"query">,organizationId:string,custom?:string):Promise<string> {
 const wanted=custom===undefined?undefined:normalizeBusinessCode(custom);
 await conn.query("SELECT organization_id FROM business_wallets WHERE organization_id=? FOR UPDATE",[organizationId]);
 const [existing]=await conn.query<RowDataPacket[]>("SELECT code FROM business_code_reservations WHERE organization_id=?",[organizationId]);
 if(existing[0]){if(wanted&&wanted!==existing[0].code)throw new Error("Business code is already reserved.");return existing[0].code;}
 if(wanted){
  try {await conn.query("INSERT INTO business_code_reservations(code,organization_id) VALUES(?,?)",[wanted,organizationId]);return wanted;}
  catch(error){if((error as {code?:string}).code==="ER_DUP_ENTRY")throw new Error("Business code is unavailable.");throw error;}
 }
 const [rows]=await conn.query<RowDataPacket[]>("SELECT code_length,CAST(ordinal AS CHAR) AS ordinal FROM business_code_sequence WHERE sequence_id=1 FOR UPDATE");
 let length=Number(rows[0].code_length),ordinal=BigInt(rows[0].ordinal);
 for(;;){
  if(ordinal===36n**BigInt(length)){length++;ordinal=0n;}
  if(length>16)throw new Error("Business code capacity exhausted.");
  const code=businessCodeAt(length,ordinal++);
  await conn.query("UPDATE business_code_sequence SET code_length=?,ordinal=? WHERE sequence_id=1",[length,ordinal.toString()]);
  try {await conn.query("INSERT INTO business_code_reservations(code,organization_id) VALUES(?,?)",[code,organizationId]);return code;}
  catch(error){if((error as {code?:string}).code!=="ER_DUP_ENTRY")throw error;}
 }
}
