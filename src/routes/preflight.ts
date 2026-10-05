import type { FastifyInstance } from "fastify";
import { authContextFor, requireScope } from "../auth.js";
import { readTraceForge } from "../chain.js";
import { loadOrganizationAccount } from "../signer.js";
import { evaluateWritePrincipalSafety } from "../write-safety.js";
const capabilities = { ENTITY_CREATE:0, TRACE_RECORD:1, STATE_UPDATE:2, METADATA_UPDATE:3, CUSTODY_CLAIM:4, ENTITY_LINK:5, ENTITY_CLOSE:6 };
export async function registerPreflightRoutes(app:FastifyInstance) {
  app.get<{Querystring:{capability:keyof typeof capabilities;entityId?:string;requireCustody?:string}}>("/v1/auth/preflight", {
    schema:{tags:["auth","chain"],querystring:{type:"object",additionalProperties:false,required:["capability"],properties:{
      capability:{type:"string",enum:Object.keys(capabilities)},entityId:{type:"string",pattern:"^0x[0-9a-fA-F]{64}$"},requireCustody:{type:"string",enum:["true","false"]}}}}
  }, async(request,reply)=>{
    if(!requireScope(request,reply,"chain:write"))return;
    const auth=authContextFor(request),query=request.query;
    if(!auth.organizationId)return reply.code(403).send({error:{code:"organization_binding_required"}});
    if(query.requireCustody==="true"&&!query.entityId)return reply.code(400).send({error:{code:"entity_required"}});
    try {
      const account=await loadOrganizationAccount(auth.organizationId);
      const safety=await evaluateWritePrincipalSafety({tenantId:auth.tenantId,organizationId:auth.organizationId,account,capabilityIndex:capabilities[query.capability]});
      let entity=null;
      if(query.entityId){entity=await readTraceForge("getEntity",[auth.tenantId,query.entityId]);
        safety.checks.push({name:"entity_open",ok:entity.exists&&!entity.closed});
        if(query.requireCustody==="true")safety.checks.push({name:"current_custody",ok:entity.currentCustodian.toLowerCase()===auth.organizationId.toLowerCase()});}
      return {ready:safety.checks.every(check=>check.ok),capability:query.capability,capabilityIndex:capabilities[query.capability],tenantId:auth.tenantId,
        organizationId:auth.organizationId,signerAddress:account.address,authorizedRoleId:safety.roleId,checks:safety.checks,
        entity:entity?{exists:entity.exists,closed:entity.closed,currentCustodian:entity.currentCustodian}:null};
    }catch{return {ready:false,checks:[{name:"live_principal",ok:false}]};}
  });
}
