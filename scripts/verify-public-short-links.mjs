import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { spawnSync } from "node:child_process";
import Fastify from "fastify";
import swagger from "@fastify/swagger";
import rateLimit from "@fastify/rate-limit";

const url = source => "data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64");
const issuerText = readFileSync("src/public-short-links.ts", "utf8");
const issuerUrl = url(issuerText);
const { issuePublicShortLink, newPublicShortCode, normalizeShortCode } = await import(issuerUrl);
const routeText = readFileSync("src/routes/public-short-links.ts", "utf8");
const { registerPublicShortLinkRoutes } = await import(url(routeText.replace('"../public-short-links.js"', JSON.stringify(issuerUrl))));
assert.doesNotMatch(issuerText + routeText, /offchain_documents|document_json|event_args|sendRawTransaction|writeContract|signer|\.post\(/);
assert.doesNotMatch(issuerText, /DELETE FROM|UPDATE public_entity_short_links|REPLACE INTO/);
const migration = readFileSync("migrations/007_public_entity_short_links.sql", "utf8");
assert.match(migration, /PRIMARY KEY \(short_code\)/);
assert.match(migration, /UNIQUE KEY public_short_tracking \(tracking_id\)/);
assert.match(migration, /ascii_bin/);
const serverText = readFileSync("src/server.ts", "utf8");
assert.match(serverText, /await registerPublicShortLinkRoutes\(app, \{ db \}\)/);
assert.doesNotMatch(serverText, /trustProxy\s*:\s*true/);
for (let i = 0; i < 50; i++) assert.ok(normalizeShortCode(newPublicShortCode()));
const h = byte => "0x" + byte.repeat(32);
const tenant = h("ab"), otherTenant = h("12"), entity = h("cd");
const idA = h("34"), idB = h("56"), idC = h("78"), idD = h("9a"), unknown = h("ef");
const codeA = "0123456789ab", codeB = "mnpqrstvwxyz", codeC = "abcdef012345", codeD = "789abcdef012";
const key = row => row.tenant_id + "/" + row.entity_id;
const tracking = new Map([[idA,{tenant_id:tenant,entity_id:entity}], [idB,{tenant_id:otherTenant,entity_id:entity}],
  [idC,{tenant_id:h("ac"),entity_id:entity}], [idD,{tenant_id:h("ad"),entity_id:entity}]]);
const published = new Set([...tracking.values()].map(key)), entities = new Set(published), shorts = new Map();
const eligible = id => tracking.has(id) && published.has(key(tracking.get(id))) && entities.has(key(tracking.get(id)));
let calls = 0, failure = null, race = false;
const db = { async query(sql, values) {
  calls++;
  assert.match(sql,/JOIN public_entity_publications/); assert.match(sql,/JOIN entities/);
  assert.match(sql,/JOIN public_entity_tracking_ids|FROM public_entity_tracking_ids/);
  assert.doesNotMatch(sql,/SELECT\s+\*|offchain_documents|document_json|event_args/i);
  if (failure) throw failure;
  if (sql.includes("INSERT INTO")) {
    const [code,id]=values;
    if (!eligible(id)) return [{affectedRows:0}];
    if (race) { shorts.set(codeC,id); race=false; }
    if (shorts.has(code) || [...shorts.values()].includes(id)) throw Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"),{code:"ER_DUP_ENTRY"});
    shorts.set(code,id); return [{affectedRows:1}];
  }
  const lookupByCode = sql.includes("WHERE s.short_code = ?");
  const code = lookupByCode ? values[0] : [...shorts].find(([,id])=>id===values[0])?.[0];
  const id = shorts.get(code);
  return [eligible(id) ? [{ short_code:code,tracking_id:id,...tracking.get(id),private_document:"SYNTHETIC_PRIVATE_SENTINEL" }] : []];
} };
assert.equal(await issuePublicShortLink(db,idA,()=>codeA),codeA);
assert.equal(await issuePublicShortLink(db,idA.toUpperCase().replace("0X","0x"),()=>{throw new Error("Must reuse code");}),codeA);
let attempts=0;
assert.equal(await issuePublicShortLink(db,idB,()=>++attempts===1?codeA:codeB),codeB);
assert.equal(attempts,2); assert.equal(shorts.get(codeA),idA);
race=true;
assert.equal(await issuePublicShortLink(db,idC,()=>codeD),codeC,"Concurrent issuer must win without reassignment");
await assert.rejects(issuePublicShortLink(db,idD,()=>codeA),/unique short code/);
assert.equal(shorts.size,3);
const beforeInvalid=calls;
await assert.rejects(issuePublicShortLink(db,"bad"),/bytes32/); assert.equal(calls,beforeInvalid);
await assert.rejects(issuePublicShortLink(db,unknown,()=>codeD),/existing published product/);
await assert.rejects(issuePublicShortLink(db,idD,()=>"bad"),/invalid code/);
assert.equal(normalizeShortCode(codeA.toUpperCase()),codeA);
for(const code of ["bad","i".repeat(12),"o".repeat(12),"u".repeat(12),codeA+"/",codeA+"?url=external"]) assert.equal(normalizeShortCode(code),null);

const optionsText=serverText.match(/await app\.register\(\s*rateLimit,\s*([\s\S]*?)\n\);/)?.[1].replace(/,\s*$/,"");
const handlerText=serverText.match(/app\.setErrorHandler\(\s*([\s\S]*?)\n\);/)?.[1].replace(/,\s*$/,"");
const apiError=serverText.match(/function apiError\([\s\S]*?\n\}/)?.[0];
assert.ok(optionsText&&handlerText&&apiError);
const perimeter=await import(url(`${apiError}\nexport const options=${optionsText};\nexport const handler=${handlerText};`));
const isolatedAuth=readFileSync("src/auth.ts","utf8")
  .replace(/import\s*\{\s*config,?\s*\}\s*from "\.\/config\.js";/,"const config={};")
  .replace(/import\s*\{\s*db,?\s*\}\s*from "\.\/db\.js";/,'const db={query(){throw Error("Offline auth probe accessed DB");}};');
assert.doesNotMatch(isolatedAuth,/from "\.\//);
const {authHook}=await import(url(isolatedAuth));
const app=Fastify({logger:false});
app.setErrorHandler(perimeter.handler); app.addHook("preHandler",authHook);
await app.register(swagger,{openapi:{info:{title:"Short link verification",version:"1"}}});
await registerPublicShortLinkRoutes(app,{db}); app.get("/v1/probe",async()=>({private:true}));
await app.ready();
const path=code=>"/public/v1/short-links/"+code;
try {
  for(const [code,id,t] of [[codeA,idA,tenant],[codeB,idB,otherTenant]]) {
    const result=await app.inject(path(code.toUpperCase()));
    assert.equal(result.statusCode,200); assert.equal(result.headers["cache-control"],"no-store");
    assert.equal(result.headers.location,undefined);
    assert.deepEqual(result.json(),{shortCode:code,trackingId:id,tenantId:t,entityId:entity});
    assert.ok(!result.body.includes("SYNTHETIC_PRIVATE_SENTINEL"));
  }
  published.delete(key(tracking.get(idA)));
  const hidden=await app.inject(path(codeA)),missing=await app.inject(path(codeD));
  assert.equal(hidden.statusCode,404); assert.deepEqual(hidden.json(),missing.json());
  await assert.rejects(issuePublicShortLink(db,idA,()=>codeD),/existing published product/);
  assert.equal(shorts.get(codeA),idA,"Hidden code reservation must persist");
  published.add(key(tracking.get(idA)));
  assert.equal(await issuePublicShortLink(db,idA,()=>{throw Error("Must reuse after republishing");}),codeA);
  entities.delete(key(tracking.get(idA)));
  assert.deepEqual((await app.inject(path(codeA))).json(),missing.json());
  entities.add(key(tracking.get(idA)));
  const saved=tracking.get(idA); tracking.delete(idA);
  assert.deepEqual((await app.inject(path(codeA))).json(),missing.json()); tracking.set(idA,saved);
  const before=calls;
  for(const request of [path("bad"),path("i".repeat(12)),path(codeA)+"?token=synthetic",path(codeA)+"?url=https://external.example"])
    assert.equal((await app.inject(request)).statusCode,400);
  assert.equal(calls,before,"Invalid codes and query targets must not access DB");
  assert.equal((await app.inject({method:"POST",url:path(codeA)})).statusCode,404);
  for(const prefix of ["/v1","/v%31","/%76%31"]) assert.equal((await app.inject(prefix+"/probe")).statusCode,401);
  assert.deepEqual(app.swagger().paths["/public/v1/short-links/{shortCode}"].get.security,[]);
  failure=Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"),{code:"ER_NO_SUCH_TABLE"});
  const unavailable=await app.inject(path(codeA)); assert.equal(unavailable.statusCode,503);
  assert.ok(!unavailable.body.includes("SYNTHETIC_PRIVATE_SQL")); failure=null;
} finally {await app.close();}
const limited=Fastify({logger:false});
limited.setErrorHandler(perimeter.handler); await limited.register(rateLimit,{...perimeter.options,max:2});
await registerPublicShortLinkRoutes(limited,{db}); limited.get("/v1/probe",async()=>({}));
try {
  assert.equal((await limited.inject(path(codeA))).statusCode,200);
  assert.equal((await limited.inject("/v1/probe")).statusCode,200);
  const result=await limited.inject({url:path(codeA).replace("public","%70ublic"),headers:{"x-forwarded-for":"192.0.2.8"}});
  assert.equal(result.statusCode,429); assert.ok(result.headers["retry-after"]);
} finally {await limited.close();}
const env={...process.env,DOTENV_CONFIG_PATH:"/dev/null",TRACEFORGE_CHAIN_ID:"9009",TRACEFORGE_CONTRACT_ADDRESS:"0x"+"55".repeat(20),
  TRACEFORGE_BROADCAST_ENABLED:"false",MYSQL_HOST:"127.0.0.1",MYSQL_PORT:"1",MYSQL_DATABASE:"unused_test",MYSQL_USER:"unused_test",MYSQL_PASSWORD:"unused_test_value"};
for(const args of [[],["--tracking-id","bad"],["--tracking-id",idA,"--tracking-id",idB],
  ["--tracking-id",idA,"--origin","https://trace.example/s/path"],
  ["--tracking-id",idA,"--origin","https://trace.example?token=synthetic"],
  ["--tracking-id",idA,"--origin","https://user:synthetic@trace.example"],
  ["--tracking-id",idA,"--origin","http://trace.example"],
  ["--tracking-id",idA,"--url","https://external.example"]]) {
  const result=spawnSync(process.execPath,["--import","tsx","src/issue-public-short-link.ts",...args],{env,encoding:"utf8",timeout:10000});
  assert.equal(result.error,undefined); assert.notEqual(result.status,0);
  assert.match(result.stdout+result.stderr,/Use --tracking-id|must be a bytes32|Origin must be HTTPS/);
}
console.log("Public short links verified: stable random aliases, collision/race retries, no reassignment, tenant/publication/orphan isolation, strict responses, auth/rate perimeter and safe CLI arguments.");
