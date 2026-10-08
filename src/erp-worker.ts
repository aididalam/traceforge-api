import { db } from "./db.js";
import { processErpQueueOnce } from "./erp-queue.js";
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
      const result = await processErpQueueOnce({shouldStop:()=>stopping});
      if(process.env.TRACEFORGE_WORKER_HEARTBEAT)await writeFile('/tmp/service-heartbeat',String(Date.now()));
      if (process.argv.includes("--once") || result.processed) console.log(JSON.stringify({service: "traceforge-erp-worker", ...result}));
    } catch {
      console.error("TraceForge ERP queue unavailable; pending work is retained.");
      if (process.argv.includes("--once")) { process.exitCode = 1; break; }
    }
    if (process.argv.includes("--once") || stopping) break;
    await new Promise(done => setTimeout(done, 1000));
  } while (!stopping);
} finally { if(heartbeat)clearInterval(heartbeat);await db.end(); }
