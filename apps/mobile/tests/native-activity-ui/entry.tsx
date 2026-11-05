// Public synthetic data only. This entrypoint is never imported by the app.
import React, { useState, useSyncExternalStore } from 'react';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeActivityScreen } from '../../src/screens/NativeActivity';
import {
  NativeActivity,
  type NativeActivityRuntime,
} from '../../src/activity/nativeActivity';
import {
  ActivityExplorerReader,
  decodeActivityPage,
  type ActivityFeed,
} from '../../src/activity/explorerReader';
import {
  ActivityReceiptReader,
  type ActivityTransactionObservation,
} from '../../src/activity/receiptReader';
import {
  createActivityScope,
  DEFAULT_ACTIVITY_VIEW,
  type DiscoveredActivityCandidate,
  type ActivityViewState,
  type LocalActivityRecord,
} from '../../src/activity/types';
import type { CustodySnapshot } from '../../src/custody/types';
import { Button, Header, Notice, Screen } from '../../src/ui';
import { RealAppShell } from '../../src/screens/RealAppShell';
import { useRealShell } from '../../src/screens/useRealShell';
import { freshStatusFixture } from './freshStatusFixture';

const owner = `0x${'11'.repeat(20)}`,
  recipient = `0x${'22'.repeat(20)}`;
const hash = (i: number) => `0x${i.toString(16).padStart(64, '0')}`;
const scope = createActivityScope('a'.repeat(64), 'hd:60:0', owner, 'ethereum');
let state: CustodySnapshot = {
  phase: 'ready',
  revision: 1,
  presence: 'existing',
  backup: 'confirmed',
  account: { network: 'ethereum', address: owner },
  error: null,
};
const stateListeners = new Set<(state: CustodySnapshot) => void>();
const subscribe = (listener: (state: CustodySnapshot) => void) => {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
};
const getState = () => state;
function lock() {
  state = {
    ...state,
    revision: state.revision + 1,
    phase: 'locked',
    account: null,
  };
  for (const listener of stateListeners) listener(state);
}
let fail = false,
  delay = false;
const waiting: (() => void)[] = [];
let savedView: ActivityViewState = DEFAULT_ACTIVITY_VIEW;
let saveDelay = 0;
const identityRegression = new URLSearchParams(window.location.search).get('history-identity');
const tokenMetadata = new URLSearchParams(window.location.search).get('token-metadata');
const retainedCollectible = new URLSearchParams(window.location.search).has('retained-collectible');
const collectibleContract = `0x${'33'.repeat(20)}`;
const collectibleLocals: readonly LocalActivityRecord[] = retainedCollectible ? [{
  walletFingerprint: scope.walletFingerprint, accountId: scope.accountId,
  address: owner, networkId: scope.network.id, registrationHash: scope.network.registrationHash,
  chainId: scope.network.chainId, hash: hash(1), phase: 'signed', nonce: 0,
  createdAt: 1700000000000, recipient: collectibleContract, amountUnits: '0',
  maximumFeeUnits: '150000', inspectionOnly: true,
  collectibleTransfer: {
    kind: 'nft-transfer', chainId: scope.network.chainId, from: owner,
    contractAddress: collectibleContract, recipient, tokenStandard: 'ERC-1155',
    tokenId: '0', amountUnits: ((1n << 256n) - 1n).toString(),
  },
}] : [];

