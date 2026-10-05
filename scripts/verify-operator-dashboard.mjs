import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
const moduleUrl=source=>"data:text/javascript;base64,"+Buffer.from(stripTypeScriptTypes(source)).toString("base64");
const credentialsText=readFileSync("src/operator-credentials.ts","utf8"),credentialsUrl=moduleUrl(credentialsText);
const {credential,digest,hashPassword}=await import(credentialsUrl);
const presentationUrl=moduleUrl(readFileSync("src/public-presentation.ts","utf8"));
const dataText=readFileSync("src/operator-data.ts","utf8"),dataUrl=moduleUrl(dataText.replace('"./public-presentation.js"',JSON.stringify(presentationUrl)));
const routeText=readFileSync("src/routes/operator.ts","utf8");
const {registerOperatorRoutes}=await import(moduleUrl(routeText.replace('"../operator-credentials.js"',JSON.stringify(credentialsUrl)).replace('"../operator-data.js"',JSON.stringify(dataUrl))));
const serverText=readFileSync("src/server.ts","utf8");
assert.match(serverText,/registerOperatorRoutes\(app/);assert.match(serverText,/!routePath.startsWith\("\/operator\/"\)/);
assert.doesNotMatch(routeText+dataText,/sendRawTransaction|writeContract|signTransaction|serialized_transaction|request_json|SELECT\s+\*/);
assert.match(credentialsText,/N: 131072/);assert.match(credentialsText,/hashing >= 2/);
const password="Synthetic-Only-Password-2026",passwordDigest=await hashPassword(password);
const h=byte=>"0x"+byte.repeat(32),tenant=h("ab"),org=h("cd"),product=h("ef");
const account={account_id:"12345678-1234-4234-8234-123456789abc",email:"operator@example.test",display_name:"Demo Operator",tenant_id:tenant,organization_id:org,active:1,tenant_active:1,organization_active:1,membership_active:1,password_digest:passwordDigest,locked_until:null,workspace_name:"Demo Workspace",organization_name:"Demo Producer"};
const sessions=new Map(),invitations=new Map();let calls=0,failures=0,failure=null;
const query=async(sql,args=[])=>{
 calls++;if(failure)throw failure;
 if(sql.includes("FROM operator_accounts a"))return [[sql.includes("JOIN operator_sessions") ? sessions.has(args[0])&&!sessions.get(args[0]).revoked?[account]:[] : args[0]===account.email?[account]:[]][0]];
 if(sql.startsWith("UPDATE operator_accounts")){if(sql.includes("LEAST")){failures++;if(failures>=5)account.locked_until=new Date(Date.now()+600000);}else{failures=0;account.locked_until=null;}return [{affectedRows:1}];}
 if(sql.startsWith("DELETE FROM operator_sessions"))return [{affectedRows:0}];
 if(sql.includes("COUNT(*) AS count FROM operator_sessions"))return [[{count:sessions.size}]];
 if(sql.startsWith("INSERT INTO operator_sessions")){sessions.set(args[0],{account:args[1],revoked:false});return [{affectedRows:1}];}
 if(sql.startsWith("UPDATE operator_sessions")){if(sessions.has(args[0]))sessions.get(args[0]).revoked=true;return [{affectedRows:1}];}
 if(sql.includes("FROM operator_invitations i")){const row=invitations.get(args[0]);return [[row&&row.email===args[1]&&!row.used&&row.expires>Date.now()&&account.membership_active?{invitation_hash:args[0]}:undefined].filter(Boolean)];}
 if(sql.startsWith("INSERT INTO operator_accounts"))return [{affectedRows:1}];
 if(sql.startsWith("UPDATE operator_invitations")){invitations.get(args[0]).used=true;return [{affectedRows:1}];}
 if(sql.includes("FROM entities e")){assert.ok(args.includes(org));assert.ok(!args.includes(h("12")));return [[{entity_id:product,created_cursor:"9007199254741001",closed:0,created_at:"1791024000",current_custodian:org,type_label:"Batch",status_label:"Packed",name:"Demo Tea",description:null,units:"100",packaging:"Packed",quality:null,revision:null,holder_name:"Demo Producer",private_document:"PRIVATE_SENTINEL"}]];}
 if(sql.includes("FROM chain_events ce")){assert.deepEqual(args.slice(0,4),[9009,"0x"+"55".repeat(20),"0",product]);return [[{id:"9007199254741001",event_name:"EntityCreated",label:null,occurred_at:"1791024000",organization_id:org,from_id:null,to_id:null,transaction_hash:h("34"),private_document:"PRIVATE_SENTINEL"}]];}
 if(sql.includes("FROM organizations o")){return [[{organization_id:org,name:"Demo Producer",type:"Producer",active:1}]];}
 if(sql.includes("FROM chain_write_operations")){assert.deepEqual(args,[org]);assert.doesNotMatch(sql,/serialized|request_json|error_message|idempotency/);return [[{operation_id:"12345678-1234-4234-8234-123456789def",entity_id:product,operation_name:"recordTrace",status:"CONFIRMED",transaction_hash:h("34"),block_number:"9007199254741003",created_at:new Date("2026-10-04T00:00:00Z"),updated_at:new Date("2026-10-04T00:00:01Z"),private_document:"PRIVATE_SENTINEL"}]];}
 throw Error("Unhandled synthetic query");
};
let committed=0,rolledBack=0;
const db={query,getConnection:async()=>({query,beginTransaction:async()=>{},commit:async()=>{committed++;},rollback:async()=>{rolledBack++;},release:()=>{}})};
const app=Fastify({logger:false});
await app.register(rateLimit,{max:120,timeWindow:"1 minute"});
await app.register(swagger,{openapi:{info:{title:"Synthetic operator checks",version:"1"},components:{securitySchemes:{operatorSession:{type:"http",scheme:"bearer"}}}}});
await registerOperatorRoutes(app,{db,chainId:9009,contractAddress:"0x"+"55".repeat(20)});
const prefix="/operator/v1",post=(suffix,body,headers={})=>app.inject({method:"POST",url:prefix+suffix,payload:body,headers});
try{
 const before=calls;
 for(const prefixPart of ["/operator","/%6fperator","/operat%6fr"])assert.equal((await app.inject(prefixPart+"/v1/products")).statusCode,401);
 assert.equal(calls,before,"Unauthenticated reads accessed DB");
 const bad=await post("/login",{email:account.email,password:"Synthetic wrong value"});
 const unknown=await post("/login",{email:"unknown@example.test",password:"Synthetic wrong value"});
 assert.equal(bad.statusCode,401);assert.deepEqual(bad.json(),unknown.json());
 const login=await post("/login",{email:account.email,password});assert.equal(login.statusCode,200);
 const body=login.json();assert.match(body.sessionToken,/^tfos_/);assert.equal(body.user.tenantId,tenant);assert.equal(body.user.access,"manage");assert.ok(!login.body.includes(passwordDigest));
 const headers={authorization:"Bearer "+body.sessionToken};
 for(const suffix of ["/me","/products","/businesses","/operations","/products/"+product+"/history"]){const response=await app.inject({url:prefix+suffix,headers});assert.equal(response.statusCode,200);assert.equal(response.headers["cache-control"],"no-store");assert.ok(!response.body.includes("PRIVATE_SENTINEL"));assert.ok(!response.body.includes("sessionToken"));}
 for(const suffix of ["/products?tenantId="+h("12"),"/products?after=18446744073709551616","/products?limit=101","/products?limit=1&limit=2","/me?token=synthetic"]){assert.equal((await app.inject({url:prefix+suffix,headers})).statusCode,400);}
 for(const field of ["active","organization_active"]){account[field]=0;assert.equal((await app.inject({url:prefix+"/me",headers})).statusCode,401);account[field]=1;}
 await post("/logout",{},headers);assert.equal((await app.inject({url:prefix+"/me",headers})).statusCode,401);
 // Invitation binding, single use, expiry and membership gates.
 const invitation=credential("tfoi");invitations.set(digest(invitation),{email:"new@example.test",used:false,expires:Date.now()+60000});
 const activation={email:"new@example.test",password,name:"New Operator",invitationCode:invitation};
 assert.equal((await post("/activate",{...activation,email:"other@example.test"})).statusCode,400);
 assert.equal((await post("/activate",activation)).statusCode,200);assert.equal(committed,1);
 assert.equal((await post("/activate",activation)).statusCode,400);assert.ok(rolledBack>=2);
 const expired=credential("tfoi");invitations.set(digest(expired),{email:"expired@example.test",used:false,expires:Date.now()-1});
 assert.equal((await post("/activate",{...activation,email:"expired@example.test",invitationCode:expired})).statusCode,400);
 const inactive=credential("tfoi");invitations.set(digest(inactive),{email:"inactive@example.test",used:false,expires:Date.now()+60000});account.membership_active=0;
 assert.equal((await post("/activate",{...activation,email:"inactive@example.test",invitationCode:inactive})).statusCode,400);account.membership_active=1;
 for(let i=0;i<6;i++)await post("/login",{email:account.email,password:"Synthetic wrong value"});
 assert.equal((await post("/login",{email:account.email,password})).statusCode,401,"Correct password bypassed the temporary account lockout");
 failure=Object.assign(Error("PRIVATE_SQL_SENTINEL"),{code:"ER_NO_SUCH_TABLE"});
 const unavailable=await app.inject({url:prefix+"/me",headers});assert.equal(unavailable.statusCode,503);assert.ok(!unavailable.body.includes("PRIVATE_SQL_SENTINEL"));failure=null;
 await app.ready();assert.deepEqual(app.swagger().paths["/operator/v1/login"].post.security,[]);assert.deepEqual(app.swagger().paths["/operator/v1/products"].get.security,[{operatorSession:[]}]);
 assert.equal((await post("/login",{email:account.email,password})).statusCode,429,"Login attempt rate limit missing");
 console.log("Operator offline checks passed: bound invites, single-use activation, password hashing, generic login errors, hashed sessions, logout/revocation, account/workspace/business gates, fixed reads, cursor bounds, private-field omission, sanitized errors and rate limits.");
}finally{await app.close();}
