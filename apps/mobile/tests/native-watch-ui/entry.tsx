// Synthetic adapters exercise the actual App and native screens. No live funds or RPC.
import React from 'react';
import { registerRootComponent } from 'expo';
import { AppState, Platform } from 'react-native';
import App from '../../App';
import { latestAuthority, retiredAuthorities, latestTransfers, fixtureFetch } from './nativeFactory';
import { audit, events, readAccounts, readSelection, setReadFailure, setDelayUnlock, setDelaySign, releaseUnlock, releaseSign } from './state';

Platform.OS = 'ios';
let appState = 'active';
const listeners = new Set<(state: string) => void>();
Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => appState });
AppState.addEventListener = ((_event: string, listener: (state: string) => void) => {
  listeners.add(listener);
  return { remove() { listeners.delete(listener); } };
}) as typeof AppState.addEventListener;
globalThis.fetch = fixtureFetch;
declare global {
  interface Window {
    __watchFixture: {
      audit(): typeof audit;
      events(): string[];
      accounts(): ReturnType<typeof readAccounts>;
      selection(): ReturnType<typeof readSelection>;
      readFailure(value: boolean): void;
      delayUnlock(value: boolean): void;
      releaseUnlock(): void;
      delaySign(value: boolean): void;
      releaseSign(): void;
      lifecycle(state: 'active' | 'background'): void;
      nativePhase(): string | null;
      oldPhases(): string[];
      transferPhase(): string | null;
      reviewId(): string | null;
      confirmReview(id: string): Promise<string>;
    };
  }
}
window.__watchFixture = {
  audit: () => ({ ...audit }), events: () => [...events], accounts: readAccounts, selection: readSelection,
  readFailure: setReadFailure, delayUnlock: setDelayUnlock, releaseUnlock, delaySign: setDelaySign, releaseSign,
  lifecycle(state) { appState = state; for (const listener of [...listeners]) listener(state); },
  nativePhase: () => latestAuthority?.getSnapshot().phase ?? null,
  oldPhases: () => retiredAuthorities.map((authority) => authority.getSnapshot().phase),
  transferPhase: () => latestTransfers?.getSnapshot().phase ?? null,
  reviewId: () => latestTransfers?.getSnapshot().review?.id ?? null,
  async confirmReview(id) { try { await latestTransfers!.view.confirm(id, 'public-password'); return 'accepted'; } catch (cause) { return cause instanceof Error ? cause.message : 'rejected'; } },
};
registerRootComponent(() => <App />);
