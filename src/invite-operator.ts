import { open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "./db.js";
import { credential, digest, emailPattern } from "./operator-credentials.js";
import type { RowDataPacket } from "mysql2/promise";
const args=process.argv.slice(2),values=new Map<string,string>();
let file:string|undefined,createdFile=false,committed=false;
let connection;
try{
  for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];
    if(!["--tenant","--organization","--email","--output"].includes(flag)||values.has(flag)||!value||value.startsWith("--"))throw Error();values.set(flag,value);}
  const tenant=values.get("--tenant"),org=values.get("--organization"),email=values.get("--email")?.trim().toLowerCase();
  if(!tenant||!org||!/^0x[0-9a-fA-F]{64}$/.test(tenant)||!/^0x[0-9a-fA-F]{64}$/.test(org)||!email||!emailPattern.test(email)||!values.get("--output"))throw Error();
  file=resolve(values.get("--output")!);
  connection=await db.getConnection();await connection.beginTransaction();
  const [rows]=await connection.query<RowDataPacket[]>(`SELECT m.organization_id FROM tenant_memberships m
    JOIN tenants t ON t.tenant_id=m.tenant_id AND t.active=TRUE
    JOIN organizations o ON o.organization_id=m.organization_id AND o.active=TRUE
    WHERE m.tenant_id=? AND m.organization_id=? AND m.active=TRUE LIMIT 1`,[tenant.toLowerCase(),org.toLowerCase()]);
  if(!rows.length)throw Error();
  const invitation=credential("tfoi"),expiresAt=new Date(Date.now()+24*60*60*1000);
  await connection.query("INSERT INTO operator_invitations (invitation_hash,email,tenant_id,organization_id,expires_at) VALUES (?,?,?,?,?)",[digest(invitation),email,tenant.toLowerCase(),org.toLowerCase(),expiresAt]);
  const handle=await open(file,"wx",0o600);createdFile=true;
  try{await handle.writeFile(JSON.stringify({email,invitationCode:invitation,expiresAt:expiresAt.toISOString()})+"\n");}finally{await handle.close();}
  await connection.commit();committed=true;console.log("Invitation saved to the requested owner-only file. It expires in 24 hours. Share it privately with the intended user.");
}catch{
  await connection?.rollback();if(createdFile&&!committed&&file)await unlink(file).catch(()=>{});
  console.error("Invitation was not created. Check --tenant, --organization, --email and --output, active business membership, migrations and a new output-file path.");process.exitCode=1;
}finally{connection?.release();await db.end();}
