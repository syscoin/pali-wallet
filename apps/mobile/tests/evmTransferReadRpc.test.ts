import { emptyNoncePlanner } from './noncePlannerFixture.ts';
import type { NativeAutomaticNoncePlanner } from '../src/custody/evmTransferReadRpc.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { EvmAutoNonceAcceptance } from '../../../source/shared/evmAutoNonce.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import { signedRecordTestSession } from './signedRecordTestSession.ts';
import { createNativeNetwork, getNativeNetwork, NATIVE_NETWORKS, type NativeNetworkRegistration } from '../src/custody/networkContext.ts';
import type { EvmUnsignedTransfer } from '../src/custody/evmFeeContracts.ts';
const from = Wallet.fromPhrase('test test test test test test test test test test test junk').address;
const to = '0x1111111111111111111111111111111111111111';
const hash = '0x' + '1'.repeat(64), blockHash = '0x' + '2'.repeat(64);
const custom = createNativeNetwork({ id:'custom-fee-chain',name:'Custom fee chain',kind:'evm',chainId:'454545',slip44:60,rpcUrl:'https://custom-fee.example/rpc',symbol:'TEST',decimals:18,testnet:true });
const transaction = (network: NativeNetworkRegistration = getNativeNetwork('ethereum')): EvmUnsignedTransfer => ({ type: 2, accessList: [], from, to, chainId:network.chainId, nonce:'0',value:'100',gasLimit:'21000',data:'0x',maxFeePerGas:'10',maxPriorityFeePerGas:'2' });
const request={hash,from,to,nonce:'0'};
const signal=()=>new AbortController().signal;
type Call={method:string;params:unknown[];signal:AbortSignal};
function fixture(network=getNativeNetwork('ethereum'), override?:(call:Call)=>unknown|Promise<unknown>){
 const calls:Call[]=[];
 const rpc=new EvmTransferReadRpc(network,{monotonicMilliseconds:()=>1000,fetch:async(url,init)=>{
  assert.equal(url,network.rpcUrl);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
  const body=JSON.parse(String(init.body));const call={...body,signal:init.signal} as Call;calls.push(call);
  const inspect=(value:unknown):void=>{if(Array.isArray(value))value.forEach(inspect);else if(value&&typeof value==='object')Object.values(value).forEach(inspect);else if(typeof value==='string'&&/^0x[0-9a-f]+$/i.test(value)){let tx:Transaction|undefined;try{tx=Transaction.from(value)}catch{/* Not a transaction. */}assert.equal(tx?.isSigned()??false,false);}};
  inspect(body.params);assert.notEqual(call.method,'eth_sendRawTransaction');
  let result=override?await override(call):undefined;
  if(result===undefined){
   if(call.method==='eth_chainId')result='0x'+BigInt(network.chainId).toString(16);
   else if(call.method==='eth_getBlockByNumber')result={number:call.params[0]==='latest'?'0x64':call.params[0],hash:blockHash,baseFeePerGas:'0x4',gasLimit:'0x1c9c380'};
   else if(call.method==='eth_estimateGas')result='0x5208';
   else if(call.method==='eth_getTransactionCount')result='0x1';
   else if(call.method==='eth_getBalance')result='0xffffffffffff';
   else if(call.method==='eth_getTransactionReceipt')result={transactionHash:hash,from,to,status:'0x1',blockNumber:'0x50',blockHash};
   else throw Error('Unexpected read method '+call.method);
  }
  return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}),{headers:{'content-type':'application/json'}});
 }});return {rpc,calls};
}

