import React, { useLayoutEffect, useState } from 'react';
import type {
  NativeLedgerSnapshot,
  NativeLedgerView,
} from '../../src/custody/ledgerAccounts';
import { NativeLedger } from '../../src/screens/NativeLedger';
import { Text } from '../../src/ui';

const address = '0x1111111111111111111111111111111111111111';
let snapshot: NativeLedgerSnapshot = {
  phase: 'idle',
  networkId: 'ethereum',
  networkLabel: 'Ethereum',
  address: null,
  devices: [],
  selectedName: null,
  error: null,
};
const listeners = new Set<() => void>();
const calls: string[] = [];
let completeImport: (() => void) | undefined;
let refreshParent: (() => void) | undefined;
function publish(next: Partial<NativeLedgerSnapshot>) {
  snapshot = Object.freeze({ ...snapshot, ...next });
  for (const listener of listeners) listener();
}
const controller: NativeLedgerView = {
  purpose: 'import',
  getSnapshot: () => snapshot,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async start() {
    calls.push('start');
    publish({
      phase: 'scanning',
      devices: [{ id: 'scan-device', name: 'My Ledger', model: 'Nano X' }],
    });
  },
  async select(id) {
    calls.push(`select:${id}`);
    publish({ phase: 'connected', selectedName: 'My Ledger', address });
  },
  async importAccount(label) {
    calls.push(`import:${label}`);
    publish({ phase: 'importing' });
    if (new URLSearchParams(window.location.search).has('hold'))
      await new Promise<void>((resolve) => {
        completeImport = resolve;
      });
  },
  async close() {
    calls.push('close');
  },
};

declare global {
  interface Window {
    __nativeLedgerFixture: {
      calls(): string[];
      resolveImport(): void;
      refreshParent(): void;
      fail(): void;
    };
  }
}
window.__nativeLedgerFixture = {
  calls: () => calls,
  resolveImport() {
    completeImport?.();
  },
  refreshParent() {
    refreshParent?.();
  },
  fail() {
    publish({
      phase: 'error',
      error: 'Bluetooth is unavailable. Turn it on and try again.',
    });
  },
};

export function NativeLedgerFixture() {
  const [page, setPage] = useState('ledger');
  const [, update] = useState(0);
  useLayoutEffect(() => {
    refreshParent = () => update((value) => value + 1);
    return () => {
      refreshParent = undefined;
    };
  }, []);
  return page === 'ledger' ? (
    <NativeLedger
      controller={controller}
      onBack={() => setPage('closed')}
      onFinished={() => setPage('imported')}
    />
  ) : (
    <Text>
      {page === 'imported' ? 'Ledger account added' : 'Ledger screen closed'}
    </Text>
  );
}
