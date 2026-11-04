// Public synthetic data only. This entrypoint is never imported by the app.
import React from 'react';
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
} from '../../src/activity/types';
import type { CustodySnapshot } from '../../src/custody/types';

const owner = `0x${'11'.repeat(20)}`,
  recipient = `0x${'22'.repeat(20)}`;
const hash = (i: number) => `0x${i.toString(16).padStart(64, '0')}`;
const scope = createActivityScope('a'.repeat(64), 'hd:60:0', owner, 'ethereum');
const state: CustodySnapshot = {
  phase: 'ready',
  revision: 1,
  presence: 'existing',
  backup: 'confirmed',
  account: { network: 'ethereum', address: owner },
  error: null,
};
let fail = false,
  delay = false;
const waiting: (() => void)[] = [];
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
      status: 'finalized',
      feeUnits: '21000',
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
      local: null,
      saved: {
        archived: [],
        candidates: [],
        view: DEFAULT_ACTIVITY_VIEW,
        truncated: false,
      },
    };
  },
  async saveCache() {},
  async saveView() {},
};
const controller = new NativeActivity(
  { getSnapshot: () => state, subscribe: () => () => undefined },
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
};
function Fixture() {
  return (
    <SafeAreaProvider>
      <NativeActivityScreen
        controller={controller}
        accountLabel="Public test account"
        onBack={() => undefined}
      />
    </SafeAreaProvider>
  );
}
registerRootComponent(Fixture);
