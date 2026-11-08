import type {
  NativeLedgerConnectionView,
  NativeLedgerSnapshot,
} from '../../src/custody/ledgerAccounts';

export function createLedgerConnectionFixture(address: string) {
  let connected = false;
  let handedOff = false;
  let complete: (() => void) | undefined;
  const calls: string[] = [];
  const listeners = new Set<() => void>();
  let snapshot: NativeLedgerSnapshot = {
    phase: 'idle',
    networkId: 'fixture',
    networkLabel: 'Selected network',
    address,
    devices: [],
    selectedName: null,
    error: null,
  };
  const publish = (next: Partial<NativeLedgerSnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...next });
    for (const listener of listeners) listener();
  };
  const controller: NativeLedgerConnectionView = {
    purpose: 'connect',
    getSnapshot: () => snapshot,
    isConnected: () => connected,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      calls.push('start');
      handedOff = false;
      publish({
        phase: 'scanning',
        devices: [{ id: 'fixture-device', name: 'My Ledger', model: 'Nano X' }],
      });
    },
    async select(id) {
      calls.push(`select:${id}`);
      publish({ phase: 'connected', selectedName: 'My Ledger', address });
    },
    async finishConnection() {
      calls.push('finish');
      if (new URLSearchParams(window.location.search).has('hold-connection'))
        await new Promise<void>((resolve) => {
          complete = resolve;
        });
      handedOff = true;
      connected = true;
      publish({ phase: 'idle', devices: [] });
    },
    async close() {
      calls.push('close');
      if (!handedOff) connected = false;
    },
  };
  window.__nativeLedgerSigningFixture = {
    calls: () => calls,
    complete: () => complete?.(),
    disconnect() {
      connected = false;
      handedOff = false;
      publish({ phase: 'idle' });
    },
  };
  return controller;
}

declare global {
  interface Window {
    __nativeLedgerSigningFixture: {
      calls(): string[];
      complete(): void;
      disconnect(): void;
    };
  }
}
