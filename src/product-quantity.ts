import type { Pool,RowDataPacket } from "mysql2/promise";
import { removalReasons } from "./product-input.js";
type Reader=Pick<Pool,"query">;
export type ProductScope=[number,string];
const nameSQL=(business:string,document:string)=>`CASE WHEN ${business}.public_profile=TRUE
 AND JSON_UNQUOTE(JSON_EXTRACT(${document}.document_json,'$.name'))=${business}.business_name THEN ${business}.business_name ELSE NULL END`;
export async function quantitySummary(db:Reader,scope:ProductScope,tenantId:string,entityId:string,organizationId?:string,includeId=true){
 const [rows]=await db.query<RowDataPacket[]>(`SELECT q.*,JSON_UNQUOTE(JSON_EXTRACT(d.document_json,'$.id')) AS external_id,
  e.current_custodian FROM product_quantities q JOIN entities e ON e.tenant_id=q.tenant_id AND e.entity_id=q.entity_id
  LEFT JOIN offchain_documents d ON d.content_hash=q.registration_metadata_hash
  WHERE q.chain_id=? AND q.contract_address=? AND q.tenant_id=? AND q.entity_id=?`,[...scope,tenantId,entityId]);
 if(!rows[0])return null;
 const q=rows[0],isBatch=BigInt(q.initial_quantity)>1n;
 const [reasons]=await db.query<RowDataPacket[]>(`SELECT reason,CAST(SUM(quantity) AS CHAR) AS quantity FROM quantity_movements
  WHERE chain_id=? AND contract_address=? AND tenant_id=? AND entity_id=? AND action='REMOVED' GROUP BY reason`,[...scope,tenantId,entityId]);
 let own:string|undefined;
 if(organizationId){
  if(isBatch){const [balances]=await db.query<RowDataPacket[]>(`SELECT CAST(COALESCE(SUM(available_quantity),0) AS CHAR) AS quantity
   FROM batch_routes WHERE chain_id=? AND contract_address=? AND tenant_id=? AND entity_id=? AND organization_id=?`,[...scope,tenantId,entityId,organizationId]);own=String(balances[0].quantity);}
  else own=q.current_custodian===organizationId?String(q.available_quantity):"0";
 }
 return {externalId:includeId?q.external_id??null:null,initialQuantity:String(q.initial_quantity),availableQuantity:String(q.available_quantity),
  removedQuantity:String(q.removed_quantity),isBatch,inSupplyChain:BigInt(q.available_quantity)>0n,
  reasons:removalReasons.map((reason,index)=>({reason,quantity:String(reasons.find(row=>Number(row.reason)===index)?.quantity??"0")})),
  ...(own===undefined?{}:{ownAvailableQuantity:own})};
}
export async function productRoutes(db:Reader,scope:ProductScope,tenantId:string,entityId:string,after:string,limit:number){
 const [rows]=await db.query<RowDataPacket[]>(`SELECT r.*,CAST(r.created_event_id AS CHAR) AS page_cursor,
  ${nameSQL("b","d")} AS owner_name,p.organization_id AS previous_owner_id,${nameSQL("pb","pd")} AS previous_owner_name
  FROM batch_routes r
  LEFT JOIN business_wallets b ON b.organization_id=r.organization_id
  LEFT JOIN organizations o ON o.organization_id=r.organization_id
  LEFT JOIN offchain_documents d ON d.content_hash=o.metadata_hash
  LEFT JOIN batch_routes p ON p.chain_id=r.chain_id AND p.contract_address=r.contract_address
   AND p.tenant_id=r.tenant_id AND p.entity_id=r.entity_id AND p.route_id=r.parent_route_id
  LEFT JOIN business_wallets pb ON pb.organization_id=p.organization_id
  LEFT JOIN organizations po ON po.organization_id=p.organization_id
  LEFT JOIN offchain_documents pd ON pd.content_hash=po.metadata_hash
  WHERE r.chain_id=? AND r.contract_address=? AND r.tenant_id=? AND r.entity_id=? AND r.available_quantity>0 AND r.created_event_id>?
  ORDER BY r.created_event_id LIMIT ?`,[...scope,tenantId,entityId,after,limit+1]);
 const visible=rows.slice(0,limit);
 return {routes:visible.map(row=>({id:row.route_id,parentRouteId:row.parent_route_id,owner:{id:row.organization_id,name:row.owner_name??null},
  previousOwner:row.previous_owner_id?{id:row.previous_owner_id,name:row.previous_owner_name??null}:null,
  receivedQuantity:String(row.received_quantity),availableQuantity:String(row.available_quantity),version:String(row.version),receivedAt:String(row.received_at)})),
  page:{hasMore:rows.length>limit,next:rows.length>limit?String(visible.at(-1)!.page_cursor):null}};
}
export async function productHolders(db:Reader,scope:ProductScope,tenantId:string,entityId:string,after:string,limit:number){
 const [singles]=await db.query<RowDataPacket[]>(`SELECT e.current_custodian AS organization_id,q.available_quantity,
  ${nameSQL("b","d")} AS name FROM product_quantities q
  JOIN entities e ON e.tenant_id=q.tenant_id AND e.entity_id=q.entity_id
  LEFT JOIN business_wallets b ON b.organization_id=e.current_custodian
  LEFT JOIN organizations o ON o.organization_id=e.current_custodian LEFT JOIN offchain_documents d ON d.content_hash=o.metadata_hash
  WHERE q.chain_id=? AND q.contract_address=? AND q.tenant_id=? AND q.entity_id=? AND q.initial_quantity=1
   AND q.available_quantity>0 AND e.current_custodian>?`,[...scope,tenantId,entityId,after]);
 if(singles.length)return {holders:singles.map(row=>({id:row.organization_id,name:row.name??null,availableQuantity:String(row.available_quantity),routeCount:0})),page:{hasMore:false,next:null}};
 const [rows]=await db.query<RowDataPacket[]>(`SELECT r.organization_id,CAST(SUM(r.available_quantity) AS CHAR) AS quantity,
  MAX(${nameSQL("b","d")}) AS name,COUNT(*) AS routes
  FROM batch_routes r LEFT JOIN business_wallets b ON b.organization_id=r.organization_id
  LEFT JOIN organizations o ON o.organization_id=r.organization_id LEFT JOIN offchain_documents d ON d.content_hash=o.metadata_hash
  WHERE r.chain_id=? AND r.contract_address=? AND r.tenant_id=? AND r.entity_id=? AND r.available_quantity>0 AND r.organization_id>?
  GROUP BY r.organization_id ORDER BY r.organization_id LIMIT ?`,[...scope,tenantId,entityId,after,limit+1]);
 const visible=rows.slice(0,limit);
 return {holders:visible.map(row=>({id:row.organization_id,name:row.name??null,availableQuantity:String(row.quantity),routeCount:Number(row.routes)})),
  page:{hasMore:rows.length>limit,next:rows.length>limit?visible.at(-1)!.organization_id:null}};
}
// Fetch only the businesses referenced by this public history page. This avoids
// imposing a 32-business limit on dynamic supply chains and honors current consent.
export async function publicBusinessProfiles(db:Reader,ids:string[]){
 const unique=[...new Set(ids.filter(id=>/^0x[0-9a-f]{64}$/i.test(id)&&id!=="0x"+"0".repeat(64)))];
 if(!unique.length)return [];
 const [rows]=await db.query<RowDataPacket[]>(`SELECT b.organization_id,o.metadata_hash,
  ${nameSQL("b","d")} AS name,b.business_type FROM business_wallets b
  JOIN organizations o ON o.organization_id=b.organization_id LEFT JOIN offchain_documents d ON d.content_hash=o.metadata_hash
  WHERE b.organization_id IN (${unique.map(()=>"?").join(",")})`,unique);
 return rows.filter(row=>row.name!=null).map(row=>({id:row.organization_id,metadataHash:row.metadata_hash,name:row.name,type:row.business_type}));
}
export async function searchProductReferences(db:Reader,scope:ProductScope,id:string,businessCode:string|undefined,after:string,limit:number,organizationId?:string){
 const related=`(r.creator_organization_id=? OR e.current_custodian=? OR EXISTS
  (SELECT 1 FROM batch_routes br WHERE br.chain_id=r.chain_id AND br.contract_address=r.contract_address AND br.tenant_id=r.tenant_id
   AND br.entity_id=r.entity_id AND br.organization_id=?) OR EXISTS
  (SELECT 1 FROM custody_claims cc WHERE cc.tenant_id=r.tenant_id AND cc.entity_id=r.entity_id AND (cc.from_organization_id=? OR cc.to_organization_id=?)))`;
 const [rows]=await db.query<RowDataPacket[]>(`SELECT r.tracking_id,r.external_id,e.created_event_id,q.initial_quantity,q.available_quantity,
  CASE WHEN ${organizationId?related:"FALSE"} THEN JSON_UNQUOTE(JSON_EXTRACT(d.document_json,'$.name'))
   ELSE JSON_UNQUOTE(JSON_EXTRACT(p.product_info,'$.name')) END AS name,
  r.creator_organization_id,${nameSQL("b","od")} AS origin_name,
  CASE WHEN b.public_profile=TRUE THEN c.code ELSE NULL END AS business_code,
  s.short_code FROM business_product_records r JOIN entities e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id
  JOIN product_quantities q ON q.chain_id=r.chain_id AND q.contract_address=r.contract_address AND q.tenant_id=r.tenant_id AND q.entity_id=r.entity_id
  LEFT JOIN public_entity_publications pub ON pub.tenant_id=r.tenant_id AND pub.entity_id=r.entity_id
  LEFT JOIN public_entity_presentations p ON p.tenant_id=r.tenant_id AND p.entity_id=r.entity_id AND p.metadata_hash=e.metadata_hash AND pub.entity_id IS NOT NULL
  LEFT JOIN offchain_documents d ON d.content_hash=e.metadata_hash
  LEFT JOIN business_wallets b ON b.organization_id=r.creator_organization_id LEFT JOIN organizations o ON o.organization_id=b.organization_id
  LEFT JOIN offchain_documents od ON od.content_hash=o.metadata_hash
  LEFT JOIN business_code_reservations c ON c.organization_id=r.creator_organization_id
  LEFT JOIN public_entity_short_links s ON s.tracking_id=UNHEX(SUBSTRING(r.tracking_id,3))
  WHERE r.chain_id=? AND r.contract_address=? AND r.confirmed=TRUE AND BINARY r.external_id=BINARY ? AND e.created_event_id>?
  ${businessCode?"AND c.code=?":""} AND (pub.entity_id IS NOT NULL ${organizationId?`OR ${related}`:""})
  ORDER BY e.created_event_id LIMIT ?`,[...(organizationId?Array(5).fill(organizationId):[]),...scope,id,after,
    ...(businessCode?[businessCode]:[]),...(organizationId?Array(5).fill(organizationId):[]),limit+1]);
 const visible=rows.slice(0,limit);
 return {products:visible.map(row=>({trackingId:row.tracking_id,shortCode:row.short_code,name:row.name??null,externalId:row.external_id,
  origin:{id:row.creator_organization_id,name:row.origin_name??null,businessCode:row.business_code??null},isBatch:BigInt(row.initial_quantity)>1n,
  initialQuantity:String(row.initial_quantity),availableQuantity:String(row.available_quantity),inSupplyChain:BigInt(row.available_quantity)>0n})),
  page:{hasMore:rows.length>limit,next:rows.length>limit?String(visible.at(-1)!.created_event_id):null}};
}
