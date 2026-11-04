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
  type ActivityFeed,
} from '../../src/activity/explorerReader';
import {
  ActivityReceiptReader,
  type ActivityTransactionObservation,
} from '../../src/activity/receiptReader';
import {
  createActivityScope,
  DEFAULT_ACTIVITY_VIEW,
  type ActivityCandidate,
  type ActivityViewState,
} from '../../src/activity/types';
import type { CustodySnapshot } from '../../src/custody/types';
import { Button, Header, Notice, Screen } from '../../src/ui';
import { RealAppShell } from '../../src/screens/RealAppShell';
import { useRealShell } from '../../src/screens/useRealShell';

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
const subscribe = (listener: (state: CustodySnapshot) => void) => { stateListeners.add(listener); return () => { stateListeners.delete(listener); }; };
const getState = () => state;
function lock() { state = { ...state, revision: state.revision + 1, phase: 'locked', account: null }; for (const listener of stateListeners) listener(state); }
let fail = false,
  delay = false;
const waiting: (() => void)[] = [];
let savedView: ActivityViewState = DEFAULT_ACTIVITY_VIEW;
let saveDelay = 0;
let tokenPrecision: number | null = null;
let invalidFee = false;
let saveRequests = 0;
let saveSettled = 0;
class Explorer extends ActivityExplorerReader {
  async head() {
    return '1000';
  }
  async page(
    _scope: unknown,
    feed: ActivityFeed,
    page: number
  ): Promise<readonly ActivityCandidate[]> {
    if (fail) throw new Error('fixture unavailable');
    if (feed === 'tokentx' || page > 2) return [];
    return Array.from({ length: 20 }, (_, n) => ({
      hash: hash((page - 1) * 20 + n + 1),
      blockNumber: String(1000 - ((page - 1) * 20 + n)),
      timestamp: 1700000000000 - n * 1000,
      tokenHint: n === 2,
    }));
  }
}
class Receipts extends ActivityReceiptReader {
  async read(h: string): Promise<ActivityTransactionObservation> {
    if (delay) await new Promise<void>((resolve) => waiting.push(resolve));
    const n = Number(BigInt(h));
    return {
      hash: h,
      from: n % 2 ? owner : recipient,
      to: n % 2 ? recipient : owner,
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
const runtime: NativeActivityRuntime = {
  async load() {
    return {
      scope,
      local:
        tokenPrecision === null
          ? null
          : {
              walletFingerprint: scope.walletFingerprint,
              accountId: scope.accountId,
              address: owner,
              networkId: scope.network.id,
              registrationHash: scope.network.registrationHash,
              chainId: scope.network.chainId,
              hash: hash(1),
              phase: 'confirmed',
              nonce: 1,
              createdAt: 1700000000000,
              recipient,
              amountUnits: '1',
              maximumFeeUnits: '21000',
              token: {
                contractAddress: recipient,
                name: 'Precision token',
                symbol: 'PRECISE',
                decimals: tokenPrecision,
              },
            },
      saved: {
        archived: [],
        candidates: [],
        view: savedView,
        truncated: false,
      },
    };
  },
  async saveCache() {},
  async saveView(_scope, view, guard) {
    saveRequests++;
    try {
      if (saveDelay) await new Promise((resolve) => setTimeout(resolve, saveDelay));
      guard(); savedView = view;
    } finally { saveSettled++; }
  },
};
const controller = new NativeActivity(
  { getSnapshot: getState, subscribe },
  () => runtime,
  new Explorer(),
  new Receipts()
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
};
function ShellFixture() {
  const current = useSyncExternalStore(subscribe, getState, getState);
  const scope = () => state.phase === 'ready' ? `activity:${state.revision}` : null;
  const shell = useRealShell(scope(), scope, lock);
  const content = current.phase !== 'ready' ? <Notice title="Fixture locked" body="Late navigation must remain revoked." />
    : shell.tab === 'activity' ? <NativeActivityScreen controller={controller} accountLabel="Public test account" onBack={() => shell.finishLeave('wallet')} navigation={shell.navigation} />
    : <Screen><Header title={shell.tab === 'wallet' ? 'Wallet' : shell.tab === 'tools' ? 'Tools' : 'Settings'} /></Screen>;
  return <RealAppShell tab={shell.tab} onTab={shell.select} immersive={shell.immersive || current.phase !== 'ready'}>{content}</RealAppShell>;
}
function Fixture() {
  const [open, setOpen] = useState(true);
  return (
    <SafeAreaProvider>
      {new URLSearchParams(window.location.search).has('shell') ? <ShellFixture /> : open ? (
        <NativeActivityScreen
          controller={controller}
          accountLabel="Public test account"
          onBack={() => setOpen(false)}
        />
      ) : (
        <Button title="Open Activity" onPress={() => setOpen(true)} />
      )}
    </SafeAreaProvider>
  );
}
registerRootComponent(Fixture);