for(const network of [...NATIVE_NETWORKS,custom])test(`${network.id} quotes the same exact unsigned envelope without chain profiles`,async()=>{
 const f=fixture(network),quote=await f.rpc.quoteFees(transaction(network),signal(),()=>undefined);
 assert.equal(quote.envelopeFeeCapUnits,'210000');assert.equal(quote.estimatedFeeUnits,'126000');assert.equal(quote.fundingEstimateUnits,'210100');assert.equal(quote.maximumTotalUnits,'210100');
 assert.equal(f.calls.filter(c=>c.method==='eth_estimateGas').length,1);
 assert.deepEqual(f.calls.find(c=>c.method==='eth_estimateGas')!.params,[{from,to,data:'0x',accessList:[],value:'0x64',maxFeePerGas:'0xa',maxPriorityFeePerGas:'0x2',type:'0x2',chainId:'0x'+BigInt(network.chainId).toString(16),nonce:'0x0'},'pending']);
 assert.equal(f.calls.some(c=>['eth_call','eth_getCode','eth_getStorageAt'].includes(c.method)||c.params.includes('finalized')),false);
});

test('input snapshots survive mutation and A-B-A/async guards reject stale quote work',async()=>{
 const input={...transaction()};const f=fixture(undefined,c=>{if(c.method==='eth_chainId')input.value='999';});
 assert.equal((await f.rpc.quoteFees(input,signal(),()=>undefined)).fundingEstimateUnits,'210100');
 let revision=0;const changed=fixture(undefined,c=>{if(c.method==='eth_getBlockByNumber')revision+=2;});
 await assert.rejects(changed.rpc.quoteFees(transaction(),signal(),()=>{if(revision!==0)throw Error('changed');}),{code:'CANCELLED'});
 const invalid=fixture();await assert.rejects(invalid.rpc.quoteFees(transaction(),signal(),async()=>undefined),{code:'CANCELLED'});assert.equal(invalid.calls.length,0);
});

test('wrong chain, changed block, gas growth and underpriced envelope still reject',async()=>{
 for(const [override,code] of [
  [(c:Call)=>c.method==='eth_chainId'?'0x2':undefined,'PROFILE_CHANGED'],
  [(c:Call)=>c.method==='eth_getBlockByNumber'&&c.params[0]==='0x64'?{number:'0x64',hash,baseFeePerGas:'0x4',gasLimit:'0x1c9c380'}:undefined,'PROFILE_CHANGED'],
  [(c:Call)=>c.method==='eth_getBlockByNumber'?{number:'0x64',hash,baseFeePerGas:'0xb',gasLimit:'0x1c9c380'}:undefined,'REVIEW_REQUIRED'],
  [(c:Call)=>c.method==='eth_estimateGas'?'0x5209':undefined,'REVIEW_REQUIRED'],
 ] as const)await assert.rejects(fixture(undefined,override).rpc.quoteFees(transaction(),signal(),()=>undefined),{code});
});

for(const network of [getNativeNetwork('ethereum'),getNativeNetwork('syscoin-nevm'),getNativeNetwork('zksys-testnet'),custom])test(`${network.id} confirms ordinary canonical inclusion without a settlement gate`,async()=>{
 const f=fixture(network),result=await f.rpc.receipt(request,signal(),()=>undefined);
 assert.deepEqual(result,{status:'included',outcome:'succeeded',canonicalObserved:true,block:{number:'80',hash:blockHash}});
 assert.equal(f.calls.some(c=>c.method==='eth_getTransactionCount'||c.params.includes('safe')||c.params.includes('finalized')),false);
});

test('orphan receipts reject and nonce consumption alone never claims execution',async()=>{
 await assert.rejects(fixture(undefined,c=>c.method==='eth_getBlockByNumber'?{number:'0x50',hash,gasLimit:'0x1c9c380'}:undefined).rpc.receipt(request,signal(),()=>undefined),{code:'PROFILE_CHANGED'});
 const missing=fixture(undefined,c=>c.method==='eth_getTransactionReceipt'?null:undefined);
 assert.deepEqual(await missing.rpc.receipt(request,signal(),()=>undefined),{status:'nonce-consumed'});
 assert(missing.calls.some(c=>c.method==='eth_getTransactionCount'&&c.params[1]==='latest'));
 const unconsumed=fixture(undefined,c=>c.method==='eth_getTransactionReceipt'?null:c.method==='eth_getTransactionCount'?'0x0':undefined);
 assert.equal(await unconsumed.rpc.receipt(request,signal(),()=>undefined),null);
});

