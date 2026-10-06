import type { FastifyInstance } from "fastify";
import type { Pool,RowDataPacket } from "mysql2/promise";
import {quantitySchema,routesSchema,holdersSchema,searchSchema} from "../product-schemas.js";
import { productId } from "../product-input.js";
import { normalizeBusinessCode } from "../business-codes.js";
import { productRoutes,productHolders,quantitySummary,searchProductReferences } from "../product-quantity.js";
export async function registerPublicProductRoutes(app:FastifyInstance,deps:{db:Pick<Pool,"query">;chainId:number;contractAddress:string}){
 const scope:[number,string]=[deps.chainId,deps.contractAddress.toLowerCase()];
 const bytes32="^0x[0-9a-fA-F]{64}$",numeric="^(0|[1-9][0-9]{0,19})$";
 const fail=(reply:import("fastify").FastifyReply,status:number)=>reply.code(status).send({error:{code:status===404?"product_not_found":"invalid_request",message:status===404?"Product was not found.":"Check the search or pagination parameters."}});
 app.get<{Querystring:{id:string;businessCode?:string;after?:string;limit?:string}}>("/public/v1/products/search",{
  schema:{tags:["public-discovery"],security:[],response:{200:searchSchema},querystring:{type:"object",additionalProperties:false,required:["id"],properties:{
   id:{type:"string",minLength:1,maxLength:120},businessCode:{type:"string",minLength:1,maxLength:16},after:{type:"string",pattern:numeric},limit:{type:"string",pattern:"^[0-9]{1,3}$"}}}}},async(request,reply)=>{
  reply.header("Cache-Control","no-store");
  const query=new URL(request.url,"http://public.local").searchParams;
  if([...query.keys()].some(key=>!["id","businessCode","after","limit"].includes(key)||query.getAll(key).length!==1))return fail(reply,400);
  let id:string,code:string|undefined;
  const after=request.query.after??"0",limit=Number(request.query.limit??50);
  try{id=productId(request.query.id);code=request.query.businessCode?normalizeBusinessCode(request.query.businessCode):undefined;}
  catch{return fail(reply,400);}
  if(BigInt(after)>18446744073709551615n||limit<1||limit>100)return fail(reply,400);
  return searchProductReferences(deps.db,scope,id,code,after,limit);
 });
 for(const kind of ["quantity","routes","holders"]){app.get<{Params:{trackingId:string};Querystring:{after?:string;limit?:string}}>("/public/v1/products/:trackingId/"+kind,{
  schema:{tags:["public-discovery"],security:[],response:{200:kind==="quantity"?quantitySchema:kind==="routes"?routesSchema:holdersSchema},params:{type:"object",additionalProperties:false,required:["trackingId"],properties:{trackingId:{type:"string",pattern:bytes32}}},
   querystring:{type:"object",additionalProperties:false,properties:kind==="quantity"?{}:{after:{type:"string",pattern:kind==="holders"?bytes32:numeric},limit:{type:"string",pattern:"^[0-9]{1,3}$"}}}}},async(request,reply)=>{
  reply.header("Cache-Control","no-store");
  const query=new URL(request.url,"http://public.local").searchParams;
  if([...query.keys()].some(key=>kind==="quantity"||!["after","limit"].includes(key)||query.getAll(key).length!==1))return fail(reply,400);
  const limit=Number(request.query.limit??50),after=request.query.after??(kind==="holders"?"0x"+"0".repeat(64):"0");
  if(limit<1||limit>100||kind==="routes"&&BigInt(after)>18446744073709551615n)return fail(reply,400);
  const [refs]=await deps.db.query<RowDataPacket[]>(`SELECT r.tenant_id,r.entity_id FROM business_product_records r
   JOIN public_entity_publications p ON p.tenant_id=r.tenant_id AND p.entity_id=r.entity_id
   JOIN product_quantities q ON q.chain_id=r.chain_id AND q.contract_address=r.contract_address AND q.tenant_id=r.tenant_id AND q.entity_id=r.entity_id
   WHERE r.tracking_id=? AND r.confirmed=TRUE AND r.chain_id=? AND r.contract_address=?`,[request.params.trackingId.toLowerCase(),...scope]);
  if(!refs[0])return fail(reply,404);
  const ref=refs[0];
  return kind==="quantity"?quantitySummary(deps.db,scope,ref.tenant_id,ref.entity_id):kind==="routes"?
   productRoutes(deps.db,scope,ref.tenant_id,ref.entity_id,after,limit):productHolders(deps.db,scope,ref.tenant_id,ref.entity_id,after.toLowerCase(),limit);
 });}
}
