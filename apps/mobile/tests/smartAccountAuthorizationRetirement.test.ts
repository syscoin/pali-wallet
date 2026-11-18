import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { Wallet, sha256 } from 'ethers';
import { EVM_SIGNED_RECORD_LIMITS } from '../../../source/shared/evmSignedRecordLimits.ts';
import { EvmSignedRecords, inspectEvmSignedBundle, type EvmSignedRecordSession, type EvmSignedRecordStorage } from '../../../source/wallet/evmSignedRecords.ts';
import { captureSmartAccountAuthorization, encodeSmartAccountAuthorization, smartAccountAuthorizationSummary } from '../../../source/wallet/smartAccountAuthorization.ts';
import { buildSmartAccountUserOperation, encodeSmartAccountValidatorNonceKey } from '../../../source/utils/smartAccount/account.ts';
import { getSmartAccountUserOpHash } from '../../../source/utils/smartAccount/userOperationHash.ts';
import { paliEntryPointInterface } from '../../../source/utils/smartAccount/contracts.ts';

Object.defineProperty(globalThis, 'crypto', {value:webcrypto,configurable:true});
const account='0x'+'22'.repeat(20),otherAccount='0x'+'44'.repeat(20),validator='0x'+'33'.repeat(20),otherValidator='0x'+'55'.repeat(20);
const signer=new Wallet('0x'+'11'.repeat(32)),anchorHash='0x'+'aa'.repeat(32),rootDomain='org.syscoin.pali.evm.signed.root.v1',chunkDomain='org.syscoin.pali.evm.signed.chunk.v1';
const key=BigInt(encodeSmartAccountValidatorNonceKey(validator)),otherKey=BigInt(encodeSmartAccountValidatorNonceKey(otherValidator));
const encoder=new TextEncoder();
function keyring(){
 const value:any=Object.create(SoftwareKeyring.prototype);value.sessionPassword={isCleared:()=>false};value.sessionMnemonic={isCleared:()=>false};value.privateRecordSessionRevision=0;value.getDecryptedMnemonic=()=> 'synthetic finalized authorization retirement root';return value;
}
function authorization(sender:string,sequence:number,chainId=1,nonceKey=key){
 const userOperation=buildSmartAccountUserOperation({sender,nonce:((nonceKey<<64n)+BigInt(sequence)).toString(),callData:'0x1234'});
 userOperation.signature=signer.signingKey.sign(getSmartAccountUserOpHash(userOperation,chainId)).serialized;
 return captureSmartAccountAuthorization({chainId,payer:signer.address,userOperation,createdAt:1000,observedAt:{number:'100',hash:anchorHash}});
}
async function manifest(keys:ReturnType<typeof keyring>,authorizations:any[]){
 const profileId=await keys.getPrivateRecordProfileId(),revision=0;
 const plaintext=encoder.encode(JSON.stringify({version:1,revision,transactions:0,entriesHash:sha256(encoder.encode('[]')),authorizations:authorizations.length,authorizationsHash:sha256(encoder.encode(JSON.stringify(authorizations))),nonceFloors:[]}));
 try{
  const root=await keys.encryptPrivateRecord({domain:rootDomain,recordId:'manifest',plaintext});
  return JSON.stringify({version:1,profileId,revision,root,entries:[],authorizations});
 }finally{plaintext.fill(0);}
}
let preparedSeed:Promise<{raw:string;records:ReturnType<typeof authorization>[]}>|undefined;
function seed(){return preparedSeed??= (async()=>{
 const keys=keyring(),records=[authorization(account,4),authorization(account,6),authorization(account,4,1,otherKey),authorization(account,0,2)];
 for(let index=records.length;index<EVM_SIGNED_RECORD_LIMITS.transactions-1;index++)records.push(authorization(otherAccount,index));
 const headers=[];
 // Encrypt each exact production payload once, then authenticate one manifest.
 // This avoids 4095 whole-bundle append writes while preserving real AEAD,
 // exact record IDs, counts/digests, and signed operation/hash bindings.
 for(const record of records){
  const payload=encodeSmartAccountAuthorization(record);
  try{
   const chunk=await keys.encryptPrivateRecord({domain:chunkDomain,recordId:`authorization/${record.operationHash}/0`,plaintext:payload});
   headers.push({...smartAccountAuthorizationSummary(record),chunks:[chunk]});
  }finally{payload.fill(0);}
 }
 return{raw:await manifest(keys,headers),records};
})();}
async function fixture(){
 const original=await seed(),keys=keyring();let stored=original.raw,current=true,writes=0,attempts=0;
 let beforeCAS:(()=>void)|undefined,refuse=false,loseAck=false;
 const storage:EvmSignedRecordStorage={async read(){return stored;},async compareAndSet(_id,expected,next,guard){
  attempts++;guard();beforeCAS?.();guard();if(refuse||stored!==expected)return false;stored=next;writes++;if(loseAck)throw Error('Lost retirement acknowledgement');return true;
 }};
 const session:EvmSignedRecordSession={keyring:keys,assertCurrent(){if(!current)throw Error('Retired owner');}};
 const store=new EvmSignedRecords(storage);
 return{...original,keys,session,store,storage,value:()=>stored,writes:()=>writes,attempts:()=>attempts,retire(){current=false;},refuse(){refuse=true;},loseAck(){loseAck=true;},beforeCAS(work:()=>void){beforeCAS=work;},replace(value:string){stored=value;}};
}
function evidence(options:{consumed?:boolean;reorgOnRecheck?:boolean;onRead?:()=>void}={}){
 let finals=0;const calls:{method:string;params:readonly unknown[]}[]=[];
 const read=async(method:string,params:readonly unknown[],signal:AbortSignal)=>{
  assert.equal(signal.aborted,false);options.onRead?.();calls.push({method,params});
  if(method==='eth_chainId')return'0x1';
  if(method==='eth_getBlockByNumber'){
   if(params[0]==='finalized')finals++;
   return{number:params[0]==='finalized'?'0x80':params[0],hash:options.reorgOnRecheck&&finals>1?'0x'+'bb'.repeat(32):anchorHash};
  }
  assert.equal(method,'eth_call','EOA receipts/nonces cannot retire an inner signature');
  const [sender,nonceKey]=paliEntryPointInterface.decodeFunctionData('getNonce',(params[0] as {data:string}).data);assert.equal(sender.toLowerCase(),account);assert.equal(params[1],'0x80');
  assert(nonceKey===key||nonceKey===otherKey);
  return paliEntryPointInterface.encodeFunctionResult('getNonce',[(nonceKey<<64n)+(nonceKey===key?BigInt(options.consumed===false?4:6):0n)]);
 };
 return{read,calls};
}