test('each canonical receipt read boundary rejects revoked authority',async()=>{
 const baseline=fixture();await baseline.rpc.receipt(request,signal(),()=>undefined);
 for(let stop=1;stop<=baseline.calls.length;stop++){
  let seen=0,current=true;const f=fixture(undefined,()=>{if(++seen===stop)current=false;});
  await assert.rejects(f.rpc.receipt(request,signal(),()=>{if(!current)throw Error('revoked');}),{code:'CANCELLED'});
  assert.equal(f.calls.length,stop);
 }
});

test('separate bounded block responses preserve ordinary response caps',async()=>{
 const wide=fixture(undefined,c=>c.method==='eth_getBlockByNumber'?{number:c.params[0]==='latest'?'0x64':c.params[0],hash:blockHash,baseFeePerGas:'0x4',gasLimit:'0x1c9c380',transactions:Array(400).fill(hash)}:undefined);
 assert.equal((await wide.rpc.quoteFees(transaction(),signal(),()=>undefined)).maximumTotalUnits,'210100');
 const huge=fixture(undefined,c=>c.method==='eth_getBlockByNumber'?{number:'0x64',hash,baseFeePerGas:'0x4',gasLimit:'0x1c9c380',padding:'a'.repeat(512*1024)}:undefined);
 await assert.rejects(huge.rpc.quoteFees(transaction(),signal(),()=>undefined),{code:'UNAVAILABLE'});
 const ordinary=fixture(undefined,c=>c.method==='eth_chainId'?'0x'+'1'.repeat(17000):undefined);
 await assert.rejects(ordinary.rpc.quoteFees(transaction(),signal(),()=>undefined),{code:'UNAVAILABLE'});
});

test('aborted input emits no request and malformed RPC envelopes never become fees',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.rpc.quoteFees(transaction(),controller.signal,()=>undefined),{code:'CANCELLED'});assert.equal(f.calls.length,0);
 const rpc=new EvmTransferReadRpc(custom,{fetch:async(_url,init)=>{const body=JSON.parse(String(init.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:-32000,message:'unavailable'}}));}});
 await assert.rejects(rpc.quoteFees(transaction(custom),signal(),()=>undefined),{code:'INVALID_RESPONSE'});
});

for (const legacy of [false, true]) test(`approved native requote uses raw gas within the original margin (legacy=${legacy})`, async () => {
 let estimate = 21000;
 let blockGasLimit = 25200;
 const f = fixture(custom, call => {
  if (call.method === 'eth_getBlockByNumber') return {
   number: call.params[0] === 'latest' ? '0x64' : call.params[0],
   hash: blockHash, gasLimit: '0x' + blockGasLimit.toString(16), ...(legacy ? {} : { baseFeePerGas: '0x4' }),
  };
  if (call.method === 'eth_estimateGas') return '0x' + estimate.toString(16);
  if (call.method === 'eth_gasPrice') return '0xa';
  if (call.method === 'eth_maxPriorityFeePerGas') return '0x2';
  return undefined;
 });
 const input = { from, to, value: '100', data: '0x' };
 const quote = await f.rpc.prepare(input, signal(), () => undefined, undefined, undefined, emptyNoncePlanner);
 assert.equal(quote.transaction.gasLimit, '25200');
 assert.equal(quote.transaction.type, legacy ? 0 : 2);
 for (estimate of [21000, 22000, 25200]) {
  const refreshed = await f.rpc.prepare(input, signal(), () => undefined, quote.transaction, undefined, emptyNoncePlanner);
  assert.deepEqual(refreshed.transaction, quote.transaction);
  assert.equal(refreshed.maximumFeeUnits, quote.maximumFeeUnits);
 }
 blockGasLimit = 30000;
 estimate = 25201;
 await assert.rejects(f.rpc.prepare(input, signal(), () => undefined, quote.transaction, undefined, emptyNoncePlanner), {
  code: 'REVIEW_REQUIRED',
 });
});


