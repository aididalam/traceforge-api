import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { AuthenticationBusy, credential, digest, emailPattern, hashPassword, invitationPattern, sessionLifetime, verifyPassword } from "../operator-credentials.js";
import { businesses, operations, products, productHistory, text } from "../operator-data.js";
import type { businessActions } from "../business.js";
import type { OperatorPrincipal } from "../operator-data.js";
import { normalizeProductFields } from "../product-metadata.js";
import type { CreateInput } from "../business.js";
declare module "fastify" { interface FastifyContextConfig { operatorPublic?: boolean } }

const bytes32 = /^0x[0-9a-fA-F]{64}$/;
const contexts = new WeakMap<FastifyRequest, OperatorPrincipal>();
const noQuery = { type:"object", additionalProperties:false, properties:{} } as const;
const pageQuery = { type:"object", additionalProperties:false, properties:{ after:{type:"string",pattern:"^(0|[1-9][0-9]{0,19})$"}, limit:{type:"string",pattern:"^[0-9]{1,3}$"} } } as const;
const productParams = { type:"object",additionalProperties:false,required:["productId"],properties:{productId:{type:"string",pattern:bytes32.source}} } as const;
const loginBody = { type:"object",additionalProperties:false,required:["email","password"],properties:{email:{type:"string",minLength:3,maxLength:254},password:{type:"string",minLength:1,maxLength:128}} } as const;
const failure = (code:string,message:string)=>({error:{code,message}});
const principal=(row:RowDataPacket):OperatorPrincipal=>({accountId:row.account_id,email:row.email,name:row.display_name,
  tenantId:row.tenant_id,organizationId:row.organization_id,workspaceName:text(row.workspace_name),organizationName:text(row.organization_name),access:"manage"});
const eligible = (row:RowDataPacket) => Boolean(row.active && row.organization_active);
const accountSelect = `SELECT a.account_id,a.email,a.display_name,a.tenant_id,a.organization_id,a.active,
  a.password_digest,a.locked_until, t.active AS tenant_active,o.active AS organization_active,m.active AS membership_active,
  JSON_UNQUOTE(JSON_EXTRACT(td.document_json,'$.name')) AS workspace_name,
  JSON_UNQUOTE(JSON_EXTRACT(od.document_json,'$.name')) AS organization_name
  FROM operator_accounts a LEFT JOIN tenants t ON t.tenant_id=a.tenant_id
  JOIN organizations o ON o.organization_id=a.organization_id
  LEFT JOIN tenant_memberships m ON m.tenant_id=a.tenant_id AND m.organization_id=a.organization_id
  LEFT JOIN offchain_documents td ON td.content_hash=t.metadata_hash AND td.document_kind='tenant'
  LEFT JOIN offchain_documents od ON od.content_hash=o.metadata_hash AND od.document_kind='organization'`;
const context=(request:FastifyRequest)=>contexts.get(request)!;
function pagination(query:{after?:string;limit?:string}) {
  const after=query.after??"0",limit=Number(query.limit??"50");
  if(BigInt(after)>18446744073709551615n||!Number.isInteger(limit)||limit<1||limit>100)throw new Error("Invalid pagination.");
  return {after,limit};
}

