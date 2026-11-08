import {
  NativeLedgerAccounts,
  type NativeLedgerRuntime,
} from '../../src/custody/ledgerAccounts';
import type { NativeCustodyAuthority } from '../../src/custody/authority';

export function createLedgerConnectionFixture(address: string) {
  let connected = false;
  let complete: (() => void) | undefined;
  const calls: string[] = [];
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const snapshot = { phase: 'ready', revision: 1 };
  const catalogue = {
    revision: 1,
    active: { accountId: 'ledger:60:0', networkId: 'fixture' },
    accounts: [{ id: 'ledger:60:0', address }],
    networks: [{ id: 'fixture', name: 'Selected network' }],
    utxoNetworks: [],
  };
  const authority = {
    getSnapshot: () => snapshot,
    getCatalogue: () => catalogue,
    subscribe: () => () => {},
    cancelAccountOperation() {},
  } as unknown as NativeCustodyAuthority;
  const runtime: NativeLedgerRuntime = {
    isConnected: () => connected,
    subscribeStatus(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async scan(_request, _signal, check, onDevices) {
      calls.push('start');
      let handedOff = false;
      check();
      onDevices([{ id: 'fixture-device', name: 'My Ledger', model: 'Nano X' }]);
      return {
        async select(id) {
          check();
          calls.push(`select:${id}`);
          return { name: 'My Ledger', address };
        },
        handoff() {
          check();
          calls.push('finish');
          handedOff = true;
          connected = true;
          changed();
        },
        async close() {
          calls.push('close');
          if (!handedOff) connected = false;
          else if (
            new URLSearchParams(window.location.search).has('hold-connection')
          )
            await new Promise<void>((resolve) => {
              complete = resolve;
            });
        },
      };
    },
  };
  const controller = new NativeLedgerAccounts(
    authority,
    () => runtime,
    'connect'
  );
  window.__nativeLedgerSigningFixture = {
    calls: () => calls,
    complete: () => complete?.(),
    disconnect() {
      connected = false;
      changed();
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
