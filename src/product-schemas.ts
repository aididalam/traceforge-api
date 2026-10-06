const text={type:"string"} as const;
const count={type:"string",pattern:"^[0-9]+$"} as const;
const nullableText={anyOf:[text,{type:"null"}]} as const;
export const quantitySchema={type:"object",additionalProperties:false,
 required:["externalId","initialQuantity","availableQuantity","removedQuantity","isBatch","inSupplyChain","reasons"],
 properties:{externalId:nullableText,initialQuantity:count,availableQuantity:count,removedQuantity:count,
  isBatch:{type:"boolean"},inSupplyChain:{type:"boolean"},ownAvailableQuantity:count,
  reasons:{type:"array",maxItems:6,items:{type:"object",additionalProperties:false,required:["reason","quantity"],properties:{reason:text,quantity:count}}}}} as const;
export const movementSchema={type:"object",additionalProperties:false,
 required:["quantity","initialQuantity","reason","reasonText","sourceRouteId","receivedRouteId"],
 properties:{quantity:nullableText,initialQuantity:nullableText,reason:nullableText,reasonText:nullableText,
 sourceRouteId:nullableText,receivedRouteId:nullableText}} as const;

const identifier={type:"string",pattern:"^0x[0-9a-fA-F]{64}$"} as const;
const business={type:"object",additionalProperties:false,required:["id","name"],properties:{id:identifier,name:nullableText}} as const;
const page={type:"object",additionalProperties:false,required:["hasMore","next"],properties:{hasMore:{type:"boolean"},next:nullableText}} as const;
export const routesSchema={type:"object",additionalProperties:false,required:["routes","page"],properties:{page,routes:{type:"array",maxItems:100,
 items:{type:"object",additionalProperties:false,required:["id","parentRouteId","owner","previousOwner","receivedQuantity","availableQuantity","version","receivedAt"],
 properties:{id:identifier,parentRouteId:identifier,owner:business,previousOwner:{anyOf:[business,{type:"null"}]},
 receivedQuantity:count,availableQuantity:count,version:count,receivedAt:count}}}}} as const;
export const holdersSchema={type:"object",additionalProperties:false,required:["holders","page"],properties:{page,holders:{type:"array",maxItems:100,
 items:{type:"object",additionalProperties:false,required:["id","name","availableQuantity","routeCount"],properties:{id:identifier,name:nullableText,availableQuantity:count,routeCount:{type:"integer",minimum:0}}}}}} as const;
export const searchSchema={type:"object",additionalProperties:false,required:["products","page"],properties:{page,products:{type:"array",maxItems:100,
 items:{type:"object",additionalProperties:false,required:["trackingId","shortCode","name","externalId","origin","isBatch","initialQuantity","availableQuantity","inSupplyChain"],
 properties:{trackingId:identifier,shortCode:nullableText,name:nullableText,externalId:text,
 origin:{...business,required:["id","name","businessCode"],properties:{...business.properties,businessCode:nullableText}},
 isBatch:{type:"boolean"},initialQuantity:count,availableQuantity:count,inSupplyChain:{type:"boolean"}}}}}} as const;
