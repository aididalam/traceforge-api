import assert from "node:assert/strict";
import Fastify from "fastify";
import swagger from "@fastify/swagger";
import {loadSourceFile} from "./test-source-loader.mjs";
const {registerPublicProductRoutes}=await loadSourceFile("src/routes/public-products.ts");
const h=byte=>"0x"+byte.repeat(32),id=h("11"),tenant=h("22"),owner=h("33"),route=h("44");
let calls=0,published=true,failure=false;
const db={async query(sql,args){
 calls++;if(failure)throw Error("PRIVATE_SQL_SENTINEL");
 if(sql.includes("SELECT r.tenant_id,r.entity_id"))return [published&&args[0]===id?[{tenant_id:tenant,entity_id:id}]:[]];
 if(sql.includes("SELECT q.*"))return [[{initial_quantity:"9007199254740991",available_quantity:"9007199254740990",removed_quantity:"1",external_id:"EXTERNAL-1",private_note:"PRIVATE_DOCUMENT_SENTINEL"}]];
 if(sql.includes("GROUP BY reason"))return [[{reason:1,quantity:"1"}]];
 if(sql.includes("q.initial_quantity=1"))return [[]];
 if(sql.includes("SELECT r.*"))return [[{route_id:route,parent_route_id:h("00"),organization_id:owner,owner_name:null,received_quantity:"9007199254740991",available_quantity:"9007199254740990",version:"18446744073709551615",received_at:"1791024000",page_cursor:"9007199254741001",private_note:"PRIVATE_DOCUMENT_SENTINEL"}]];
 if(sql.includes("SUM(r.available_quantity)"))return [[{organization_id:owner,quantity:"9007199254740990",name:null,routes:2}]];
 if(sql.includes("SELECT r.tracking_id"))return [published?[{tracking_id:id,external_id:"EXTERNAL-1",created_event_id:"9007199254741001",initial_quantity:"9007199254740991",available_quantity:"9007199254740990",name:null,creator_organization_id:owner,origin_name:null,business_code:null,short_code:"0123456789ab",private_note:"PRIVATE_DOCUMENT_SENTINEL"}]:[]];
 throw Error("Unexpected public product query");
}};
const app=Fastify();
app.setErrorHandler((error,_request,reply)=>reply.code(error.validation?400:503).send({error:{code:"unavailable",message:"Check the request or retry later."}}));
await app.register(swagger,{openapi:{info:{title:"Synthetic product checks",version:"1"}}});
await registerPublicProductRoutes(app,{db,chainId:9009,contractAddress:"0x"+"55".repeat(20)});
try{
 for(const kind of ["quantity","routes","holders"]){
  const response=await app.inject("/public/v1/products/"+id+"/"+kind);assert.equal(response.statusCode,200,response.body);
  assert.equal(response.headers["cache-control"],"no-store");assert.ok(!response.body.includes("PRIVATE_DOCUMENT_SENTINEL"));
  if(kind==="quantity")assert.equal(response.json().availableQuantity,"9007199254740990");
  if(kind==="routes")assert.equal(response.json().routes[0].version,"18446744073709551615");
 }
 const search=await app.inject("/public/v1/products/search?id=EXTERNAL-1");assert.equal(search.statusCode,200);assert.equal(search.json().products.length,1);assert.ok(!search.body.includes("PRIVATE_DOCUMENT_SENTINEL"));
 const before=calls;
 for(const query of ["id=1&limit=101","id=1&after=18446744073709551616","id=1&id=2","id=1&businessCode=a-b","id=1&token=hidden"])
  assert.equal((await app.inject("/public/v1/products/search?"+query)).statusCode,400);
 for(const suffix of ["routes?limit=0","routes?after=18446744073709551616","routes?limit=1&limit=2","holders?after=1","quantity?limit=1","routes?token=hidden"])
  assert.equal((await app.inject("/public/v1/products/"+id+"/"+suffix)).statusCode,400);
 assert.equal(calls,before,"Invalid public input reached the database");
 published=false;
 for(const kind of ["quantity","routes","holders"])assert.equal((await app.inject("/public/v1/products/"+id+"/"+kind)).statusCode,404);
 assert.equal((await app.inject("/public/v1/products/search?id=EXTERNAL-1")).json().products.length,0);
 failure=true;
 const unavailable=await app.inject("/public/v1/products/search?id=1");assert.equal(unavailable.statusCode,503);assert.ok(!unavailable.body.includes("PRIVATE_SQL_SENTINEL"));
 await app.ready();assert.deepEqual(app.swagger().paths["/public/v1/products/search"].get.security,[]);
 console.log("Public product checks passed: strict response fields, 64-bit strings, publication gates, input/cursor bounds, duplicate-query rejection and sanitized failures.");
}finally{await app.close();}