test('near-cap finalized inner cleanup frees only consumed selected-account signatures through real AEAD and CAS',async()=>{
 const f=await fixture(),proof=evidence(),before=JSON.parse(f.value());
 assert.equal(inspectEvmSignedBundle(f.value()).transactions,EVM_SIGNED_RECORD_LIMITS.transactions-1);
 assert.equal(await f.store.retireConsumedSmartAccountAuthorizations(f.session,1,account,proof.read),1);
 assert.equal(f.writes(),1);const after=JSON.parse(f.value());assert.equal(after.authorizations.length,EVM_SIGNED_RECORD_LIMITS.transactions-2);
 assert.deepEqual(after.authorizations,before.authorizations.slice(1),'live full nonce, other validator key, other chain/account and exact encrypted chunks stay intact');
 assert.equal(proof.calls.filter(call=>call.method==='eth_call').length,4,'two nonce keys are observed and revalidated at the same finalized anchor');
 const reopened=new EvmSignedRecords(f.storage);
 assert.equal(await reopened.readSmartAccountAuthorizationExact(f.session,'1',account,f.records[0]!.operationHash),null);
 assert.deepEqual((await reopened.readSmartAccountAuthorizationExact(f.session,'1',account,f.records[1]!.operationHash))?.userOperation,f.records[1]!.userOperation);
 assert.deepEqual((await reopened.readSmartAccountAuthorizationExact(f.session,'2',account,f.records[3]!.operationHash))?.userOperation,f.records[3]!.userOperation);
 const appended=authorization(account,7);await reopened.retainSmartAccountAuthorization(f.session,{chainId:1,payer:appended.payer,observedAt:appended.observedAt,userOperation:appended.userOperation});
 assert.equal(inspectEvmSignedBundle(f.value()).transactions,EVM_SIGNED_RECORD_LIMITS.transactions-1);
});

test('an outer-only success or still-live finalized inner nonce retires nothing',async()=>{
 const f=await fixture(),proof=evidence({consumed:false}),before=f.value();
 assert.equal(await f.store.retireConsumedSmartAccountAuthorizations(f.session,1,account,proof.read),0);assert.equal(f.value(),before);assert.equal(f.attempts(),0);
});

for(const failure of ['reorg','owner','CAS'] as const)test(`near-cap retirement preserves every encrypted byte after ${failure} refusal`,async()=>{
 const f=await fixture(),before=f.value();const proof=evidence({reorgOnRecheck:failure==='reorg',onRead:failure==='owner'?()=>f.retire():undefined});
 if(failure==='CAS')f.refuse();
 await assert.rejects(f.store.retireConsumedSmartAccountAuthorizations(f.session,1,account,proof.read));
 assert.equal(f.value(),before);assert.equal(f.writes(),0);assert.equal(f.attempts(),failure==='CAS'?3:0);
});

test('a lost cleanup acknowledgement keeps live authorizations decryptable after restart',async()=>{
 const f=await fixture(),before=JSON.parse(f.value());f.loseAck();
 await assert.rejects(f.store.retireConsumedSmartAccountAuthorizations(f.session,1,account,evidence().read),/Lost retirement acknowledgement/);
 assert.deepEqual(JSON.parse(f.value()).authorizations,before.authorizations.slice(1));
 const reopened=new EvmSignedRecords(f.storage);assert.deepEqual((await reopened.readSmartAccountAuthorizationExact(f.session,'1',account,f.records[1]!.operationHash))?.userOperation,f.records[1]!.userOperation);
});

test('ordinary capacity and unmatched account cleanup perform no RPC or writes',async()=>{
 const f=await fixture(),header=JSON.parse(f.value()).authorizations[1];f.replace(await manifest(f.keys,[header]));const before=f.value();
 const unexpected=async()=>{assert.fail('No retirement RPC below capacity');};
 assert.equal(await f.store.retireConsumedSmartAccountAuthorizations(f.session,1,account,unexpected),0);assert.equal(f.value(),before);assert.equal(f.attempts(),0);
 const full=await fixture();assert.equal(await full.store.retireConsumedSmartAccountAuthorizations(full.session,1,'0x'+'66'.repeat(20),unexpected),0);assert.equal(full.value(),full.raw);
});
