import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { getBytes } from 'ethers/utils';
import { signTypedData, SignTypedDataVersion } from '@metamask/eth-sig-util';
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum.js';
import { LedgerKeyring } from '@sidhujag/sysweb3-keyring/cjs/ledger/index.js';
import type { LedgerHost } from '@sidhujag/sysweb3-keyring/cjs/ledger/host-types.js';
import { KeyringAccountType } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { createNativeHardwareDappSigning } from '../src/hardware/dappSigning.ts';
import { createOwnedKeyringTransfer } from '../src/hardware/ownedKeyringTransfer.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { readDappMessageRequest } from '../../../source/shared/dappMessageRequest.ts';

const wallet = new Wallet('0x' + '31'.repeat(32));
const network = getNativeNetwork('ethereum');
const current = () => undefined;
const typed = {types:{EIP712Domain:[{name:'chainId',type:'uint256'}],Message:[{name:'text',type:'string'}]},
  primaryType:'Message',domain:{chainId:1},message:{text:'Public hardware fixture'}};

function fixture() {
  let live = true, calls = 0;
  const signal = new AbortController();
  const check = () => {if(!live || signal.signal.aborted)throw new Error('CANCELLED');};
  let wait: (() => Promise<void>) | undefined;
  const unavailable = async () => {throw new Error('Unexpected UTXO or address request');};
  const host: LedgerHost = {getStatus:()=>({connected:true}),connect:async()=>undefined,disconnect:async()=>undefined,
    retire:async()=>current,
    evm:{getAddress:unavailable,
      async signPersonalMessage(request, authority) {authority.assertCurrent();assert.equal(authority.signal,signal.signal);check();calls++;await wait?.();authority.assertCurrent();check();return wallet.signMessage(getBytes('0x'+request.messageHex));},
      async signTypedData(request, authority) {authority.assertCurrent();assert.equal(authority.signal,signal.signal);check();calls++;await wait?.();authority.assertCurrent();check();return signTypedData({privateKey:Buffer.from(wallet.privateKey.slice(2),'hex'),data:request.data as import('@metamask/eth-sig-util').TypedMessage<import('@metamask/eth-sig-util').MessageTypes>,
        version:request.version as SignTypedDataVersion.V3|SignTypedDataVersion.V4});},
      async signTransaction(request, authority) {check();authority?.assertCurrent?.();calls++;await wait?.();check();authority?.assertCurrent?.();
        const signature=wallet.signingKey.sign(Transaction.from('0x'+request.unsignedTxHex).unsignedHash);
        return {r:signature.r.slice(2),s:signature.s.slice(2),v:signature.v.toString(16)};},
    },utxo:{getXpub:unavailable,getAddress:unavailable,getAccount:unavailable,signMessage:unavailable,signPsbt:unavailable}};
  const ledger = new LedgerKeyring(undefined,host);
  const sdkNetwork = {kind:'ethereum',chainId:1,slip44:60,currency:'ETH',url:network.rpcUrl,label:'Ethereum'};
  const transactions = new EthereumTransactions(()=>sdkNetwork as never,()=>({address:wallet.address,decryptedPrivateKey:''}),
    ()=>({accounts:{HDAccount:{},Imported:{},Ledger:{0:{id:0,address:wallet.address}},Trezor:{}},activeAccountId:0,
      activeAccountType:KeyringAccountType.Ledger,activeNetwork:sdkNetwork}) as never, ledger, undefined,()=>check,null);
  let sessionWait: (()=>Promise<void>)|undefined;
  const adapter = createNativeHardwareDappSigning({account:{id:'ledger:60:0',type:'Ledger',index:0,address:wallet.address},network,signal:signal.signal,
    assertCurrent:check,async withSession(_account,guard,operation){await sessionWait?.();guard();return operation({kind:'Ledger',signer:ledger,transactions});}});
  return {adapter,signal,check,retire:()=>{live=false;},calls:()=>calls,hold:(hook:typeof wait)=>{wait=hook;},holdSession:(hook:typeof sessionWait)=>{sessionWait=hook;}};
}

test('actual SDK Ledger personal and V3/V4 messages verify against the captured account', async () => {
  const f=fixture();
  for(const method of ['personal_sign','eth_signTypedData_v3','eth_signTypedData_v4'] as const){
    const request=readDappMessageRequest(method,method==='personal_sign'?['0x6162',wallet.address]:[wallet.address,typed],wallet.address)!;
    const signature=await f.adapter.signMessage(request);
    assert.match(signature,/^0x[0-9a-f]{130}$/i);
  }
  assert.equal(f.calls(),3);
  const legacy=readDappMessageRequest('eth_signTypedData',[wallet.address,[{name:'text',type:'string',value:'legacy'}]],wallet.address)!;
  await assert.rejects(f.adapter.signMessage(legacy),/INVALID_INPUT/);
  assert.equal(f.calls(),3);
});

test('actual SDK hardware transaction signs only reviewed canonical bytes and requested chain', async () => {
  const f=fixture();
  const unsigned=Transaction.from({chainId:1,type:2,nonce:7,to:'0x'+'22'.repeat(20),value:3,gasLimit:21000,maxFeePerGas:100,maxPriorityFeePerGas:1}).unsignedSerialized;
  const signed=await f.adapter.signTransaction(unsigned,{signal:f.signal.signal,assertCurrent:f.check});
  const transaction=Transaction.from(signed.rawTransaction);
  assert.equal(transaction.from,wallet.address);
  assert.equal(transaction.unsignedSerialized,unsigned);
  assert.equal(transaction.hash,signed.hash);
  const foreign=Transaction.from({chainId:10,type:0,nonce:7,to:'0x'+'22'.repeat(20),value:3,gasLimit:21000,gasPrice:100}).unsignedSerialized;
  await assert.rejects(f.adapter.signTransaction(foreign,{signal:f.signal.signal,assertCurrent:f.check}),/INVALID_INPUT/);
  assert.equal(f.calls(),1);
});

test('retirement after a held session prevents device work and after a held signature withholds disclosure', async () => {
  for(const phase of ['session','signature'] as const){
    const f=fixture(), entered=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>();
    const wait=async()=>{entered.resolve();await finish.promise;};
    if(phase==='session')f.holdSession(wait);else f.hold(wait);
    const request=readDappMessageRequest('personal_sign',['0x6162',wallet.address],wallet.address)!;
    const result=f.adapter.signMessage(request);
    const rejected=assert.rejects(result, phase==='session' ? /CANCELLED/ : {code:'HARDWARE_REQUEST_CANCELLED'});
    await entered.promise;f.retire();finish.resolve();await rejected;
    assert.equal(f.calls(),phase==='session'?0:1);
  }
});

test('owned keyring transfer adopts only the exact admitted source, target and session', () => {
  const source={},target={},session={};let ring=source,worker:object|undefined,live=true;
  const binding=createOwnedKeyringTransfer({initial:source,current:()=>ring,worker:()=>worker,session:()=>session,
    assertOwner(){if(!live)throw new Error('CANCELLED');}});
  ring=target;worker=target;
  for(const args of [[{},target,session],[source,{},session],[source,target,{}]] as const)
    assert.throws(()=>binding.transferred(args[0],args[1],args[2]),/CANCELLED/);
  assert.equal(binding.current(),source);
  live=false;assert.throws(()=>binding.transferred(source,target,session),/CANCELLED/);
  live=true;binding.transferred(source,target,session);
  assert.equal(binding.current(),target);assert(binding.matches());
  assert.throws(()=>binding.transferred(source,target,session),/CANCELLED/);
});
