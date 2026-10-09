import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.API_BASE_URL??'http://127.0.0.1:3000';
test('business inventory and writes require a session',async()=>{
 for(const path of ['/operator/v1/products','/operator/v1/me','/operator/v1/operations','/operator/v1/receipt-requests','/integration/v1/receipt-requests'])assert.equal((await fetch(base+path)).status,401);
 const result=await fetch(base+'/operator/v1/products/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic product',id:'SYNTHETIC-1',description:'',publish:false,idempotencyKey:'synthetic-request'})});
 assert.equal(result.status,401);
});
test('OpenAPI advertises owner-approved receipt and independent signup',async()=>{
 const response=await fetch(base+'/docs/json');assert.equal(response.status,200);const doc=await response.json();
 assert.ok(doc.paths['/operator/v1/signup']);assert.ok(doc.paths['/operator/v1/products/{productId}/receive']);assert.ok(doc.paths['/operator/v1/products/{productId}/close']);
 assert.ok(doc.paths['/operator/v1/receipt-requests']);assert.ok(doc.paths['/operator/v1/receipt-requests/decisions']);assert.ok(doc.paths['/integration/v1/receipt-requests/decisions']);
 assert.ok(!Object.keys(doc.paths).some(path=>path.includes('/custody/proposals')||path.includes('/custody/acceptances')));
});