for (const mode of ['automatic', 'manual'] as const) test(`${mode} native gap fill reserves future signed commitments before dispatch`, async () => {
 const acceptance = new EvmAutoNonceAcceptance();
 let balance = 410099;
 const f = fixture(custom, call => {
  if (call.method === 'eth_getTransactionCount') return '0x0';
  if (call.method === 'eth_getBalance') return '0x' + balance.toString(16);
  return undefined;
 });
 const planner: Parameters<EvmTransferReadRpc['verifyForDispatch']>[3] = input => acceptance.plan({
  ...input, chainId: custom.chainId, endpoint: custom.rpcUrl, from,
  snapshot: {
   owner: 'test-wallet', minimumNonce: 0,
   retained: [{ chainId: custom.chainId, from, hash, nonce: 1, phase: 'signed' }],
   readMaximumCost: async () => 200000n,
   readAssetDebit: async () => 0n,
  },
 });
 const validate = () => f.rpc.verifyForDispatch(transaction(custom), signal(), () => undefined, planner,
  undefined, mode === 'manual' ? 0 : undefined);
 await assert.rejects(validate(), { code: 'INSUFFICIENT_BALANCE' });
 balance = 410100;
 await validate();
 assert.equal(f.calls.some(call => call.method === 'eth_sendRawTransaction'), false);
});

for (const manual of [false, true]) test(`native dispatch budgets the costliest retained prefix alternative (manual=${manual})`, async () => {
 const originalHash = '0x' + '3'.repeat(64), replacementHash = '0x' + '4'.repeat(64);
 const acceptance = new EvmAutoNonceAcceptance();
 const f = fixture(custom, call => {
  if (call.method === 'eth_getTransactionCount') return call.params[1] === 'pending' ? '0x1' : '0x0';
  if (call.method === 'eth_getBalance') return call.params[1] === 'pending' ? '0xd6998' : '0xf4240';
  return undefined;
 });
 const planner: NativeAutomaticNoncePlanner = input => acceptance.plan({ ...input,
  chainId: custom.chainId, endpoint: custom.rpcUrl, from,
  snapshot: { owner: 'prefix', minimumNonce: 0, retained: [
   { chainId: custom.chainId, from, hash: originalHash, nonce: 0, phase: 'submitted' },
   { chainId: custom.chainId, from, hash: replacementHash, nonce: 0, phase: 'signed' },
  ], readMaximumCost: async hash => hash === originalHash ? 121000n : 142000n,
  readAssetDebit: async () => 0n },
 });
 const transfer = { ...transaction(custom), nonce: '1', value: '661000' };
 await assert.rejects(f.rpc.verifyForDispatch(transfer, signal(), () => undefined, planner,
  undefined, manual ? 1 : undefined), { code: 'INSUFFICIENT_BALANCE' });
 await f.rpc.verifyForDispatch({ ...transfer, value: '527000' }, signal(), () => undefined, planner,
  undefined, manual ? 1 : undefined);
 assert.equal(f.calls.some(call => call.method === 'eth_sendRawTransaction'), false);
});

