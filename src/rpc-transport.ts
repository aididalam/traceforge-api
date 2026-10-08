import {custom,keccak256,type Hex} from 'viem';

export function verifiedTransport(settings:{urls:string[];chainId:number;contractAddress:string;runtimeHash?:string|null}) {
 const verified=new Map<string,number>();
 let preferred=0;
 async function call(url:string,method:string,params:unknown=[]):Promise<any>{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('RPC transport unavailable');
  const body=await response.json() as {result?:unknown;error?:{code:number;data?:unknown}};
  if(body.error)throw Object.assign(Error('RPC rejected the request'),{code:body.error.code,data:body.error.data,rpc:true});
  if(!('result' in body))throw Error('Invalid RPC response');return body.result;
 }
 return custom({async request({method,params}) {
  for(let attempt=0;attempt<settings.urls.length;attempt++){
   const index=(preferred+attempt)%settings.urls.length,url=settings.urls[index];
   try{
    if((verified.get(url)||0)<Date.now()-10000){
     const [id,code]=await Promise.all([call(url,'eth_chainId'),call(url,'eth_getCode',[settings.contractAddress,'latest'])]);
     if(BigInt(id)!==BigInt(settings.chainId)||typeof code!=='string'||code==='0x'||(settings.runtimeHash&&keccak256(code as Hex).toLowerCase()!==settings.runtimeHash.toLowerCase()))throw Error('RPC chain identity mismatch');
     verified.set(url,Date.now());
    }
    const result=await call(url,method,params);preferred=index;return result;
   }catch(error){verified.delete(url);if(error&&typeof error==='object'&&'rpc' in error)throw error;}
  }
  throw Error('No verified RPC endpoint is available');
 }},{retryCount:0});
}
