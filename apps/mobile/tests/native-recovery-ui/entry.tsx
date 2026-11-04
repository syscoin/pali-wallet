// Actual leaf with a synthetic flow. This fixture does not perform recovery,
// authenticate a phrase, access storage, or establish native qualification.
import React, { useLayoutEffect, useState } from 'react';
import { registerRootComponent } from 'expo';
import { AppState, BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { NativeRecoveryFlow } from '../../src/custody/recoveryFlow';
import type { RecoveryInventory } from '../../src/custody/recoveryInventory';
import { NativeRecovery } from '../../src/screens/NativeRecovery';
import { Screen, Text } from '../../src/ui';

type Phase = ReturnType<NativeRecoveryFlow['getSnapshot']>['phase'];
const params = new URLSearchParams(window.location.search);
const listeners = new Map<string, Set<(state: string) => void>>();
const backs: (() => boolean)[] = [];
let appState = 'active';
Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => appState });
AppState.addEventListener = ((event: string, listener: (state: string) => void) => {
  if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener);
  return { remove() { listeners.get(event)!.delete(listener); } };
}) as typeof AppState.addEventListener;
BackHandler.addEventListener = ((_event: string, listener: () => boolean) => {
  backs.push(listener); return { remove() { const index = backs.indexOf(listener); if (index >= 0) backs.splice(index, 1); } };
}) as typeof BackHandler.addEventListener;
const inventory: RecoveryInventory = Object.freeze({
  status: 'needs-matching-phrase-verification', reason: null, backup: 'unconfirmed', privateNotes: 'not-supported',
  counts: Object.freeze({ hdAccounts: 3, importedKeys: 2, retiredHdAccounts: 4, retiredImportedAccounts: 1,
    journalRecords: 5, pendingTransactions: 1, terminalTransactions: 4, tokenEntries: 6,
    historySummaries: 7, cachedTransactions: 8, activityPreferences: 9 }),
});
const unavailable: RecoveryInventory = Object.freeze({ status: 'unavailable', reason: 'unsupported-record', backup: 'unknown', privateNotes: 'not-supported', counts: null });
const audit = { starts: 0, backs: 0, cancels: 0, submissions: 0, admissions: 0, commits: 0, admittedWordCounts: [] as number[] };
class FixtureFlow {
  private snapshot: ReturnType<NativeRecoveryFlow['getSnapshot']> = Object.freeze({ phase: 'reading', inventory: null, error: '', fieldErrors: {} });
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  publish(phase: Phase, error = '', fieldErrors: Record<string, string> = {}) {
    this.snapshot = Object.freeze({ phase, inventory: params.has('unavailable') ? unavailable : inventory, error, fieldErrors: Object.freeze(fieldErrors) });
    this.listeners.forEach((listener) => listener());
  }
  start() { audit.starts++; if (!params.has('reading')) queueMicrotask(() => { if (this.snapshot.phase === 'reading') this.read(); }); }
  read() { this.publish(params.has('unavailable') ? 'blocked' : 'scope', params.has('unavailable') ? 'Your saved wallet could not be verified for this recovery. Nothing has been reset.' : ''); }
  enter() { if (this.snapshot.phase === 'scope') this.publish('entry'); }
  back() { audit.backs++; if (this.snapshot.phase === 'entry') this.publish('scope'); else this.cancel(); }
  submit({ phrase, password, confirmation }: { phrase: string; password: string; confirmation: string }) {
    if (this.snapshot.phase !== 'entry') return false;
    audit.submissions++;
    const words = phrase.trim().split(/\s+/u).length;
    const errors: Record<string, string> = {};
    if (![12, 24].includes(words)) errors.phrase = 'Enter 12 or 24 words in their original order.';
    if ([...password].length < 12) errors.password = 'Use a password with at least 12 characters.';
    if (confirmation !== password) errors.confirmation = 'The new passwords do not match.';
    if (Object.keys(errors).length) { this.publish('entry', '', errors); return false; }
    audit.admissions++; audit.admittedWordCounts.push(words); this.publish('verifying'); return true;
  }
  verify(outcome: 'match' | 'wrong') {
    if (this.snapshot.phase !== 'verifying') return;
    this.publish(outcome === 'match' ? 'review' : 'entry', outcome === 'wrong' ? 'This recovery phrase does not match this wallet.' : '');
  }
  commit() { if (this.snapshot.phase === 'review') { audit.commits++; this.publish('committing'); } }
  cancel() {
    if (this.snapshot.phase === 'closed') return;
    audit.cancels++;
    this.publish('closed', this.snapshot.phase === 'committing' ? 'We could not confirm the password change. It may have completed. Unlock with your new password first; if it does not work, try your previous password.' : 'Recovery was cancelled');
  }
}
const flow = new FixtureFlow();
let unmount: () => void = () => undefined;
declare global { interface Window { __recoveryFixture: {
  snapshot(): ReturnType<NativeRecoveryFlow['getSnapshot']>; audit(): typeof audit; verify(outcome: 'match' | 'wrong'): void;
  lifecycle(state: 'active' | 'inactive' | 'background'): void; blur(): void; back(): void; unmount(): void; read(): void;
} } }
window.__recoveryFixture = {
  snapshot: () => flow.getSnapshot(), audit: () => JSON.parse(JSON.stringify(audit)), verify: (outcome) => flow.verify(outcome),
  lifecycle(state) { appState = state; for (const listener of [...listeners.get('change') ?? []]) listener(state); },
  blur() { for (const listener of [...listeners.get('blur') ?? []]) listener('blur'); },
  back() { [...backs].reverse().some((listener) => listener()); }, unmount() { unmount(); }, read: () => flow.read(),
};
function App() {
  const [shown, setShown] = useState(true);
  useLayoutEffect(() => { unmount = () => setShown(false); return () => { unmount = () => undefined; }; }, []);
  return <SafeAreaProvider>{shown ? <NativeRecovery flow={flow as unknown as NativeRecoveryFlow} /> : <Screen><Text>Recovery fixture closed</Text></Screen>}</SafeAreaProvider>;
}
registerRootComponent(App);
