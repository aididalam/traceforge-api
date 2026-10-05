import { readFile } from "node:fs/promises";
import { db } from "./db.js";
import { validatePresentation, savePublicPresentation } from "./public-presentation.js";

const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const bytes32 = /^0x[0-9a-fA-F]{64}$/;
let connection;
try {
  const args = process.argv.slice(2);
  const options = ["--tenant", "--entity", "--file"];
  const flags = ["--clear", "--confirm-public"];
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 1) {
    const option = args[i];
    if (seen.has(option) || (!options.includes(option) && !flags.includes(option))) throw new Error("Invalid public details arguments.");
    seen.add(option);
    if (options.includes(option) && (!args[++i] || args[i].startsWith("--"))) throw new Error("Missing public details argument.");
  }
  const tenant = seen.has("--tenant") ? arg("--tenant") : "";
  const entity = seen.has("--entity") ? arg("--entity") : "";
  if (!bytes32.test(tenant) || !bytes32.test(entity)) throw new Error("--tenant and --entity must be bytes32 references.");
  const tenantId = tenant.toLowerCase();
  const entityId = entity.toLowerCase();
  const clear = seen.has("--clear");
  if (clear ? seen.has("--file") || seen.has("--confirm-public") : !seen.has("--file") || !seen.has("--confirm-public")) {
    throw new Error("Use --file and --confirm-public to share details, or --clear to remove them.");
  }
  // Parse and validate only the explicitly selected public display file.
  // Original metadata documents are never automatically copied or published.
  const profile = clear ? null : validatePresentation(JSON.parse(await readFile(arg("--file"), "utf8")));
  connection = await db.getConnection();
  await connection.beginTransaction();
  await savePublicPresentation(connection, tenantId, entityId, profile);
  await connection.commit();
  console.log(clear ? "PUBLIC PRODUCT DETAILS CLEARED." : "PUBLIC PRODUCT DETAILS SHARED.");
} catch {
  if (connection) {
    try { await connection.rollback(); }
    catch { connection.destroy(); connection = undefined; }
  }
  console.error("Public details were not changed. Check the arguments, reviewed public file, indexed references and migration 006.");
  process.exitCode = 1;
} finally {
  connection?.release();
  await db.end();
}
