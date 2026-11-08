import React, { useState } from 'react';
import type { NativeConnectionsSnapshot, NativeConnectionsView } from '../../src/connections/types';
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
  messageReview: null,
  error: null,
};
const calls: { method: string; args: unknown[] }[] = [];
const listeners = new Set<() => void>();
const publish = (next: NativeConnectionsSnapshot) => {
  snapshot = Object.freeze(next);
  for (const listener of listeners) listener();
};
const controller: NativeConnectionsView = {
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
  async approveMessage() { throw new Error('Message signing is outside this fixture'); },
  async rejectMessage() { throw new Error('Message signing is outside this fixture'); },
  async activateMessageAccount() { throw new Error('Message signing is outside this fixture'); },
  cancel() { calls.push({ method: 'cancel', args: [] }); publish({ ...snapshot, status: 'ready', proposals: [] }); },
};

declare global {
  interface Window {
    __nativeConnectionsFixture: {
      calls(): typeof calls;
      proposal(allowed?: boolean): void;
      fail(): void;
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
};

export function NativeConnectionsFixture() {
  const [open, setOpen] = useState(true);
  return open ? <NativeConnections controller={controller} onBack={() => setOpen(false)} /> : <Text>Connections closed</Text>;
}
