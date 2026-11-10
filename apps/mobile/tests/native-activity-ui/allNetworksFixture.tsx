import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { AccountActivityController, AccountActivityRow, AccountActivitySnapshot } from '../../src/activity/accountActivity';
import type { ActivityRow, NativeActivity, NativeActivitySnapshot } from '../../src/activity/nativeActivity';
import { DEFAULT_ACTIVITY_VIEW } from '../../src/activity/types';
import { getNativeNetwork } from '../../src/custody/networkContext';
import { saveBalancePrivacy } from '../../src/platform/balancePrivacy';
import { AllNetworksActivity } from '../../src/screens/AllNetworksActivity';
import { RealAppShell } from '../../src/screens/RealAppShell';
import { useRealShell } from '../../src/screens/useRealShell';
import type { NotificationChoice } from '../../src/notifications/choices';

const owner = `0x${'11'.repeat(20)}`, external = `0x${'22'.repeat(20)}`;
const hash = `0x${'aa'.repeat(32)}`;
const inspections: string[] = [], listeners = new Set<() => void>();
const make = (networkId: string, incoming: boolean, timestamp: number, valueUnits: string): AccountActivityRow => {
  const network = getNativeNetwork(networkId);
  const choice: NotificationChoice = { label: 'Public test account', networkName: network.name, symbol: network.symbol,
    scope: { id: `native:hd:60:0:${network.id}`, accountId: 'hd:60:0', accountType: 'HDAccount', accountAddress: owner, network } };
  const row: ActivityRow = { hash, checking: false, unavailable: false, observation: {
    hash, from: incoming ? external : owner, to: incoming ? owner : external, valueUnits, nonce: '0', timestamp,
    block: { hash: `0x${'bb'.repeat(32)}`, number: '7' }, status: 'confirmed', events: [], feeUnits: '1000000000000000',
  } };
  const snapshot: NativeActivitySnapshot = { status: 'ready', rows: [row], view: DEFAULT_ACTIVITY_VIEW, accountAddress: owner,
    scopeKey: choice.scope.id, chainId: network.chainId, networkName: network.name, nativeSymbol: network.symbol,
    explorerUrl: null, loadingMore: false, hasMore: false, error: null, coverage: '', truncated: false };
  const child = { getSnapshot: () => snapshot, subscribe: () => () => undefined,
    connect() { throw Error('The aggregate owns child lifetimes'); }, loadSavedPending: async () => undefined,
    inspect(value: string) { if (value !== hash) throw Error('Unexpected hash'); inspections.push(network.id); }, setView: async () => undefined,
  } as unknown as NativeActivity;
  return { key: `${choice.scope.id}:${hash}`, choice, row, controller: child };
};
const entries = [make('base', false, Date.now() - 60000, '2345678901234567890'), make('ethereum', true, Date.now() - 120000, '1234567890000000000')];
const query = new URLSearchParams(window.location.search);
let state: AccountActivitySnapshot = { status: 'ready', accountId: 'hd:60:0', filter: query.get('filter') ?? 'all', choices: entries.map(entry => entry.choice),
  rows: [], view: { ...DEFAULT_ACTIVITY_VIEW, filter: query.get('direction') === 'received' ? 'received' : 'all' },
  refreshing: false, loadingMore: false, hasMore: false, partial: false, error: null };
const update = () => {
  state = { ...state, rows: entries.filter(entry => (state.filter === 'all' || entry.choice.scope.network.id === state.filter) &&
    (state.view.filter === 'all' || (state.view.filter === 'sent') === (entry.row.observation?.from === owner))) };
  for (const listener of listeners) listener();
};
update();
const controller = { getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  connect: () => () => undefined, refresh: async () => update(), loadMore: async () => undefined,
  findRow: (networkId: string, rowHash: string) => entries.find(entry => entry.choice.scope.network.id === networkId && entry.row.hash === rowHash),
  selectFilter: async (filter: string) => { state = { ...state, filter }; update(); },
  setView: async (view: Partial<typeof DEFAULT_ACTIVITY_VIEW>) => { state = { ...state, view: { ...state.view, ...view } }; update(); },
} as unknown as AccountActivityController;
declare global { interface Window { __allActivityFixture: { inspections(): string[]; hideBalances(value: boolean): Promise<void> } } }
window.__allActivityFixture = { inspections: () => [...inspections], async hideBalances(value) { await saveBalancePrivacy(value); } };
export function AllNetworksActivityFixture() {
  const shell = useRealShell('activity-fixture', () => 'activity-fixture', () => {});
  return <SafeAreaProvider><RealAppShell tab="activity" onTab={() => {}} immersive={shell.immersive}>
    <AllNetworksActivity controller={controller} accountLabel="Public test account" navigation={shell.navigation}
      initialTarget={query.get('target') ? { networkId: query.get('target')!, hash } : undefined} />
  </RealAppShell></SafeAreaProvider>;
}
