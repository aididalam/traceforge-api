import { db } from "./db.js";
import { backfillBusinessCodes } from "./business-codes.js";
try {
 const count=await backfillBusinessCodes(db);
 console.log(`Business code reservations verified for ${count} businesses.`);
}finally{await db.end();}
