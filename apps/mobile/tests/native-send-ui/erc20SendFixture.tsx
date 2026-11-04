// Synthetic public wallet only. Production never imports this fixture.
import React, { useState, useSyncExternalStore } from 'react';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { keccak256 } from 'ethers/crypto';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import type { CustodySnapshot } from '../../src/custody/types';
import type { KeyringStoragePort } from '../../src/storage/types';
import {
  NativeTransfers,
  type NativeTransferRuntime,
} from '../../src/custody/transfers';
import { NativeTransferRpc } from '../../src/custody/transferRpc';
import { NativeTransferJournal } from '../../src/custody/transferJournal';
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
const storage: KeyringStoragePort = {
  async get(name) {
    const value = localStorage.getItem(key(name));
    return value === null ? undefined : JSON.parse(value);
  },
  async set(name, value) {
    localStorage.setItem(key(name), JSON.stringify(value));
  },
  async deleteItem() {
    throw Error('Fixture must preserve its pending journal');
  },
  async createManyIfAbsent(values) {
    if (
      Object.keys(values).some(
        (name) => localStorage.getItem(key(name)) !== null
      )
    )
      return false;
    for (const [name, value] of Object.entries(values))
      localStorage.setItem(key(name), JSON.stringify(value));
    return true;
  },
  async compareAndSet(name, expected, value) {
    if (localStorage.getItem(key(name)) !== JSON.stringify(expected))
      return false;
    localStorage.setItem(key(name), JSON.stringify(value));
    return true;
  },
};
const broadcasts: string[] = [];
let signatures = 0;
let authorizations = 0;
let finalized = false;
let loseResponse = true;
let heldQuote: Promise<void> | null = null;
let releaseQuote: (() => void) | undefined;
const word = (value: bigint | number) =>
  `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const block = (number: string) => ({
  number,
  hash: `0x${BigInt(number).toString(16).padStart(64, '0')}`,
});
const rpc = new NativeTransferRpc({
  fetch: async (_url, init) => {
    const request = JSON.parse(String(init.body));
    if (request.method === 'eth_feeHistory' && heldQuote) await heldQuote;
    let result: unknown;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.method === 'eth_getCode') result = '0x6000';
    else if (request.method === 'eth_getTransactionCount')
      result =
        request.params[1] === 'pending' ? '0x0' : finalized ? '0x1' : '0x0';
    else if (request.method === 'eth_getBalance') result = '0xde0b6b3a7640000';
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
      const value = (await storage.get('native-evm-transfer-v1')) as
        | { entries?: { rawTransaction: string; hash: string }[] }
        | undefined;
      const entry = value?.entries?.[0];
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
      const value = (await storage.get('native-evm-transfer-v1')) as
        | { entries?: { rawTransaction: string; phase: string }[] }
        | undefined;
      if (
        !value?.entries?.some(
          (entry) =>
            entry.rawTransaction === raw &&
            ['attempted', 'submitted'].includes(entry.phase)
        )
      )
        throw Error('Journal must precede broadcast');
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
  async token(contract, guard) {
    guard();
    if (contract !== token.contractAddress) throw Error('Unknown token');
    return runtimeToken;
  },
  async journal(guard) {
    guard();
    return new NativeTransferJournal(
      storage,
      {
        walletFingerprint: 'f'.repeat(64),
        address: wallet.address,
        chainId: '1',
      },
      guard
    );
  },
  async authorize(password, guard) {
    guard();
    if (!password) throw Error('Credential required');
    authorizations++;
  },
  async sign(transaction: PreparedEvmTransaction, password, guard, intent) {
    guard();
    if (!password) throw Error('Credential required');
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
      authorizations(): number;
      broadcasts(): readonly string[];
      finalized(): void;
      revise(): void;
      setRuntimePrecision(value: number): void;
      acceptBroadcasts(): void;
      holdQuote(): void;
      releaseQuote(): void;
      networkRoundTrip(): void;
    };
  }
}
window.__erc20SendFixture = {
  signatures: () => signatures,
  authorizations: () => authorizations,
  broadcasts: () => [...broadcasts],
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
      token={token}
      onBack={() => setVisible(false)}
    />
  ) : (
    <Text>Wallet closed</Text>
  );
}
