import { db } from "./db.js";
import { issuePublicShortLink } from "./public-short-links.js";

const args = process.argv.slice(2);
let exitCode = 0;
try {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i], value = args[i + 1];
    if (!["--tracking-id", "--origin"].includes(name) || values.has(name) || !value || value.startsWith("--")) {
      throw new Error("Use --tracking-id <bytes32> and optionally --origin <https-origin> once each.");
    }
    values.set(name, value);
  }
  const trackingId = values.get("--tracking-id");
  if (!trackingId || !/^0x[0-9a-fA-F]{64}$/.test(trackingId)) throw new Error("Tracking ID must be a bytes32 value.");
  let origin: string | undefined;
  if (values.has("--origin")) {
    try {
      const url = new URL(values.get("--origin")!);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
      origin = url.origin;
    } catch { throw new Error("Origin must be HTTPS without credentials, a path, query or fragment."); }
  }
  const code = await issuePublicShortLink(db, trackingId);
  console.log("PUBLIC SHORT LINK READY.");
  console.log(`Tracking code: ${code}`);
  console.log(`Public path: /s/${code}`);
  if (origin) console.log(`Short link: ${origin}/s/${code}`);
} catch (error) {
  const safe = new Set([
    "Use --tracking-id <bytes32> and optionally --origin <https-origin> once each.",
    "Tracking ID must be a bytes32 value.",
    "Origin must be HTTPS without credentials, a path, query or fragment.",
    "Short code generator returned an invalid code.",
    "Tracking ID must resolve to an existing published product before shortening.",
    "Could not reserve a unique short code; retry later.",
  ]);
  const missing = error && typeof error === "object" && "code" in error && error.code === "ER_NO_SUCH_TABLE";
  console.error(missing ? "Apply tracking migrations 005 and 007 before issuing short links." :
    error instanceof Error && safe.has(error.message) ? error.message : "Short link issuance failed.");
  exitCode = 1;
} finally {
  try { await db.end(); }
  catch { console.error("Database cleanup failed."); exitCode = 1; }
}
process.exitCode = exitCode;
