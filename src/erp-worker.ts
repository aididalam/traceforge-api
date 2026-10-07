import { db } from "./db.js";
import { processErpQueueOnce } from "./erp-queue.js";

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
try {
  do {
    try {
      const result = await processErpQueueOnce();
      if (process.argv.includes("--once") || result.processed) console.log(JSON.stringify({service: "traceforge-erp-worker", ...result}));
    } catch {
      console.error("TraceForge ERP queue unavailable; pending work is retained.");
      if (process.argv.includes("--once")) { process.exitCode = 1; break; }
    }
    if (process.argv.includes("--once") || stopping) break;
    await new Promise(done => setTimeout(done, 1000));
  } while (!stopping);
} finally { await db.end(); }
