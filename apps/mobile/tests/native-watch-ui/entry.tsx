import { FixtureDeviceAuthorization } from '../native-send-ui/fixtureDeviceAuthorization';
import { SlhManagementFixture } from './slhManagementFixture';
import { sysxSendFixture } from './sysxSendFixture';
import { WatchReceiveFixture } from './watchReceiveFixture';
import { idleFixture } from './security';
// Synthetic adapters exercise the actual App and native screens. No live funds or RPC.
import React from 'react';
import { registerRootComponent } from 'expo';
import { AppState, BackHandler, Dimensions, Linking, Platform, Share } from 'react-native';
import { activityFetch, activityFixture } from './utxoActivityFixture';
import { evmActivityFetch, evmActivityFixture } from './evmActivityFixture';
import { createGuardianRecoveryFixture } from './guardianRecoveryFixture';
import { WatchOnlyAuthority } from '../../src/core/watchOnlyAuthority';
import { UTXO_NETWORKS } from '../../src/core/utxoNetworks';
import App from '../../App';
import { latestAuthority, retiredAuthorities, latestTransfers, fixtureFetch, fixtureCatalogue, noteInventoryFixture, recreateRemovalWallet, visualReviewFixture } from './nativeFactory';
import { UpdateFixture } from './UpdateFixture';
import { ADDRESS, audit, events, publicShares, setWatchBalanceMode, readAccounts, readSelection, setReadFailure, setDelayUnlock, setDelaySign, releaseUnlock, releaseSign, setDelayActivityReset, failActivityReset, finishActivityReset, setDelayKeyRead, releaseKeyRead, setKeyFailure, setDelayImport, releaseImport, setImportFailure } from './state';
import { recoveryAudit, holdRecovery, releaseRecovery } from './recoveryState';
import { removalFixtureEnabled, walletRemovalFixture } from './walletRemovalFixture';

Platform.OS = new URLSearchParams(window.location.search).has('android') ? 'android' : 'ios';
// RN Web fixes fontScale at 1 and rejects Dimensions.set in a browser. Change
// the fixture's current dimensions before the actual watch component mounts.
const fixtureFontScale = new URLSearchParams(window.location.search).get('font-scale');
if (fixtureFontScale === '1.3' || fixtureFontScale === '1.6')
  Dimensions.get('window').fontScale = Number(fixtureFontScale);
let appState = 'active';
const listeners = new Map<string, Set<(state: string) => void>>();
Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => appState });
AppState.addEventListener = ((event: string, listener: (state: string) => void) => {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(listener);
  return { remove() { listeners.get(event)!.delete(listener); } };
}) as typeof AppState.addEventListener;
const backListeners = new Set<Parameters<typeof BackHandler.addEventListener>[1]>();
const hasGuardianFixture = new URLSearchParams(window.location.search).has('guardian-fixture');
if (removalFixtureEnabled || hasGuardianFixture || sysxSendFixture.enabled || visualReviewFixture.enabled) {
  BackHandler.addEventListener = ((_event, listener) => {
    backListeners.add(listener);
    return { remove() { backListeners.delete(listener); } };
  }) as typeof BackHandler.addEventListener;
}
const quoteRequests: string[] = [];
const quoteGate = new URLSearchParams(window.location.search).has('hold-quote')
  ? Promise.withResolvers<void>() : undefined;
const guardianFixture = createGuardianRecoveryFixture(ADDRESS);
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.href);
  if ((url.origin === 'https://api.coingecko.com' && url.pathname === '/api/v3/simple/price') || url.pathname.endsWith('/api/v2/tickers/currency')) {
    if (!new URLSearchParams(window.location.search).has('fiat-fixture')) return new Response(null, { status: 503 });
    if (init?.method !== 'GET' || init.body !== undefined || init.credentials !== 'omit' || init.redirect !== 'error')
      throw new Error('Unexpected quote request options');
    quoteRequests.push(url.href);
    if (quoteGate) await quoteGate.promise;
    return Response.json(url.origin === 'https://api.coingecko.com' ? { ethereum: { usd: 100, eur: 200 } } : { rates: { usd: 100, eur: 200 } });
  }
  return (hasGuardianFixture ? await guardianFixture.fetch(input, init) : undefined) ??
    await activityFetch(input, init) ?? await evmActivityFetch(input, init) ?? fixtureFetch(input, init);
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
      visual: typeof visualReviewFixture;
      fontScale(): number;
      activity: typeof activityFixture;
      sysx: typeof sysxSendFixture;
      selectNativeNetwork(id: string): Promise<void>;
      evmActivity: typeof evmActivityFixture;
      guardian: typeof guardianFixture;
      notes: typeof noteInventoryFixture;
      removal: typeof walletRemovalFixture & { recreate: typeof recreateRemovalWallet };
      idle: typeof idleFixture;
      quotes(): string[];
      releaseQuote(): void;
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
      delayActivityReset(value: boolean): void;
      failActivityReset(): void;
      finishActivityReset(): void;
      lifecycle(state: 'active' | 'inactive' | 'background'): void;
      blur(): void;
      back(): boolean;
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
  visual: visualReviewFixture,
  fontScale: () => Dimensions.get('window').fontScale,
  guardian: guardianFixture,
  sysx: sysxSendFixture,
  async selectNativeNetwork(id) {
    const authority = latestAuthority!;
    await authority.selectNetwork(id, authority.getSnapshot().revision, authority.getCatalogue()!.revision, () => {});
  },
  activity: activityFixture, evmActivity: evmActivityFixture, idle: idleFixture, notes: noteInventoryFixture,
  removal: { ...walletRemovalFixture, recreate: recreateRemovalWallet },
  quotes: () => [...quoteRequests], releaseQuote: () => quoteGate?.resolve(), audit: () => ({ ...audit }), events: () => [...events], shares: () => [...publicShares], watchBalance: setWatchBalanceMode, accounts: readAccounts, selection: readSelection,
  readFailure: setReadFailure, delayUnlock: setDelayUnlock, releaseUnlock, delaySign: setDelaySign, releaseSign,
  delayActivityReset: setDelayActivityReset, failActivityReset, finishActivityReset,
  lifecycle(state) { appState = state; for (const listener of [...listeners.get('change') ?? []]) listener(state); },
  blur() { for (const listener of [...listeners.get('blur') ?? []]) listener('blur'); },
  back() {
    const event = { type: 'hardwareBackPress', timeStamp: performance.now() };
    return [...backListeners].reverse().some((listener) => listener(event) === true);
  },
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
  async confirmReview(id) { try { await latestTransfers!.view.confirm(id, { method: 'device' }); return 'accepted'; } catch (cause) { return cause instanceof Error ? cause.message : 'rejected'; } },
  recoveryAudit: () => ({ ...recoveryAudit }), holdRecovery, releaseRecovery,
};
registerRootComponent(() => <><FixtureDeviceAuthorization />{new URLSearchParams(window.location.search).has('update-fixture') ? <UpdateFixture /> : new URLSearchParams(window.location.search).has('slh-fixture') ? <SlhManagementFixture /> : new URLSearchParams(window.location.search).has('watch-receive-fixture') ? <WatchReceiveFixture /> : <App availableWatchNetworks={new URLSearchParams(window.location.search).has('disabled-utxo') ? ['evm'] : undefined} />}</>);
