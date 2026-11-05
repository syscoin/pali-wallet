import { idleFixture } from './security';
// Synthetic adapters exercise the actual App and native screens. No live funds or RPC.
import React from 'react';
import { registerRootComponent } from 'expo';
import { AppState, Linking, Platform, Share } from 'react-native';
import { activityFetch, activityFixture } from './utxoActivityFixture';
import { evmActivityFetch, evmActivityFixture } from './evmActivityFixture';
import { WatchOnlyAuthority } from '../../src/core/watchOnlyAuthority';
import { UTXO_NETWORKS } from '../../src/core/utxoNetworks';
import App from '../../App';
import { latestAuthority, retiredAuthorities, latestTransfers, fixtureFetch, fixtureCatalogue, noteInventoryFixture } from './nativeFactory';
import { audit, events, publicShares, setWatchBalanceMode, readAccounts, readSelection, setReadFailure, setDelayUnlock, setDelaySign, releaseUnlock, releaseSign, setDelayKeyRead, releaseKeyRead, setKeyFailure, setDelayImport, releaseImport, setImportFailure } from './state';
import { recoveryAudit, holdRecovery, releaseRecovery } from './recoveryState';

Platform.OS = new URLSearchParams(window.location.search).has('android') ? 'android' : 'ios';
let appState = 'active';
const listeners = new Map<string, Set<(state: string) => void>>();
Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => appState });
AppState.addEventListener = ((event: string, listener: (state: string) => void) => {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(listener);
  return { remove() { listeners.get(event)!.delete(listener); } };
}) as typeof AppState.addEventListener;
const quoteRequests: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.href);
  if ((url.origin === 'https://api.coingecko.com' && url.pathname === '/api/v3/simple/price') || url.pathname.endsWith('/api/v2/tickers/currency')) {
    if (!new URLSearchParams(window.location.search).has('fiat-fixture')) return new Response(null, { status: 503 });
    if (init?.method !== 'GET' || init.body !== undefined || init.credentials !== 'omit' || init.redirect !== 'error')
      throw new Error('Unexpected quote request options');
    quoteRequests.push(url.href);
    return Response.json(url.origin === 'https://api.coingecko.com' ? { ethereum: { usd: 100, eur: 200 } } : { rates: { usd: 100, eur: 200 } });
  }
  return await activityFetch(input, init) ?? await evmActivityFetch(input, init) ?? fixtureFetch(input, init);
};
const originalOpen = Linking.openURL;
Linking.openURL = async (url) => { if (UTXO_NETWORKS.some(({ explorer }) => url.startsWith(new URL('tx/', explorer).href))) { activityFixture.open(url); return; } if (evmActivityFixture.open(url)) return; return originalOpen(url); };
Share.share = async (content) => { publicShares.push(content.message ?? ''); return { action: Share.sharedAction, activityType: undefined }; };
// Delegate normal opening and retain the actual authority only for lifecycle
// controls. Selection still runs its production account/network guards.
const openWatchRecords = WatchOnlyAuthority.openRecords.bind(WatchOnlyAuthority);
let latestWatchAuthority: WatchOnlyAuthority | undefined;
WatchOnlyAuthority.openRecords = async (options) => {
  const authority = await openWatchRecords(options);
  latestWatchAuthority = authority;
  return authority;
};
declare global {
  interface Window {
    __watchFixture: {
      activity: typeof activityFixture;
      evmActivity: typeof evmActivityFixture;
      notes: typeof noteInventoryFixture;
      idle: typeof idleFixture;
      quotes(): string[];
      audit(): typeof audit;
      events(): string[];
      shares(): string[];
      watchBalance(mode: 'value' | 'zero' | 'error'): void;
      accounts(): ReturnType<typeof readAccounts>;
      selection(): ReturnType<typeof readSelection>;
      readFailure(value: boolean): void;
      delayUnlock(value: boolean): void;
      releaseUnlock(): void;
      delaySign(value: boolean): void;
      releaseSign(): void;
      lifecycle(state: 'active' | 'inactive' | 'background'): void;
      blur(): void;
      delayKeyRead(value: boolean): void;
      releaseKeyRead(): void;
      keyFailure(code: 'AUTH_THROTTLED' | null): void;
      delayImport(value: boolean): void;
      releaseImport(): void;
      importFailure(code: 'AUTH_THROTTLED' | null): void;
      catalogue(): ReturnType<typeof fixtureCatalogue>;
      selectAccount(id: string): Promise<void>;
      selectWatchNetwork(id: Parameters<WatchOnlyAuthority['selectNetwork']>[0]): void;
      nativePhase(): string | null;
      oldPhases(): string[];
      transferPhase(): string | null;
      reviewId(): string | null;
      confirmReview(id: string): Promise<string>;
      recoveryAudit(): typeof recoveryAudit;
      holdRecovery(stage: 'prepare' | 'commit' | 'dispose'): void;
      releaseRecovery(stage: 'prepare' | 'commit' | 'dispose'): void;
    };
  }
}
window.__watchFixture = {
  activity: activityFixture, evmActivity: evmActivityFixture, idle: idleFixture, notes: noteInventoryFixture,
  quotes: () => [...quoteRequests], audit: () => ({ ...audit }), events: () => [...events], shares: () => [...publicShares], watchBalance: setWatchBalanceMode, accounts: readAccounts, selection: readSelection,
  readFailure: setReadFailure, delayUnlock: setDelayUnlock, releaseUnlock, delaySign: setDelaySign, releaseSign,
  lifecycle(state) { appState = state; for (const listener of [...listeners.get('change') ?? []]) listener(state); },
  blur() { for (const listener of [...listeners.get('blur') ?? []]) listener('blur'); },
  delayKeyRead: setDelayKeyRead, releaseKeyRead, keyFailure: setKeyFailure,
  delayImport: setDelayImport, releaseImport, importFailure: setImportFailure, catalogue: fixtureCatalogue,
  async selectAccount(id) { await latestAuthority!.manageAccounts({ kind: 'select', id }, latestAuthority!.getSnapshot().revision, latestAuthority!.getCatalogue()!.revision); },
  selectWatchNetwork(id) {
    if (!latestWatchAuthority) throw Error('No opened public authority');
    latestWatchAuthority.selectNetwork(id);
  },
  nativePhase: () => latestAuthority?.getSnapshot().phase ?? null,
  oldPhases: () => retiredAuthorities.map((authority) => authority.getSnapshot().phase),
  transferPhase: () => latestTransfers?.getSnapshot().phase ?? null,
  reviewId: () => latestTransfers?.getSnapshot().review?.id ?? null,
  async confirmReview(id) { try { await latestTransfers!.view.confirm(id); return 'accepted'; } catch (cause) { return cause instanceof Error ? cause.message : 'rejected'; } },
  recoveryAudit: () => ({ ...recoveryAudit }), holdRecovery, releaseRecovery,
};
registerRootComponent(() => <App availableWatchNetworks={new URLSearchParams(window.location.search).has('disabled-utxo') ? ['evm'] : undefined} />);
