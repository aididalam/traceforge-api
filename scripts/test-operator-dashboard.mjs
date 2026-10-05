import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Fastify from "fastify";
process.env.TRACEFORGE_BROADCAST_ENABLED="false";
const {db}=await import("../dist/db.js"),{registerOperatorRoutes}=await import("../dist/routes/operator.js");
const {credential,digest,hashPassword}=await import("../dist/operator-credentials.js");
const before=await liveState();
let conn,app;
async function liveState(){return {
 counts:(await db.query(`SELECT (SELECT COUNT(*) FROM entities) AS entities,(SELECT COUNT(*) FROM public_entity_publications) AS publications,(SELECT COUNT(*) FROM chain_write_operations) AS operations`))[0][0],
 tables:(await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'operator_%' ORDER BY TABLE_NAME"))[0],
 migrations:(await db.query("SELECT migration_name FROM api_schema_migrations ORDER BY migration_name"))[0]};}
try{
 conn=await db.getConnection();
 for(const name of ["tenants","organizations","tenant_memberships","entities","semantic_registry","offchain_documents","chain_events","chain_write_operations","business_product_records","custody_claims"]){
  const [rows]=await db.query("SHOW CREATE TABLE `"+name+"`");await conn.query(rows[0]["Create Table"].replace(/^CREATE TABLE/,"CREATE TEMPORARY TABLE"));
 }
 for(const sql of readFileSync("migrations/008_operator_accounts.sql","utf8").split(";").map(value=>value.trim()).filter(Boolean))await conn.query(sql.replace("CREATE TABLE IF NOT EXISTS","CREATE TEMPORARY TABLE"));
 // MySQL cannot reopen a connection-local TEMPORARY table under two aliases.
 // These empty mirrors represent the same empty document/semantic fixture;
 // only physical test table names change, never predicates, joins or values.
 for(const [original,mirror] of [["offchain_documents","operator_test_tenant_documents"],["offchain_documents","operator_test_holder_documents"],["semantic_registry","operator_test_state_semantics"]]){
  const [rows]=await db.query("SHOW CREATE TABLE `"+original+"`");
  await conn.query(rows[0]["Create Table"].replace("CREATE TABLE `"+original+"`","CREATE TEMPORARY TABLE `"+mirror+"`"));
 }
 const query=async(sql,args=[])=>conn.query(sql.replace("LEFT JOIN offchain_documents td","LEFT JOIN operator_test_tenant_documents td").replace("LEFT JOIN offchain_documents od","LEFT JOIN operator_test_holder_documents od").replace("LEFT JOIN semantic_registry st","LEFT JOIN operator_test_state_semantics st"),args).catch(error=>{console.error("Temporary fixture query failed:",error.code);throw error;});
 const q=async(sql,args=[])=>conn.query(sql,args);
 const h=byte=>"0x"+byte.repeat(32),tenant=h("ab"),other=h("12"),org=h("cd"),org2=h("ef"),product=h("34"),meta=h("56");
 const password="Synthetic-Only-Password-2026",invitation=credential("tfoi");
 for(const t of [tenant,other])await q("INSERT INTO tenants (tenant_id,metadata_hash,created_at,created_event_id,updated_event_id) VALUES (?,?,1,1,1)",[t,meta]);
 for(const o of [org,org2])await q("INSERT INTO organizations (organization_id,metadata_hash,created_at,created_event_id,updated_event_id) VALUES (?,?,1,1,1)",[o,meta]);
 for(const [t,o]of [[tenant,org],[tenant,org2],[other,org]])await q("INSERT INTO tenant_memberships (tenant_id,organization_id,joined_at,joined_event_id,updated_event_id) VALUES (?,?,1,1,1)",[t,o]);
 await q("INSERT INTO operator_invitations (invitation_hash,email,tenant_id,organization_id,expires_at) VALUES (?,?,?,?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 HOUR))",[digest(invitation),"operator@example.test",tenant,org]);
 const bound={query,getConnection:async()=>({query,beginTransaction:conn.beginTransaction.bind(conn),commit:conn.commit.bind(conn),rollback:conn.rollback.bind(conn),release:()=>{}})};
 app=Fastify({logger:false});await registerOperatorRoutes(app,{db:bound,chainId:9009,contractAddress:"0x"+"55".repeat(20)});
 const prefix="/operator/v1",post=(suffix,body,headers={})=>app.inject({method:"POST",url:prefix+suffix,payload:body,headers});
 const activation={email:"operator@example.test",password,name:"Demo Operator",invitationCode:invitation};
 assert.equal((await post("/activate",{...activation,email:"wrong@example.test"})).statusCode,400);
 assert.equal((await post("/activate",activation)).statusCode,200);assert.equal((await post("/activate",activation)).statusCode,400);
 const login=await post("/login",{email:activation.email,password});assert.equal(login.statusCode,200);const body=login.json(),headers={authorization:"Bearer "+body.sessionToken};
 const [stored]=await q("SELECT password_digest FROM operator_accounts");assert.ok(stored[0].password_digest.startsWith("scrypt$"));assert.notEqual(stored[0].password_digest,password);
 const [sessions]=await q("SELECT session_hash FROM operator_sessions");assert.equal(sessions[0].session_hash,digest(body.sessionToken));
 for(const t of [tenant,other])await q("INSERT INTO entities (tenant_id,entity_id,entity_type,metadata_hash,current_state,current_custodian,created_at,created_event_id,updated_event_id) VALUES (?,?,?,?,?,?,1,9007199254740993,9007199254740993)",[t,product,meta,meta,meta,org]);
 await q("INSERT INTO business_product_records (tracking_id,tenant_id,entity_id,creator_organization_id) VALUES (?,?,?,?)",[product,tenant,product,org]);
 let list=await app.inject({url:prefix+"/products",headers});assert.equal(list.statusCode,200);assert.equal(list.json().products.length,1);assert.equal(list.json().products[0].id,product);
 assert.equal((await app.inject({url:prefix+"/products?tenantId="+other,headers})).statusCode,400);
 assert.equal((await app.inject({url:prefix+"/products?after=9007199254740993",headers})).json().products.length,0);
 const transfer={tenantId:tenant,entityId:product,fromOrganizationId:org,toOrganizationId:org2,timestamp:"1791110400"};
 await q("INSERT INTO chain_events (id,chain_id,contract_address,block_number,block_hash,transaction_hash,transaction_index,log_index,topics,data,event_name,event_args) VALUES (9007199254741001,9009,?,1,?,?,0,0,JSON_ARRAY(),'0x','CustodyClaimed',?)",["0x"+"55".repeat(20),meta,h("78"),JSON.stringify(transfer)]);
 const history=await app.inject({url:prefix+"/products/"+product+"/history",headers});assert.equal(history.statusCode,200);assert.equal(history.json().events[0].id,"9007199254741001");assert.equal(history.json().events[0].occurredAt,"1791110400");assert.equal(history.json().events[0].organizationId,org2);
 const hiddenProduct=h("9a");await q("INSERT INTO entities (tenant_id,entity_id,entity_type,metadata_hash,current_state,current_custodian,created_at,created_event_id,updated_event_id) VALUES (?,?,?,?,?,?,1,2,2)",[other,hiddenProduct,meta,meta,meta,org]);
 assert.equal((await app.inject({url:prefix+"/products/"+hiddenProduct+"/history",headers})).statusCode,404);
 for(const [id,t,o]of [["12345678-1234-4234-8234-123456789abc",tenant,org],["12345678-1234-4234-8234-123456789def",tenant,org2],["12345678-1234-4234-8234-123456789aaa",other,org]])await q(`INSERT INTO chain_write_operations (operation_id,idempotency_key,request_hash,token_id,tenant_id,organization_id,entity_id,operation_name,role_id,status,transaction_hash,serialized_transaction,nonce,gas_estimate,gas_limit,request_json) VALUES (?,?,?,?,?,?,?,'recordTrace',?,'PREPARED',?,'SYNTHETIC_PRIVATE_SENTINEL',1,1,1,JSON_OBJECT('private','SYNTHETIC_PRIVATE_SENTINEL'))`,[id,id,meta,id,t,o,product,meta,"0x"+id.replaceAll("-","").padEnd(64,"0")]);
 const operations=await app.inject({url:prefix+"/operations",headers});assert.equal(operations.statusCode,200);assert.equal(operations.json().operations.length,2);assert.ok(!operations.body.includes("SYNTHETIC_PRIVATE_SENTINEL"));
 for(const [table,column,where,args]of [["operator_accounts","active","email=?",[activation.email]],["organizations","active","organization_id=?",[org]]]){
  await q(`UPDATE ${table} SET ${column}=FALSE WHERE ${where}`,args);assert.equal((await app.inject({url:prefix+"/me",headers})).statusCode,401);await q(`UPDATE ${table} SET ${column}=TRUE WHERE ${where}`,args);
 }
 await post("/logout",{},headers);assert.equal((await app.inject({url:prefix+"/me",headers})).statusCode,401);
 const again=await post("/login",{email:activation.email,password});const lastHeaders={authorization:"Bearer "+again.json().sessionToken};
 await q("UPDATE operator_sessions SET expires_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 MINUTE)");assert.equal((await app.inject({url:prefix+"/me",headers:lastHeaders})).statusCode,401);
 assert.deepEqual(await liveState(),before);
 console.log("Operator MySQL temporary-table checks passed: single-use bound activation, hashed passwords/sessions, exact cursors, tenant/product and organization-operation isolation, recorded transfer dates, live membership/account gates, logout/expiry. Live schema/data/migration ledger unchanged.");
}finally{try{await app?.close();}finally{conn?.destroy();try{assert.deepEqual(await liveState(),before);}finally{await db.end();}}}
