import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicClient,keccak256} from 'viem';
import {verifiedTransport} from '../dist/rpc-transport.js';
import {proxyClient} from '../dist/proxy-client.js';
import {createServer} from 'node:http';
const code='0x1234',runtimeHash=keccak256(code);
test('trusted proxy isolates clients and rejects spoofed identities',()=>{
 assert.equal(proxyClient({'x-traceforge-proxy-key':'bad','x-traceforge-client-ip':'192.0.2.1'},'socket','secret'),'socket');
 assert.equal(proxyClient({'x-traceforge-proxy-key':'secret','x-traceforge-client-ip':'192.0.2.1'},'socket','secret'),'192.0.2.1');
});
test('RPC failover skips wrong chains and preserves RPC errors without retrying a reverted write',async()=>{
 const servers=[];let wrongRequests=0;
 async function server(chainId){
  const s=createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const {method}=JSON.parse(text);if(chainId===1)wrongRequests++;
   const result=method==='eth_chainId'?'0x'+chainId.toString(16):method==='eth_getCode'?code:method==='eth_blockNumber'?'0x10':null;
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(method==='eth_call'?{jsonrpc:'2.0',id:1,error:{code:3,data:'0x',message:'execution reverted'}}:{jsonrpc:'2.0',id:1,result}));});
  await new Promise(done=>s.listen(0,'127.0.0.1',done));servers.push(s);return 'http://127.0.0.1:'+s.address().port;
 }
 try{
  const wrong=await server(1),healthy=await server(9009);
  const client=createPublicClient({transport:verifiedTransport({urls:['http://127.0.0.1:1',wrong,healthy],chainId:9009,contractAddress:'0x'+'11'.repeat(20),runtimeHash})});
  assert.equal(await client.getBlockNumber(),16n);const before=wrongRequests;
  await assert.rejects(client.request({method:'eth_call',params:[{},'latest']}));assert.equal(wrongRequests,before);
 }finally{await Promise.all(servers.map(s=>new Promise(done=>s.close(done))));}
});