for (const originalCap of [100000n, 150000n]) test(`native final admission reserves ambiguous prefixes with external debits (${originalCap})`, async () => {
 const originalHash = '0x' + '3'.repeat(64), replacementHash = '0x' + '4'.repeat(64);
 const acceptance = new EvmAutoNonceAcceptance();
 let pendingBalance = '0x927c0';
 let competing = true;
 const f = fixture(custom, call => {
  if (call.method === 'eth_getTransactionCount') return call.params[1] === 'pending' ? '0x2' : '0x0';
  if (call.method === 'eth_getBalance') return call.params[1] === 'pending' ? pendingBalance : '0xf4240';
  return undefined;
 });
 const planner: NativeAutomaticNoncePlanner = input => acceptance.plan({ ...input,
  chainId: custom.chainId, endpoint: custom.rpcUrl, from,
  snapshot: { owner: 'external-pending', minimumNonce: 0, retained: [
   { chainId: custom.chainId, from, hash: originalHash, nonce: 0, phase: 'submitted' },
   ...(competing ? [{ chainId: custom.chainId, from, hash: replacementHash, nonce: 0, phase: 'signed' as const }] : []),
  ], readMaximumCost: async hash => hash === originalHash ? originalCap : 200000n,
  readAssetDebit: async () => 0n },
 });
 const candidate = { ...transaction(custom), nonce: '2', value: '340000' };
 await assert.rejects(f.rpc.verifyForDispatch(candidate, signal(), () => undefined, planner), { code: 'INSUFFICIENT_BALANCE' });
 await f.rpc.verifyForDispatch({ ...candidate, value: '190000' }, signal(), () => undefined, planner);
 pendingBalance = '0xdbba0'; // Without the external debit, the ambiguous-group fallback permits this send.
 await f.rpc.verifyForDispatch(candidate, signal(), () => undefined, planner);
 pendingBalance = '0x927c0';
 competing = false; // Ordinary single-variant queues retain the node's pending balance semantics.
 await f.rpc.verifyForDispatch(candidate, signal(), () => undefined, planner);
 assert.equal(f.calls.some(call => call.method === 'eth_getTransactionByHash'), false);
});
test('manual final admission keeps the external predecessor in its funding bound', async () => {
 const f = fixture(custom, call => {
  if (call.method === 'eth_getTransactionCount') return call.params[1] === 'pending' ? '0x2' : '0x0';
  if (call.method === 'eth_getBalance') return call.params[1] === 'pending' ? '0x74f18' : '0xf4240';
  return undefined;
 });
 const candidate = { ...transaction(custom), nonce: '1', value: '590000' };
 await assert.rejects(f.rpc.verifyForDispatch(candidate, signal(), () => undefined, emptyNoncePlanner, undefined, 1), { code: 'INSUFFICIENT_BALANCE' });
 await f.rpc.verifyForDispatch({ ...candidate, value: '269000' }, signal(), () => undefined, emptyNoncePlanner, undefined, 1);
 assert.equal(f.calls.some(call => call.method === 'eth_sendRawTransaction'), false);
});




test('signed-record retirement exposes only bounded endpoint reads', async () => {
 const f = fixture(custom);
 assert.equal(await f.rpc.retirementRead('eth_chainId', [], signal(), () => undefined), '0x6ef91');
 await f.rpc.retirementRead('eth_getBlockByNumber', ['finalized', false], signal(), () => undefined);
 assert.equal(await f.rpc.retirementRead('eth_getTransactionCount', [from, '0x64'], signal(), () => undefined), '0x1');
 await f.rpc.retirementRead('eth_getTransactionReceipt', [hash], signal(), () => undefined);
 assert.deepEqual(f.calls.map(({ method }) => method), ['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionCount', 'eth_getTransactionReceipt']);
 await assert.rejects(f.rpc.retirementRead('eth_sendRawTransaction' as Parameters<EvmTransferReadRpc['retirementRead']>[0], [], signal(), () => undefined), { code: 'INVALID_INPUT' });
 assert.equal(f.calls.length, 4);
 const oversized = fixture(custom, call => call.method === 'eth_getBlockByNumber'
  ? { number: '0x64', hash: blockHash, padding: 'x'.repeat(512 * 1024) } : undefined);
 await assert.rejects(oversized.rpc.retirementRead('eth_getBlockByNumber', ['finalized', false], signal(), () => undefined), { code: 'UNAVAILABLE' });
});


test('signed-record retirement refuses revoked authority before publishing a response', async () => {
 let current = true;
 const f = fixture(custom, () => { current = false; });
 await assert.rejects(f.rpc.retirementRead('eth_chainId', [], signal(), () => {
  if (!current) throw new Error('Revoked');
 }), { code: 'CANCELLED' });
 assert.equal(f.calls.length, 1);
 const cancelled = new AbortController(); cancelled.abort();
 await assert.rejects(f.rpc.retirementRead('eth_chainId', [], cancelled.signal, () => undefined), { code: 'CANCELLED' });
 assert.equal(f.calls.length, 1);
});


