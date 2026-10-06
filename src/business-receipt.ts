import type {BusinessWrite} from "./business-write.js";

// Verify the mined payload before clearing the signed journal transaction.
export function businessReceiptMatches(input:BusinessWrite,args:Record<string,unknown>,actor:string):boolean{
 const same=(a:unknown,b:unknown)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
 const number=(a:unknown,b:unknown)=>BigInt(String(a))===BigInt(String(b));
 const version=(a:unknown,b:unknown)=>BigInt(String(a))===BigInt(String(b))+1n;
 try{
  if(input.operation==="registerBusiness")return same(args.organizationId,input.organizationId);
  if(!same(args.tenantId,input.tenantId)||(input.operation!=="createBusinessWorkspace"&&!same(args.entityId,input.entityId)))return false;
  switch(input.operation){
   case "createProduct":return same(args.organizationId,input.organizationId)&&same(args.actor,actor)&&
    same(args.registrationMetadataHash,input.args[3])&&number(args.initialQuantity,input.args[4]);
   case "claimCustody":return same(args.toOrganizationId,input.organizationId)&&same(args.actor,actor)&&
    same(args.evidenceHash,input.args[4])&&version(args.custodyVersion,input.args[2]);
   case "claimBatch":return same(args.toOrganizationId,input.organizationId)&&same(args.actor,actor)&&
    same(args.sourceRouteId,input.args[2])&&same(args.receivedRouteId,input.args[3])&&
    version(args.sourceVersion,input.args[4])&&number(args.quantity,input.args[5])&&same(args.evidenceHash,input.args[6]);
   case "removeProduct":return same(args.organizationId,input.organizationId)&&same(args.actor,actor)&&
    same(args.routeId,input.args[2])&&number(args.quantity,input.args[3])&&version(args.version,input.args[4])&&
    number(args.reason,input.args[5])&&args.reasonText===input.args[6]&&same(args.evidenceHash,input.args[7]);
   case "closeEntity":return same(args.organizationId,input.organizationId)&&same(args.actor,actor)&&
    same(args.eventType,input.args[3])&&same(args.evidenceHash,input.args[4]);
   default:return true;
  }
 }catch{return false;}
}
