import React, { useLayoutEffect, useState } from 'react';
import type { NativeConnectionsSnapshot, NativeConnectionsView } from '../../src/connections/types';
import type { NativePairingEntry } from '../../src/connections/pairingLinks';
import { NativeConnections } from '../../src/screens/NativeConnections';
import { Text } from '../../src/ui';

const accounts = [
  { id: 'hd:60:0', label: 'Daily wallet', address: '0x1111111111111111111111111111111111111111' },
  { id: 'hd:60:1', label: 'Savings', address: '0x2222222222222222222222222222222222222222' },
] as const;
let snapshot: NativeConnectionsSnapshot = {
  revision: 7,
  status: 'ready',
  accounts,
  selectedAccountId: accounts[0].id,
  network: { id: 'ethereum', label: 'Ethereum', chainId: '1' },
  proposals: [],
  sessions: [],
  signingReview: null,
  callsStatus: null,
  error: null,
};
const calls: { method: string; args: unknown[] }[] = [];
const listeners = new Set<() => void>();
let receiveEntry: ((entry: NativePairingEntry) => void) | undefined;
const publish = (next: NativeConnectionsSnapshot) => {
  snapshot = Object.freeze(next);
  for (const listener of listeners) listener();
};
const controller: NativeConnectionsView = {
    async callsStatusShown() { throw new Error('Calls status is outside this fixture'); },
    dismissCallsStatus() { throw new Error('Calls status is outside this fixture'); },
    async confirmSmartPayer() { throw new Error('No Smart payer review in this fixture'); },
  async chooseTransactionFee() { throw new Error('Fee choices are unavailable for this fixture'); },
  async editApprovalAmount() { throw new Error('Transaction editing is outside this fixture'); },
  getSnapshot: () => snapshot,
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  async pair(uri) { calls.push({ method: 'pair', args: [uri] }); publish({ ...snapshot, status: 'pairing' }); },
  async approve(...args) {
    calls.push({ method: 'approve', args });
    publish({ ...snapshot, revision: snapshot.revision + 1, proposals: [], sessions: [
      { id: 'connection-1', name: 'Example app', origin: 'https://example.invalid', accountLabel: 'Savings', networkLabel: 'Ethereum' },
    ] });
  },
  async reject(id) { calls.push({ method: 'reject', args: [id] }); publish({ ...snapshot, proposals: [] }); },
  async disconnect(id) { calls.push({ method: 'disconnect', args: [id] }); publish({ ...snapshot, sessions: [] }); },
  async approveRequest() { throw new Error('Message signing is outside this fixture'); },
  async rejectRequest() { throw new Error('Message signing is outside this fixture'); },
  async activateRequestAccount() { throw new Error('Message signing is outside this fixture'); },
  async retry() { calls.push({ method: 'retry', args: [] }); publish({ ...snapshot, status: 'ready', error: null }); },
  cancel() { calls.push({ method: 'cancel', args: [] }); publish({ ...snapshot, status: 'ready', proposals: [] }); },
};

declare global {
  interface Window {
    __nativeConnectionsFixture: {
      calls(): typeof calls;
      proposal(allowed?: boolean): void;
      fail(): void;
      incoming(entry: NativePairingEntry): void;
      locked(value: boolean): void;
      unavailable(): void;
    };
  }
}
window.__nativeConnectionsFixture = {
  calls: () => calls,
  proposal(allowed = true) {
    publish({ ...snapshot, revision: snapshot.revision + 1, status: 'ready', proposals: [
      { id: 42, name: 'Example app', origin: 'https://example.invalid', verification: { validation: 'VALID', isScam: false }, requiredMethods: ['eth_accounts'], canApprove: allowed },
    ] });
  },
  fail() { publish({ ...snapshot, error: 'CONTEXT_CHANGED' }); },
  incoming(entry) { receiveEntry?.(entry); },
  locked(value) { publish({ ...snapshot, status: value ? 'locked' : 'ready' }); },
  unavailable() { publish({ ...snapshot, status: 'unavailable', error: 'CONNECTION_UNAVAILABLE' }); },
};

export function NativeConnectionsFixture() {
  const [open, setOpen] = useState(true);
  const [incoming, setIncoming] = useState<NativePairingEntry | null>(null);
  useLayoutEffect(() => {
    receiveEntry = setIncoming;
    return () => { receiveEntry = undefined; };
  }, []);
  return open ? <NativeConnections controller={controller} onBack={() => setOpen(false)}
    incomingPairing={incoming} onPairingHandled={(id) => {
      calls.push({ method: 'handled', args: [id] });
      setIncoming((current) => current?.id === id ? null : current);
    }} /> : <Text>Connections closed</Text>;
}