test('signed-record retirement rejects a response from a changed endpoint', async () => {
 const rpc = new EvmTransferReadRpc(custom, { fetch: async (_url, init) => {
  const body = JSON.parse(String(init.body));
  const response = new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x6ef91' }));
  Object.defineProperty(response, 'url', { value: 'https://other.example/rpc' });
  return response;
 } });
 await assert.rejects(rpc.retirementRead('eth_chainId', [], signal(), () => undefined), { code: 'PROFILE_CHANGED' });
});


test('the native retirement adapter reclaims a confirmed journal entry after exact receipt and finality checks', async () => {
 const wallet = Wallet.fromPhrase('test test test test test test test test test test test junk');
 const raw = await wallet.signTransaction({ type: 2, chainId: BigInt(custom.chainId), nonce: 0,
  to, value: 100n, gasLimit: 21000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 2n });
 const tx = Transaction.from(raw), finalHash = '0x' + '3'.repeat(64);
 let stored: string | undefined;
 const records = new EvmSignedRecords({
  async read() { return stored; },
  async compareAndSet(_profileId, expected, next, assertCurrent) {
   assertCurrent();
   if (stored !== expected) return false;
   stored = next;
   return true;
  },
 });
 const session = signedRecordTestSession();
 await records.append(session, { rawTransaction: raw, hash: tx.hash!, from, chainId: custom.chainId, nonce: 0, type: 2,
  context: { account: { id: 0, type: 'HDAccount', address: from },
   network: { kind: 'ethereum', chainId: Number(custom.chainId), slip44: 60, url: custom.rpcUrl }, operation: 'send' } });
 await records.updatePhase(session, custom.chainId, from, tx.hash!, 'confirmed');
 const f = fixture(custom, call => {
  if (call.method === 'eth_getTransactionReceipt') {
   assert.deepEqual(call.params, [tx.hash]);
   return { transactionHash: tx.hash, from, to, status: '0x1', blockNumber: '0x50', blockHash, transactionIndex: '0x0' };
  }
  if (call.method === 'eth_getBlockByNumber') {
   assert.equal(call.params[1], false);
   if (call.params[0] === '0x50') return { number: '0x50', hash: blockHash, gasLimit: '0x1c9c380', transactions: [tx.hash] };
   assert(['finalized', '0x64'].includes(String(call.params[0])));
   return { number: '0x64', hash: finalHash, gasLimit: '0x1c9c380', transactions: [] };
  }
  if (call.method === 'eth_getTransactionCount') {
   assert.deepEqual(call.params, [from.toLowerCase(), { blockHash: finalHash, requireCanonical: true }]);
   return '0x1';
  }
 });
 const removed = await records.retireAvailableFinalized(session, { chainId: custom.chainId, from },
  (chain, abort, guard) => {
   assert.equal(chain, custom.chainId);
   return (method, params) => f.rpc.retirementRead(method, params, abort, guard);
  });
 assert.equal(removed, 1);
 assert.equal(await records.validate(signedRecordTestSession()), 0);
 assert.equal(f.calls.filter(call => call.method === 'eth_getTransactionReceipt').length, 2);
 assert.equal(f.calls.some(call => call.method === 'eth_sendRawTransaction'), false);
});


