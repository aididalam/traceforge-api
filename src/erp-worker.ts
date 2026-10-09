import { db } from "./db.js";
import { processErpQueueOnce } from "./erp-queue.js";
import {processReceiptApprovalsOnce,reconcileErpReceipts} from './receipt-requests.js';
import {writeFile} from 'node:fs/promises';

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
const heartbeat=process.env.TRACEFORGE_WORKER_HEARTBEAT?setInterval(()=>{
 void db.query('SELECT 1').then(()=>writeFile('/tmp/service-heartbeat',String(Date.now()))).catch(()=>{});
},20000):undefined;
heartbeat?.unref();
try {
  do {
    try {
      await processReceiptApprovalsOnce({shouldStop:()=>stopping});
      await reconcileErpReceipts();
      const result = await processErpQueueOnce({shouldStop:()=>stopping});
      if(process.env.TRACEFORGE_WORKER_HEARTBEAT)await writeFile('/tmp/service-heartbeat',String(Date.now()));
      if (process.argv.includes("--once") || result.processed) console.log(JSON.stringify({service: "traceforge-erp-worker", ...result}));
    } catch (error) {
      // Codes aid recovery diagnostics; never log SQL, request bodies, keys or
      // provider error messages, which can contain credentials or signed data.
      const value=error instanceof Error && 'code' in error ? error.code : null;
      const code=typeof value==='string' && /^(ER_[A-Z0-9_]{1,64}|ECONNRESET|ECONNREFUSED|ETIMEDOUT)$/.test(value) ? value : 'unavailable';
      console.error(`TraceForge ERP queue unavailable (${code}); pending work is retained.`);
      if (process.argv.includes("--once")) { process.exitCode = 1; break; }
    }
    if (process.argv.includes("--once") || stopping) break;
    await new Promise(done => setTimeout(done, 1000));
  } while (!stopping);
} finally { if(heartbeat)clearInterval(heartbeat);await db.end(); }