export async function registerOperatorRoutes(app:FastifyInstance, deps:{db:Pick<Pool,"query"|"getConnection">;chainId:number;contractAddress:string;actions?:typeof businessActions}) {
  const {db}=deps,scope:[number,string]=[deps.chainId,deps.contractAddress.toLowerCase()];
  await app.register(async operator=>{
    operator.addHook("onRequest",async(_request,reply)=>{reply.header("Cache-Control","no-store");});
    operator.addHook("preValidation",async(request,reply)=>{
      const query=new URL(request.url,"http://operator.local").searchParams;
      const route=request.routeOptions.url??"";
      const paging=route.endsWith("/products")||route.endsWith("/history");
      if([...query.keys()].some(key=>!paging||!["after","limit"].includes(key))||query.getAll("after").length>1||query.getAll("limit").length>1)
        return reply.code(400).send(failure("invalid_request","Invalid request parameters."));
      const allowed=route.endsWith("/signup")?["email","password","name","businessName","businessType","publicProfile"]:route.endsWith("/create")?["name","description","fields","publish","idempotencyKey"]:route.endsWith("/receive")?["version","confirmed","idempotencyKey"]:route.endsWith("/close")?["reason","confirmed","idempotencyKey"]:route.endsWith("/login")?["email","password"]:route.endsWith("/activate")?["email","password","name","invitationCode"]:[];
      if(request.body&&typeof request.body==='object'&&Object.keys(request.body).some(key=>!allowed.includes(key)))
        return reply.code(400).send(failure("invalid_request","Check the information provided."));
      if(route.endsWith("/create")&&request.body&&typeof request.body==='object'){
        try{normalizeProductFields((request.body as Record<string,unknown>).fields);}
        catch{return reply.code(400).send(failure("invalid_request","Check the additional product details."));}
      }
    });
    operator.setErrorHandler((error,_request,reply)=>{
      const problem=error as {code?:string;status?:number;statusCode?:number;validation?:unknown};
      if (problem.status && problem.code && ["writes_disabled","invalid_request","business_busy","request_conflict","operation_failed",
        "operation_not_allowed","chain_unavailable","receipt_unverified","signup_unavailable","account_unavailable","product_not_found",
        "business_not_ready","receipt_confirmation_required","close_confirmation_required"].includes(problem.code))
        return reply.code(problem.status).send(failure(problem.code, "The operation could not be completed. Refresh and check the product."));
      if(problem.statusCode===429||error instanceof AuthenticationBusy) return reply.header("Retry-After","60").code(429).send(failure("rate_limit_exceeded","Please retry later."));
      if(problem.validation||problem.statusCode===400) return reply.code(400).send(failure("invalid_request","Check the information provided."));
      // Database errors can include credential-bearing SQL parameters. Never log them.
      return reply.code(503).send(failure("operator_unavailable","Business dashboard is temporarily unavailable."));
    });
    operator.addHook("preHandler",async(request,reply)=>{
      if((request.routeOptions.config as {operatorPublic?:boolean}).operatorPublic)return;
      const token=/^Bearer (tfos_[A-Za-z0-9_-]{43})$/.exec(request.headers.authorization??"")?.[1];
      if(!token)return reply.code(401).send(failure("authentication_required","Sign in to continue."));
      const [rows]=await db.query<RowDataPacket[]>(`${accountSelect}
        JOIN operator_sessions s ON s.account_id=a.account_id
        WHERE s.session_hash=? AND s.revoked=FALSE AND s.expires_at>CURRENT_TIMESTAMP LIMIT 1`,[digest(token)]);
      if(!rows[0]||!eligible(rows[0]))return reply.code(401).send(failure("authentication_required","Sign in to continue."));
      contexts.set(request,principal(rows[0]));
    });
    operator.post<{Body:{email:string;password:string;name:string;businessName:string;businessType:string;publicProfile:boolean}}>("/signup", {
      config:{operatorPublic:true,rateLimit:{max:5,timeWindow:"1 minute"}},bodyLimit:4096,
      schema:{tags:["operator-access"],security:[],querystring:noQuery,body:{...loginBody,
        required:["email","password","name","businessName","businessType","publicProfile"],properties:{...loginBody.properties,
          password:{type:"string",minLength:12,maxLength:128},name:{type:"string",minLength:1,maxLength:120},
          businessName:{type:"string",minLength:1,maxLength:120},businessType:{type:"string",enum:["Producer","Distributor","Transporter","Warehouse","Shop","Other business"]},
          publicProfile:{type:"boolean"}}}}},async(request,reply)=>{
      if(!emailPattern.test(request.body.email.trim().toLowerCase())||![request.body.name,request.body.businessName].every(value=>value.trim()))
        return reply.code(400).send(failure("invalid_request","Check your name and email address."));
      if(!deps.actions)return reply.code(503).send(failure("signup_unavailable","Business signup is temporarily unavailable."));
      return deps.actions.signup(request.body);
    });
    operator.post<{Body:{email:string;password:string}}>("/login",{
      config:{operatorPublic:true,rateLimit:{max:10,timeWindow:"1 minute"}},bodyLimit:4096,
      schema:{tags:["operator-access"],security:[],querystring:noQuery,body:loginBody},
    },async(request,reply)=>{
      const email=request.body.email.trim().toLowerCase();
      if(!emailPattern.test(email))return reply.code(400).send(failure("invalid_request","Enter a valid email address."));
      const [rows]=await db.query<RowDataPacket[]>(`${accountSelect} WHERE a.email=? LIMIT 1`,[email]);
      const row=rows[0],valid=await verifyPassword(request.body.password,row?.password_digest??null);
      const locked=row?.locked_until&&new Date(row.locked_until).getTime()>Date.now();
      if(!valid||!row||!eligible(row)||locked){
        if(row&&!valid)await db.query(`UPDATE operator_accounts SET
          locked_until=IF(failed_attempts+1>=5,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 10 MINUTE),locked_until),
          failed_attempts=LEAST(failed_attempts+1,5) WHERE account_id=?`,[row.account_id]);
        return reply.code(401).send(failure("invalid_credentials","Email or password is incorrect, or access is unavailable."));
      }
      await db.query("UPDATE operator_accounts SET failed_attempts=0,locked_until=NULL WHERE account_id=?",[row.account_id]);
      // Bound session rows per account; revoked/expired sessions do not remain forever.
      await db.query("DELETE FROM operator_sessions WHERE account_id=? AND (revoked=TRUE OR expires_at<=CURRENT_TIMESTAMP)",[row.account_id]);
      const [counts]=await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM operator_sessions WHERE account_id=?",[row.account_id]);
      if(Number(counts[0].count)>=10)return reply.header("Retry-After","60").code(429).send(failure("session_limit","Too many active sessions. Sign out on another device or try later."));
      const token=credential("tfos"),expiresAt=new Date(Date.now()+sessionLifetime);
      await db.query("INSERT INTO operator_sessions (session_hash,account_id,expires_at) VALUES (?,?,?)",[digest(token),row.account_id,expiresAt]);
      return {sessionToken:token,expiresAt:expiresAt.toISOString(),user:principal(row)};
    });
    operator.post<{Body:{email:string;password:string;name:string;invitationCode:string}}>("/activate",{
      config:{operatorPublic:true,rateLimit:{max:5,timeWindow:"1 minute"}},bodyLimit:4096,
      schema:{tags:["operator-access"],security:[],querystring:noQuery,body:{...loginBody,required:["email","password","name","invitationCode"],
        properties:{...loginBody.properties,password:{type:"string",minLength:12,maxLength:128},name:{type:"string",minLength:1,maxLength:120},invitationCode:{type:"string",pattern:invitationPattern.source}}}},
    },async(request,reply)=>{
      const {password,invitationCode}=request.body,email=request.body.email.trim().toLowerCase(),name=request.body.name.trim();
      if(!name||!emailPattern.test(email))return reply.code(400).send(failure("invalid_request","Check your name and email address."));
      const conn=await db.getConnection();
      try{
        await conn.beginTransaction();
        const [rows]=await conn.query<RowDataPacket[]>(`SELECT i.invitation_hash FROM operator_invitations i
          JOIN tenants t ON t.tenant_id=i.tenant_id AND t.active=TRUE
          JOIN organizations o ON o.organization_id=i.organization_id AND o.active=TRUE
          JOIN tenant_memberships m ON m.tenant_id=i.tenant_id AND m.organization_id=i.organization_id AND m.active=TRUE
          WHERE i.invitation_hash=? AND i.email=? AND i.used_at IS NULL AND i.expires_at>CURRENT_TIMESTAMP FOR UPDATE`,[digest(invitationCode),email]);
        if(!rows.length){await conn.rollback();return reply.code(400).send(failure("invalid_invitation","This invitation cannot be used. Ask your administrator for a new invitation."));}
        const passwordDigest=await hashPassword(password);
        await conn.query(`INSERT INTO operator_accounts (account_id,email,display_name,tenant_id,organization_id,password_digest)
          SELECT ?,?, ?,tenant_id,organization_id,? FROM operator_invitations WHERE invitation_hash=?`,[randomUUID(),email,name,passwordDigest,digest(invitationCode)]);
        await conn.query("UPDATE operator_invitations SET used_at=CURRENT_TIMESTAMP WHERE invitation_hash=?",[digest(invitationCode)]);
        await conn.commit();return {created:true};
      }catch(error){
        await conn.rollback();
        if(error&&typeof error==='object'&&'code' in error&&error.code==='ER_DUP_ENTRY')return reply.code(400).send(failure("invalid_invitation","This invitation cannot be used. Ask your administrator for a new invitation."));
        throw error;
      }finally{conn.release();}
    });
    operator.get("/me",{schema:{tags:["operator-access"],security:[{operatorSession:[]}],querystring:noQuery}},async request=>({user:context(request)}));
    operator.post("/logout",{schema:{tags:["operator-access"],security:[{operatorSession:[]}],querystring:noQuery}},async request=>{
      const token=request.headers.authorization!.slice(7);
      await db.query("UPDATE operator_sessions SET revoked=TRUE WHERE session_hash=?",[digest(token)]);
      return {signedOut:true};
    });
    const keySchema={type:"string",minLength:8,maxLength:64,pattern:"^[A-Za-z0-9_-]+$"};
    const confirmation={type:"boolean",const:true};
    const actionUnavailable=(reply:import("fastify").FastifyReply)=>reply.code(503).send(failure("writes_disabled","Product operations are temporarily unavailable."));
    operator.post<{Body:CreateInput}>("/products/create",{
      bodyLimit:256*1024,schema:{tags:["operator-dashboard"],querystring:noQuery,body:{type:"object",additionalProperties:false,
        required:["name","description","publish","idempotencyKey"],properties:{name:{type:"string",minLength:1,maxLength:240},
          description:{type:"string",maxLength:2000},fields:{type:"array",maxItems:32,items:{type:"object",additionalProperties:false,
            required:["label","value"],properties:{label:{type:"string",minLength:1,maxLength:80},value:{type:"string",minLength:1,maxLength:1000}}}},
          publish:{type:"boolean"},idempotencyKey:keySchema}}}},async(request,reply)=>{
      if(!request.body.name.trim())return reply.code(400).send(failure("invalid_request","Enter a product name."));
      return deps.actions?deps.actions.create(context(request),request.body):actionUnavailable(reply);
    });
    operator.get<{Params:{trackingId:string}}>("/receive/:trackingId",{schema:{tags:["operator-dashboard"],querystring:noQuery,
      params:{type:"object",additionalProperties:false,required:["trackingId"],properties:{trackingId:{type:"string",pattern:"^(0x[0-9a-fA-F]{64}|[0123456789abcdefghjkmnpqrstvwxyzABCDEFGHJKMNPQRSTVWXYZ]{12})$"}}}}},
      async(request,reply)=>deps.actions?deps.actions.lookup(context(request),request.params.trackingId):actionUnavailable(reply));
    operator.post<{Params:{productId:string};Body:{version:string;confirmed:boolean;idempotencyKey:string}}>("/products/:productId/receive",{
      bodyLimit:4096,schema:{tags:["operator-dashboard"],querystring:noQuery,params:productParams,body:{type:"object",additionalProperties:false,
        required:["version","confirmed","idempotencyKey"],properties:{version:{type:"string",pattern:"^(0|[1-9][0-9]{0,19})$"},confirmed:confirmation,idempotencyKey:keySchema}}}},
      async(request,reply)=>{
        if(BigInt(request.body.version)>18446744073709551615n)return reply.code(400).send(failure("invalid_request","Refresh the product before receiving."));
        return deps.actions?deps.actions.receive(context(request),request.params.productId.toLowerCase(),request.body):actionUnavailable(reply);
      });
    operator.post<{Params:{productId:string};Body:{reason:"Sold"|"Lost"|"Damaged"|"Disposed";confirmed:boolean;idempotencyKey:string}}>("/products/:productId/close",{
      bodyLimit:4096,schema:{tags:["operator-dashboard"],querystring:noQuery,params:productParams,body:{type:"object",additionalProperties:false,
        required:["reason","confirmed","idempotencyKey"],properties:{reason:{type:"string",enum:["Sold","Lost","Damaged","Disposed"]},confirmed:confirmation,idempotencyKey:keySchema}}}},
      async(request,reply)=>deps.actions?deps.actions.close(context(request),request.params.productId.toLowerCase(),request.body):actionUnavailable(reply));
    operator.get<{Querystring:{after?:string;limit?:string}}>("/products",{schema:{tags:["operator-dashboard"],security:[{operatorSession:[]}],querystring:pageQuery}},async(request,reply)=>{
      let page;try{page=pagination(request.query);}catch{return reply.code(400).send(failure("invalid_request","Invalid pagination."));}
      return products(db,context(request),scope,page.after,page.limit);
    });
    operator.get<{Params:{productId:string};Querystring:{after?:string;limit?:string}}>("/products/:productId/history",{schema:{tags:["operator-dashboard"],security:[{operatorSession:[]}],querystring:pageQuery,params:productParams}},async(request,reply)=>{
      let page;try{page=pagination(request.query);}catch{return reply.code(400).send(failure("invalid_request","Invalid pagination."));}
      const productId=request.params.productId.toLowerCase();
      const result=await products(db,context(request),scope,"0",1,productId);
      if(!result.products.length)return reply.code(404).send(failure("product_not_found","Product was not found."));
      return {product:result.products[0],...(await productHistory(db,context(request),scope,productId,page.after,page.limit))};
    });
    operator.get("/businesses",{schema:{tags:["operator-dashboard"],security:[{operatorSession:[]}],querystring:noQuery}},async request=>businesses(db,context(request).tenantId));
    operator.get("/operations",{schema:{tags:["operator-dashboard"],security:[{operatorSession:[]}],querystring:noQuery}},async request=>operations(db,context(request)));
  },{prefix:"/operator/v1"});
}