test('receipt reads accept bounded batch logs while preserving scalar and receipt limits', async () => {
 const logs = Array.from({ length: 50 }, (_, index) => ({ address: to, topics: [hash, hash, hash],
   data: '0x' + index.toString(16).padStart(64, '0'), blockHash, transactionHash: hash, logIndex: '0x' + index.toString(16) }));
 const receipt = { transactionHash: hash, blockHash, blockNumber: '0x1', gasUsed: '0x5208', status: '0x1', logs };
 assert(JSON.stringify(receipt).length > 16 * 1024);
 const f = fixture(custom, call => call.method === 'eth_getTransactionReceipt' ? receipt : undefined);
 assert.deepEqual(await f.rpc.retirementRead('eth_getTransactionReceipt', [hash], signal(), () => undefined), receipt);
 const tooLarge = fixture(custom, call => call.method === 'eth_getTransactionReceipt' ? { ...receipt, padding: 'x'.repeat(1024 * 1024) } : undefined);
 await assert.rejects(tooLarge.rpc.retirementRead('eth_getTransactionReceipt', [hash], signal(), () => undefined), { code: 'UNAVAILABLE' });
 const scalar = fixture(custom, call => call.method === 'eth_getBalance' ? '0x' + '1'.repeat(16 * 1024) : undefined);
 await assert.rejects(scalar.rpc.smartAccountRead('eth_getBalance', [from, 'pending'], signal(), () => undefined), { code: 'UNAVAILABLE' });
});

for (const maximum of [false, true]) test(`explicit fees bind the initial ${maximum ? 'MAX' : 'ordinary'} quote and remain unchanged on requote`, async () => {
  let base = '0x4', estimate = 21000;
  const f = fixture(custom, call => {
    if (call.method === 'eth_getBlockByNumber') return { number: call.params[0] === 'latest' ? '0x64' : call.params[0], hash: blockHash, baseFeePerGas: base, gasLimit: '0x1c9c380' };
    if (call.method === 'eth_gasPrice') return '0xa';
    if (call.method === 'eth_maxPriorityFeePerGas') return '0x2';
    if (call.method === 'eth_getTransactionCount') return '0x0';
    if (call.method === 'eth_estimateGas') return '0x' + estimate.toString(16);
  });
  const choice = { kind: 'custom' as const, type: 2 as const, maxFeePerGas: '12', maxPriorityFeePerGas: '2', gasLimit: '30000' };
  const quote = maximum
    ? await f.rpc.prepareMaximum(from, to, 0n, signal(), () => undefined, undefined, emptyNoncePlanner, choice)
    : await f.rpc.prepare({ from, to, value: '100', data: '0x' }, signal(), () => undefined, undefined, undefined, emptyNoncePlanner, undefined, undefined, choice);
  assert.equal(quote.transaction.gasLimit, '30000');
  assert.equal(quote.transaction.type, 2);
  assert.equal(quote.maximumFeeUnits, '360000');
  if (maximum) assert.equal(BigInt(quote.transaction.value) + 360000n, BigInt(quote.balanceUnits));
  estimate = 23000;
  const updated = await f.rpc.prepare({ from, to, value: quote.transaction.value, data: '0x' }, signal(), () => undefined, quote.transaction, undefined, emptyNoncePlanner);
  assert.deepEqual(updated.transaction, quote.transaction);
  base = '0xd';
  await assert.rejects(f.rpc.prepare({ from, to, value: quote.transaction.value, data: '0x' }, signal(), () => undefined, quote.transaction, undefined, emptyNoncePlanner), { code: 'REVIEW_REQUIRED' });
});

for (const [gasLimit, fee, balance] of [['21000', '12', '0xffffffffffff'], ['30000001', '12', '0xffffffffffff'], ['30000', '12000000000', '0x100']] as const) {
  test(`custom fee quote rejects insufficient gas/bounds/funding ${gasLimit}/${fee}/${balance}`, async () => {
    const f = fixture(custom, call => call.method === 'eth_gasPrice' ? '0xa'
      : call.method === 'eth_maxPriorityFeePerGas' ? '0x2'
      : call.method === 'eth_estimateGas' ? '0x55f0'
      : call.method === 'eth_getBalance' ? balance : undefined);
    await assert.rejects(f.rpc.prepare({ from, to, value: '100', data: '0x' }, signal(), () => undefined,
      undefined, undefined, emptyNoncePlanner, undefined, undefined,
      { kind: 'custom', type: 2, maxFeePerGas: fee, maxPriorityFeePerGas: '2', gasLimit }));
    assert.equal(f.calls.some(call => call.method === 'eth_sendRawTransaction'), false);
  });
}