let tokenPrecision: number | null = tokenMetadata ? 18 : null;
let invalidFee = false;
const contractCreation = new URLSearchParams(window.location.search).has(
  'contract-creation'
);
let feedReads = 0;
let receiptReads = 0;
let saveRequests = 0;
let saveSettled = 0;
class Explorer extends ActivityExplorerReader {
  async page(
    _scope: unknown,
    feed: ActivityFeed,
    page: number
  ): Promise<readonly DiscoveredActivityCandidate[]> {
    feedReads++;
    if (fail) throw new Error('fixture unavailable');
    if (retainedCollectible) return [];
    if (identityRegression) {
      const mixed = identityRegression === 'mixed-case';
      const raw = (index: number, token: boolean) => ({
        hash: mixed ? `0x${hash(index).slice(2).toUpperCase()}` : hash(index),
        from: recipient, to: owner, nonce: mixed && index === 0xdef ? '8' : '7',
        value: token ? '1' : '1000000000000000000', blockNumber: index === 0xabc ? '100' : '99',
        timeStamp: '1700000000', confirmations: '1', input: '0x', isError: '0',
        ...(token ? { contractAddress: recipient, tokenDecimal: '0', tokenSymbol: 'IDENTITY' } : {}),
      });
      const result = feed === 'txlist' ? mixed && page === 1 ? [raw(0xabc, false)] : []
        : page === 1 && mixed ? Array.from({ length: 20 }, (_, index) => raw(index % 2 ? 0xdef : 0xabc, true))
        : page <= 2 ? [raw(0xabc, true), raw(0xdef, true)] : [];
      return decodeActivityPage({ status: '1', message: 'OK', result }, feed, owner, 1);
    }
    const indices =
      page > 2
        ? []
        : tokenPrecision !== null
        ? feed === 'tokentx' && page === 1
          ? [1]
          : []
        : feed === 'tokentx'
        ? page === 1
          ? [3]
          : []
        : Array.from({ length: 20 }, (_, n) => (page - 1) * 20 + n + 1).map(
            (index) => (index >= 3 ? index + 1 : index)
          );
    const result = indices.map((n) => ({
      hash: hash(n),
      from: feed === 'tokentx' ? recipient : n % 2 ? owner : recipient,
      to:
        feed === 'tokentx'
          ? owner
          : contractCreation && n === 1
          ? null
          : n % 2
          ? recipient
          : owner,
      value:
        feed === 'tokentx'
          ? tokenMetadata ? tokenMetadata === 'malformed' ? 'invalid' : '1000000' : tokenPrecision !== null
            ? '1'
            : '0'
          : '1000000000000000000',
      nonce: String(n),
      blockNumber: String(1000 - n),
      timeStamp: String(1700000000 - n),
      confirmations: '1',
      isError: '0',
      txreceipt_status: '1',
      input: '0x',
      ...(feed === 'tokentx'
        ? {
            contractAddress: recipient,
            ...(tokenMetadata === 'missing' ? {} : { tokenDecimal: tokenMetadata === 'invalid' ? 'unknown' : String(tokenPrecision ?? 0) }),
            tokenSymbol: tokenMetadata ? 'UNKNOWN' : tokenPrecision === null ? 'ZERO' : 'PRECISE',
          }
        : {}),
    }));
    return decodeActivityPage(
      result.length
        ? { status: '1', message: 'OK', result }
        : { status: '0', message: 'No transactions found', result: [] },
      feed,
      owner,
      1
    );
  }
}
class Receipts extends ActivityReceiptReader {
  async read(h: string): Promise<ActivityTransactionObservation> {
    receiptReads++;
    if (delay) await new Promise<void>((resolve) => waiting.push(resolve));
    const n = Number(BigInt(h));
    return {
      hash: h,
      from: n % 2 ? owner : recipient,
      to: contractCreation && n === 1 ? null : n % 2 ? recipient : owner,
      valueUnits: n === 3 ? '0' : '1000000000000000000',
      nonce: String(n),
      timestamp: 1700000000000 - n * 1000,
      block: { hash: hash(1000), number: '1000' },
      status: 'confirmed',
      feeUnits: invalidFee ? ((1n << 256n) ** 2n).toString() : '21000',
      events:
        n === 3
          ? [
              {
                id: `${h}:0`,
                logIndex: '0',
                contractAddress: recipient,
                from: recipient,
                to: owner,
                amountUnits: '0',
              },
            ]
          : [],
    };
  }
}
const freshStatus = freshStatusFixture(
  new URLSearchParams(window.location.search).get('fresh-status'),
  scope
);
const runtime: NativeActivityRuntime = {
  async load() {
    return {
      scope,
      locals: freshStatus?.locals ?? collectibleLocals,
      saved: {
        archived: [],
        candidates: [],
        view: savedView,
        truncated: false,
      },
    };
  },
  observeLocal: freshStatus?.observeLocal,
  async saveCache() {},
  async saveView(_scope, view, guard) {
    saveRequests++;
    try {
      if (saveDelay)
        await new Promise((resolve) => setTimeout(resolve, saveDelay));
      guard();
      savedView = view;
    } finally {
      saveSettled++;
    }
  },
};
const controller = new NativeActivity(
  { getSnapshot: getState, subscribe },
  () => runtime,
  freshStatus?.explorer ?? new Explorer(),
  freshStatus?.receipts ?? new Receipts()
);
declare global {
  interface Window {
    __activityFixture: {
      fail(value: boolean): void;
      delay(value: boolean): void;
      release(): void;
      delaySave(milliseconds: number): void;
      savedView(): ActivityViewState;
      clearView(): void;
      tokenPrecision(value: number): void;
      invalidFee(value: boolean): void;
      saveRequests(): number;
      saveSettled(): number;
      lock(): void;
      feedReads(): number;
      receiptReads(): number;
      rowState(): {
        indexedStatus?: string;
        observation?: string;
        block: string | null;
        unavailable: boolean;
        checking: boolean;
      }[];
      changeContext(): void;
    };
  }
}
window.__activityFixture = {
  fail(value) {
    fail = value;
  },
  delay(value) {
    delay = value;
  },
  release() {
    delay = false;
    for (const resolve of waiting.splice(0)) resolve();
  },
  delaySave(milliseconds) {
    saveDelay = milliseconds;
  },
  savedView() {
    return savedView;
  },
  clearView() {
    savedView = DEFAULT_ACTIVITY_VIEW;
  },
  tokenPrecision(value) {
    tokenPrecision = value;
  },
  invalidFee(value) {
    invalidFee = value;
  },
  saveRequests: () => saveRequests,
  saveSettled: () => saveSettled,
  lock,
  feedReads: () => feedReads,
  receiptReads: () => receiptReads,
  rowState: () => controller.getSnapshot().rows.map(row => ({
    indexedStatus: row.indexedStatus,
    observation: row.observation?.status,
    block: row.observation?.block?.number ?? null,
    unavailable: row.unavailable,
    checking: row.checking,
  })),
  changeContext() {
    state = { ...state, revision: state.revision + 1 };
    for (const listener of stateListeners) listener(state);
  },
};
function ShellFixture() {
  const current = useSyncExternalStore(subscribe, getState, getState);
  const scope = () =>
    state.phase === 'ready' ? `activity:${state.revision}` : null;
  const shell = useRealShell(scope(), scope, lock);
  const content =
    current.phase !== 'ready' ? (
      <Notice
        title="Fixture locked"
        body="Late navigation must remain revoked."
      />
    ) : shell.tab === 'activity' ? (
      <NativeActivityScreen
        controller={controller}
        accountLabel="Public test account"
        onBack={() => shell.finishLeave('wallet')}
        navigation={shell.navigation}
      />
    ) : (
      <Screen>
        <Header
          title={
            shell.tab === 'wallet'
              ? 'Wallet'
              : shell.tab === 'tools'
              ? 'Tools'
              : 'Settings'
          }
        />
      </Screen>
    );
  return (
    <RealAppShell
      tab={shell.tab}
      onTab={shell.select}
      immersive={shell.immersive || current.phase !== 'ready'}
    >
      {content}
    </RealAppShell>
  );
}
function Fixture() {
  const [open, setOpen] = useState(true);
  return (
    <SafeAreaProvider>
      {new URLSearchParams(window.location.search).has('shell') ? (
        <ShellFixture />
      ) : open ? (
        <NativeActivityScreen
          controller={controller}
          accountLabel="Public test account"
          onBack={() => setOpen(false)}
          onReplay={retainedCollectible ? () => { throw new Error('Read-only collectible cannot replay'); } : undefined}
        />
      ) : (
        <Button title="Open Activity" onPress={() => setOpen(true)} />
      )}
    </SafeAreaProvider>
  );
}
registerRootComponent(Fixture);
