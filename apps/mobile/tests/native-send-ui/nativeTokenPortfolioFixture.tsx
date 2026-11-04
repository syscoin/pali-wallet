// Isolated public-data fixture: exercises the real native controller and UI.
import React, { useEffect, useState } from 'react';
import type { CustodySnapshot } from '../../src/custody/types';
import type { KeyringStoragePort } from '../../src/storage/types';
import { encodeStorageValue } from '../../src/storage/json';
import {
  getNativeNetwork,
  type EvmNetworkId,
} from '../../src/custody/networkContext';
import { NativeTokens } from '../../src/portfolio/nativeTokens';
import {
  NativeTokenRegistry,
  type NativeTokenScope,
} from '../../src/portfolio/tokenRegistry';
import type { Erc20Reader } from '../../src/portfolio/erc20ReadRpc';
import { NativePortfolio } from '../../src/screens/NativePortfolio';

const owner = '0x52908400098527886E0F7030069857D2E4169EE7';
let state = Object.freeze<CustodySnapshot>({
  phase: 'ready',
  revision: 1,
  presence: 'existing',
  backup: 'confirmed',
  account: { network: 'ethereum', address: owner },
  error: null,
});
const listeners = new Set<(value: CustodySnapshot) => void>();
const source = {
  getSnapshot: () => state,
  subscribe(listener: (value: CustodySnapshot) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
const publish = () => {
  for (const listener of listeners) listener(state);
};
const storageKey = (key: string) => `pali-native-token-ui:${key}`;
const storage: KeyringStoragePort = {
  async get(key) {
    const value = localStorage.getItem(storageKey(key));
    return value === null ? undefined : JSON.parse(value);
  },
  async set(key, value) {
    localStorage.setItem(storageKey(key), encodeStorageValue(value));
  },
  async deleteItem(key) {
    localStorage.removeItem(storageKey(key));
  },
  async createManyIfAbsent(items) {
    if (
      Object.keys(items).some(
        (key) => localStorage.getItem(storageKey(key)) !== null
      )
    )
      return false;
    for (const [key, value] of Object.entries(items))
      localStorage.setItem(storageKey(key), encodeStorageValue(value));
    return true;
  },
  async compareAndSet(key, expected, value) {
    if (localStorage.getItem(storageKey(key)) !== encodeStorageValue(expected))
      return false;
    localStorage.setItem(storageKey(key), encodeStorageValue(value));
    return true;
  },
};
const registry = new NativeTokenRegistry(storage);
const scope = (): NativeTokenScope => {
  if (state.phase !== 'ready' || !state.account) throw Error('CANCELLED');
  const network = getNativeNetwork(state.account.network);
  return {
    walletFingerprint: 'f'.repeat(64),
    accountId: 'hd:60:0',
    address: state.account.address,
    network: network.id,
    chainId: network.chainId,
    registrationHash: network.registrationHash,
  };
};
let failBalances = false;
let holdBalances = false;
const pendingBalances = new Set<() => void>();
let holdPreview = false;
let releasePreview: (() => void) | undefined;
const requests: string[] = [];
const reader: Erc20Reader = {
  async readToken(network, address, contractAddress) {
    requests.push(`preview:${network}:${address}:${contractAddress}`);
    if (holdPreview) {
      holdPreview = false;
      await new Promise<void>((resolve) => {
        releasePreview = resolve;
      });
    }
    const zero = contractAddress.endsWith('2');
    const long = contractAddress.endsWith('3');
    return {
      metadata: {
        contractAddress,
        name: long
          ? 'Long token metadata '.repeat(6).trim()
          : zero
          ? 'Zero token'
          : 'Fixture token',
        symbol: long ? 'LONGTOKEN'.repeat(6) : zero ? 'ZERO' : 'FIXTURE',
        decimals: long ? 255 : 2,
      },
      units: zero ? '0' : long ? '1' : '9007199254740993',
    };
  },
  async readBalance(network, address, metadata) {
    requests.push(`balance:${network}:${address}:${metadata.contractAddress}`);
    if (holdBalances)
      await new Promise<void>((resolve) => {
        pendingBalances.add(resolve);
      });
    if (failBalances) throw Error('PUBLIC_FIXTURE_UNAVAILABLE');
    return {
      units: metadata.contractAddress.endsWith('2')
        ? '0'
        : metadata.contractAddress.endsWith('3')
        ? '1'
        : '9007199254740993',
    };
  },
};
const controller = new NativeTokens(
  source,
  () => ({
    load: (guard) => registry.load(scope(), guard),
    add: (revision, metadata, guard) =>
      registry.add(scope(), revision, metadata, guard),
    remove: (revision, contractAddress, guard) =>
      registry.remove(scope(), revision, contractAddress, guard),
  }),
  reader,
  () => 1000
);
let setVisible: (value: boolean) => void = () => undefined;
let sends = 0;
declare global {
  interface Window {
    __nativeTokenPortfolio: {
      select(network: EvmNetworkId): void;
      failBalances(value: boolean): void;
      holdBalances(): void;
      releaseBalances(): void;
      holdPreview(): void;
      releasePreview(): void;
      lock(): void;
      visible(value: boolean): void;
      requests(): readonly string[];
      sends(): number;
    };
  }
}
window.__nativeTokenPortfolio = {
  select(network) {
    getNativeNetwork(network);
    state = Object.freeze({
      ...state,
      phase: 'ready',
      revision: state.revision + 1,
      account: { network, address: owner },
    });
    publish();
  },
  failBalances(value) {
    failBalances = value;
  },
  holdBalances() {
    holdBalances = true;
  },
  releaseBalances() {
    holdBalances = false;
    for (const resolve of pendingBalances) resolve();
    pendingBalances.clear();
  },
  holdPreview() {
    holdPreview = true;
  },
  releasePreview() {
    releasePreview?.();
    releasePreview = undefined;
  },
  lock() {
    state = Object.freeze({
      ...state,
      revision: state.revision + 1,
      phase: 'locked',
      account: null,
    });
    publish();
  },
  visible(value) {
    setVisible(value);
  },
  requests: () => [...requests],
  sends: () => sends,
};
export function NativeTokenPortfolioFixture() {
  const [visible, updateVisible] = useState(true);
  useEffect(() => {
    setVisible = updateVisible;
    return () => {
      setVisible = () => undefined;
    };
  }, []);
  return visible ? (
    <NativePortfolio
      source={source}
      tokenView={controller.view}
      reader={{
        async readBalance(network) {
          return {
            chainId: Number(getNativeNetwork(network).chainId),
            units: '1230000000000000000',
          };
        },
      }}
      onSend={() => {
        sends++;
      }}
      onExit={() => undefined}
      onLock={() => window.__nativeTokenPortfolio.lock()}
      onViewRecovery={() => undefined}
    />
  ) : null;
}
