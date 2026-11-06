import { getNativeSendContext, getNativeNetwork } from '../../src/custody/networkContext';
// Synthetic public wallet only. Production never imports this fixture.
import React, { useState, useSyncExternalStore } from 'react';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { keccak256 } from 'ethers/crypto';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import type { CustodySnapshot } from '../../src/custody/types';
import {
  NativeTransfers,
  type NativeTransferRuntime,
} from '../../src/custody/transfers';
import { NativeTransferRpc } from '../../src/custody/transferRpc';
import { EvmSignedReplay } from '../../../../source/wallet/evmSignedReplay';
import { EvmSignedRecords } from '../../../../source/wallet/evmSignedRecords';
import { createNativeSignedRecordView } from '../../src/custody/sharedSignedRecords';
import { signedRecordTestSession } from '../signedRecordTestSession';
import { assertTransferIntentEnvelope } from '../../src/custody/transferIntent';
import { NativeSend } from '../../src/screens/NativeSend';
import { Text } from '../../src/ui';
import type { Erc20Metadata } from '../../../../source/shared/erc20';

const wallet = Wallet.fromPhrase(
  'test test test test test test test test test test test junk'
);
const token = Object.freeze({
  contractAddress: '0x3333333333333333333333333333333333333333',
  name: 'Public fixture token',
  symbol: 'FIX',
  decimals: 6,
});
let runtimeToken: Erc20Metadata = token;
let state: CustodySnapshot = Object.freeze<CustodySnapshot>({
  phase: 'ready',
  revision: 1,
  presence: 'existing',
  backup: 'confirmed',
  account: { network: 'ethereum', address: wallet.address },
  error: null,
});
const listeners = new Set<(snapshot: CustodySnapshot) => void>();
const publish = () => {
  for (const listener of [...listeners]) listener(state);
};
const source = {
  getSnapshot: () => state,
  subscribe(listener: (snapshot: CustodySnapshot) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  lock() {
    state = Object.freeze({
      ...state,
      phase: 'locked',
      revision: state.revision + 1,
      account: null,
    });
    publish();
  },
};
const key = (value: string) => `pali-erc20-send-ui:${value}`;
const signedRecords = new EvmSignedRecords({
  async read() { return localStorage.getItem(key('signed-records')) ?? undefined; },
  async compareAndSet(_profile, expected, value, guard) {
    guard(); if ((localStorage.getItem(key('signed-records')) ?? undefined) !== expected) return false;
    localStorage.setItem(key('signed-records'), value); return true;
  },
});
const broadcasts: string[] = [];
const rpcMethods: string[] = [];
let signatures = 0;
let unlockChecks = 0;
let finalized = false;
let loseResponse = true;
let heldQuote: Promise<void> | null = null;
let releaseQuote: (() => void) | undefined;
const word = (value: bigint | number) =>
  `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const block = (number: string) => ({
  number,
  baseFeePerGas: '0x1',
  gasLimit: '0x1c9c380',
  hash: `0x${BigInt(number).toString(16).padStart(64, '0')}`,
});
const rpc = new NativeTransferRpc({
  networkId: 'ethereum',
  fetch: async (_url, init) => {
    const request = JSON.parse(String(init.body));
    rpcMethods.push(request.method);
    if (request.method === 'eth_gasPrice' && heldQuote) await heldQuote;
    let result: unknown;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.method === 'eth_getCode') result = '0x6000';
    else if (request.method === 'eth_getTransactionCount')
      result =
        request.params[1] === 'pending' ? '0x0' : finalized ? '0x1' : '0x0';
    else if (request.method === 'eth_getBalance') result = '0xde0b6b3a7640000';
    else if (request.method === 'eth_gasPrice') result = '0x2';
    else if (request.method === 'eth_feeHistory')
      result = { oldestBlock: '0x20', baseFeePerGas: ['0x1', '0x1'] };
    else if (request.method === 'eth_maxPriorityFeePerGas') result = '0x1';
    else if (request.method === 'eth_estimateGas') result = '0xc350';
    else if (request.method === 'eth_call') {
      const data = request.params[0].data;
      result =
        data === '0x313ce567'
          ? word(runtimeToken.decimals)
          : data.startsWith('0x70a08231')
          ? word(10n ** 40n)
          : word(1);
    } else if (request.method === 'eth_getBlockByNumber')
      result = block(
        ['latest', 'finalized'].includes(request.params[0])
          ? '0x20'
          : request.params[0]
      );
    else if (request.method === 'eth_getTransactionReceipt') {
      const entry = await (await runtime.journal(() => undefined)).load();
      const tx = entry ? Transaction.from(entry.rawTransaction) : undefined;
      result =
        finalized && entry && tx
          ? {
              transactionHash: entry.hash,
              from: wallet.address,
              to: tx.to,
              status: '0x1',
              blockNumber: '0x10',
              blockHash: block('0x10').hash,
            }
          : null;
    } else if (request.method === 'eth_sendRawTransaction') {
      const raw = request.params[0];
      const entry = await signedRecords.readExact(signedRecordTestSession(), '1', wallet.address, keccak256(raw));
      if (!entry || entry.rawTransaction !== raw)
        throw Error('Signed record must precede broadcast');
      broadcasts.push(raw);
      if (loseResponse) {
        loseResponse = false;
        throw Error('Synthetic lost acknowledgement');
      }
      result = keccak256(raw);
    } else throw Error(`Unexpected fixture method ${request.method}`);
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
      { headers: { 'content-type': 'application/json' } }
    );
  },
});
const runtime: NativeTransferRuntime = {
  replay(guard, transport, options) {
    return new EvmSignedReplay(signedRecords, () => ({recordSession:signedRecordTestSession(guard),assertCurrent:guard,
      context:{account:{id:0,type:'HDAccount',address:wallet.address},network:{kind:'ethereum',chainId:1,slip44:60,url:getNativeNetwork('ethereum').rpcUrl}},...transport}), options.now, options.randomBytes);
  },
  async submit(rawTransaction, _hash, guard, broadcast, intent) {
    const journal = await runtime.journal(guard); await journal.saveSigned(rawTransaction,intent); guard(); await broadcast(rawTransaction);
  },
  async token(contract, guard) {
    guard();
    if (contract !== token.contractAddress) throw Error('Unknown token');
    return runtimeToken;
  },
  async journal(guard) {
    guard();
    return createNativeSignedRecordView(signedRecords, signedRecordTestSession(guard), 'f'.repeat(64),
      { index: 0, type: 'HDAccount', address: wallet.address }, getNativeNetwork('ethereum'));
  },
  assertUnlocked(guard) {
    guard();
    unlockChecks++;
  },
  async sign(transaction: PreparedEvmTransaction, guard, intent) {
    guard();
    assertTransferIntentEnvelope(transaction, intent);
    const rawTransaction = await wallet.signTransaction({
      type: transaction.type,
      to: transaction.to,
      chainId: BigInt(transaction.chainId),
      nonce: Number(transaction.nonce),
      value: BigInt(transaction.value),
      gasLimit: BigInt(transaction.gasLimit),
      data: transaction.data,
      ...(transaction.type === 2
        ? {
            maxFeePerGas: BigInt(transaction.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas),
          }
        : { gasPrice: BigInt(transaction.gasPrice) }),
    });
    guard();
    signatures++;
    return { rawTransaction, hash: keccak256(rawTransaction) };
  },
};
const controller = new NativeTransfers(source, () => runtime, { rpc });

declare global {
  interface Window {
    __erc20SendFixture: {
      signatures(): number;
      unlockChecks(): number;
      broadcasts(): readonly string[];
      rpcMethods(): readonly string[];
      journal(): unknown;
      finalized(): void;
      revise(): void;
      setRuntimePrecision(value: number): void;
      acceptBroadcasts(): void;
      holdQuote(): void;
      releaseQuote(): void;
      networkRoundTrip(): void;
      seedPredecessor(count?: number): Promise<{ first: string; second: string }>;
    };
  }
}
window.__erc20SendFixture = {
  async seedPredecessor(count = 1) {
    const session = signedRecordTestSession();
    const context = {account:{id:0,type:'HDAccount',address:wallet.address},network:{kind:'ethereum',chainId:1,slip44:60,url:getNativeNetwork('ethereum').rpcUrl},operation:'send' as const};
    const save = async (nonce: number, value = 1) => {
      const rawTransaction = await wallet.signTransaction({type:nonce===0?2:1,chainId:1,nonce,to:nonce===0?wallet.address:null,value,gasLimit:100000,
        ...(nonce===0?{maxFeePerGas:3,maxPriorityFeePerGas:1}:{gasPrice:3,accessList:[{address:wallet.address,storageKeys:[]}]}),data:nonce===0?'0x':'0x6000'});
      const tx=Transaction.from(rawTransaction);
      await signedRecords.append(session,{rawTransaction,hash:tx.hash!,from:wallet.address,chainId:'1',nonce,type:tx.type,context});return tx.hash!;
    };
    const first=await save(0);await signedRecords.updatePhase(session,'1',wallet.address,first,'confirmed');
    for (let i = 1; i < Math.min(count, 30); i++) {
      const alternative = await save(0, i + 1);
      await signedRecords.updatePhase(session, '1', wallet.address, alternative, 'confirmed');
    }
    const second=await save(1);await signedRecords.updatePhase(session,'1',wallet.address,second,'submitted');
    loseResponse=false;await controller.recover(true,second);return {first,second};
  },
  signatures: () => signatures,
  unlockChecks: () => unlockChecks,
  broadcasts: () => [...broadcasts],
  rpcMethods: () => [...rpcMethods],
  journal: () => localStorage.getItem(key('signed-records')),
  finalized: () => {
    finalized = true;
  },
  revise() {
    state = Object.freeze({ ...state, revision: state.revision + 1 });
    publish();
  },
  setRuntimePrecision(value) {
    runtimeToken = Object.freeze({ ...token, decimals: value });
  },
  acceptBroadcasts() {
    loseResponse = false;
  },
  holdQuote() {
    heldQuote = new Promise<void>((resolve) => {
      releaseQuote = resolve;
    });
  },
  releaseQuote() {
    heldQuote = null;
    releaseQuote?.();
    releaseQuote = undefined;
  },
  networkRoundTrip() {
    state = Object.freeze<CustodySnapshot>({
      ...state,
      revision: state.revision + 1,
      account: { network: 'base', address: wallet.address },
    });
    publish();
    state = Object.freeze<CustodySnapshot>({
      ...state,
      revision: state.revision + 1,
      account: { network: 'ethereum', address: wallet.address },
    });
    publish();
  },
};
export function Erc20SendFixture() {
  const snapshot = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot
  );
  const [visible, setVisible] = useState(true);
  return visible && snapshot.phase === 'ready' ? (
    <NativeSend
      key={snapshot.revision}
      controller={controller.view}
      context={getNativeSendContext('ethereum')}
      token={token}
      onBack={() => setVisible(false)}
    />
  ) : (
    <Text>Wallet closed</Text>
  );
}
