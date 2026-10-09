import {parseEther, parseGwei} from 'viem';

export class TransactionPolicyError extends Error {
  constructor(public code: string) { super(code); }
}
export function transactionPolicy(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.TRACEFORGE_NETWORK_KIND ?? 'private';
  if (!['private','public'].includes(mode)) throw Error('Invalid TRACEFORGE_NETWORK_KIND');
  const feeMode = env.TRACEFORGE_FEE_MODE ?? 'auto';
  if (!['auto','legacy','eip1559'].includes(feeMode)) throw Error('Invalid TRACEFORGE_FEE_MODE');
  const decimal = (name: string, fallback: string, parse: (value:string)=>bigint) => {
    const raw = env[name] ?? fallback;
    if (!/^\d+(\.\d{1,9})?$/.test(raw) || parse(raw) <= 0n) throw Error('Invalid '+name);
    return parse(raw);
  };
  const retrySeconds = Number(env.TRACEFORGE_FEE_RETRY_SECONDS ?? '120');
  if (!Number.isSafeInteger(retrySeconds) || retrySeconds < 15) throw Error('Invalid TRACEFORGE_FEE_RETRY_SECONDS');
  return {public: mode === 'public', feeMode, symbol: env.TRACEFORGE_NATIVE_SYMBOL ?? 'ETH',
    maxFee: decimal('TRACEFORGE_MAX_FEE_GWEI','1000',parseGwei),
    maxCost: decimal('TRACEFORGE_MAX_TRANSACTION_FEE','2',parseEther), retrySeconds};
}
export const policy = transactionPolicy();
export type FeePlan = {type:'legacy';gasPrice:bigint} | {type:'eip1559';maxFeePerGas:bigint;maxPriorityFeePerGas:bigint};
export async function feePlan(client: any, settings = policy, previous?: FeePlan): Promise<FeePlan> {
  if (!settings.public) return {type:'legacy',gasPrice:0n};
  const block = await client.getBlock({blockTag:'latest'});
  const dynamic = previous?.type === 'eip1559' || (settings.feeMode !== 'legacy' &&
    (settings.feeMode === 'eip1559' || (block.baseFeePerGas ?? 0n) > 0n));
  const bump = (value: bigint) => (value * 113n + 99n) / 100n + 1n;
  const max = (a:bigint,b:bigint) => a>b?a:b;
  let result: FeePlan;
  if (dynamic) {
    let estimated;
    try { estimated = await client.estimateFeesPerGas({type:'eip1559'}); }
    catch {
      const price = BigInt(await client.getGasPrice()), base = BigInt(block.baseFeePerGas ?? 0n);
      const tip = price > base ? price-base : 1_000_000_000n;
      estimated = {maxFeePerGas:base*2n+tip,maxPriorityFeePerGas:tip};
    }
    let tip = estimated.maxPriorityFeePerGas, cap = estimated.maxFeePerGas;
    if (previous?.type === 'eip1559') { tip=max(tip,bump(previous.maxPriorityFeePerGas));cap=max(cap,bump(previous.maxFeePerGas)); }
    cap=max(cap,(block.baseFeePerGas??0n)*2n+tip);
    result={type:'eip1559',maxFeePerGas:cap,maxPriorityFeePerGas:tip};
  } else {
    let price=await client.getGasPrice();
    if(previous?.type==='legacy')price=max(price,bump(previous.gasPrice));
    result={type:'legacy',gasPrice:price};
  }
  const price=result.type==='legacy'?result.gasPrice:result.maxFeePerGas;
  if(price<=0n||price>settings.maxFee)throw new TransactionPolicyError('fee_limit_exceeded');
  return result;
}
export async function requireGasBalance(client:any,address:string,gas:bigint,fees:FeePlan,value=0n,settings=policy) {
  if(!settings.public)return;
  const cost=gas*(fees.type==='legacy'?fees.gasPrice:fees.maxFeePerGas);
  if(cost>settings.maxCost)throw new TransactionPolicyError('fee_limit_exceeded');
  if(await client.getBalance({address})<cost+value)throw new TransactionPolicyError('insufficient_gas_balance');
}
export async function receiptFinalized(client:any,receipt:any,settings=policy) {
  if(!settings.public)return true;
  const block=await client.getBlock({blockNumber:receipt.blockNumber});
  if(block.hash?.toLowerCase()!==receipt.blockHash.toLowerCase())return false;
  let finalized;
  try{finalized=await client.getBlock({blockTag:'finalized'});}catch{throw new TransactionPolicyError('finality_unavailable');}
  if(finalized.number==null)throw new TransactionPolicyError('finality_unavailable');
  return receipt.blockNumber<=finalized.number;
}
