// Synthetic public fixtures only. This module is never imported by production.
import type { AccountSelection } from '../../src/core/accountDirectory';
import type { PublicAccount } from '../../src/core/types';
import { createEvmWatchAccount } from '../../src/core/watchOnlyAuthority';
export const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
export const SECOND = '0x1111111111111111111111111111111111111111';
export const events: string[] = [];
export const publicShares: string[] = [];
export let watchBalanceMode: 'value' | 'zero' | 'error' = 'value';
export function setWatchBalanceMode(value: typeof watchBalanceMode) { watchBalanceMode = value; }
export const audit = { unlocks: 0, signs: 0, broadcasts: 0, closed: 0, keyReads: 0, keyAttempts: 0, importAttempts: 0, imports: 0, readFailures: 0, writes: 0 };
let pendingUnlock: (() => void) | null = null;
let pendingClose: (() => void) | null = null;
let delayClose = false;
export function setDelayClose(value: boolean) { delayClose = value; }
export async function closeGate() { if (delayClose) await new Promise<void>((resolve) => { pendingClose = resolve; }); }
export function releaseClose() { delayClose = false; pendingClose?.(); pendingClose = null; }
let pendingSign: (() => void) | null = null;
let pendingImport: (() => void) | null = null;
let pendingKeyRead: (() => void) | null = null;
let releaseActivityReset: (() => void) | null = null;
let delayActivityReset = false;
let activityResetFailure = false;
export function setDelayActivityReset(value: boolean) { delayActivityReset = value; }
export function failActivityReset() { activityResetFailure = true; }
export async function activityResetGate() {
  if (delayActivityReset) await new Promise<void>((resolve) => { releaseActivityReset = resolve; });
  if (activityResetFailure) { activityResetFailure = false; throw Error('Synthetic reset failure'); }
}
export function finishActivityReset() { delayActivityReset = false; releaseActivityReset?.(); releaseActivityReset = null; }
export const PUBLIC_TEST_KEY = `0x${"1".repeat(64)}`;
export let delayKeyRead = false;
export let delayImport = false;
export let importFailure: 'AUTH_THROTTLED' | null = null;
export function setImportFailure(value: typeof importFailure) { importFailure = value; }
export function setDelayImport(value: boolean) { delayImport = value; }
export async function importGate() { if (delayImport) await new Promise<void>((resolve) => { pendingImport = resolve; }); }
export function releaseImport() { delayImport = false; pendingImport?.(); pendingImport = null; }
export let keyFailure: 'AUTH_THROTTLED' | null = null;
export function setKeyFailure(value: typeof keyFailure) { keyFailure = value; }
export let delayUnlock = false;
export let delaySign = false;
export let failRead = new URLSearchParams(window.location.search).has('read-failure');
export function setReadFailure(value: boolean) { failRead = value; }
export function setDelayUnlock(value: boolean) { delayUnlock = value; }
export function setDelaySign(value: boolean) { delaySign = value; }
export function setDelayKeyRead(value: boolean) { delayKeyRead = value; }
export async function keyReadGate() { if (delayKeyRead) await new Promise<void>((resolve) => { pendingKeyRead = resolve; }); }
export function releaseKeyRead() { delayKeyRead = false; pendingKeyRead?.(); pendingKeyRead = null; }
export async function unlockGate() { if (delayUnlock) await new Promise<void>((resolve) => { pendingUnlock = resolve; }); }
export async function signGate() { if (delaySign) await new Promise<void>((resolve) => { pendingSign = resolve; }); }
export function releaseUnlock() { delayUnlock = false; pendingUnlock?.(); pendingUnlock = null; }
export function releaseSign() { delaySign = false; pendingSign?.(); pendingSign = null; }
const KEY = 'pali-public-watch-fixture-v1';
const SELECTION_KEY = 'pali-public-selection-fixture-v1';
export function readAccounts(): readonly PublicAccount[] {
  if (failRead) { audit.readFailures++; throw Error('Synthetic read failure'); }
  const raw = localStorage.getItem(KEY);
  if (raw) return JSON.parse(raw);
  const activityNetwork = new URLSearchParams(window.location.search).get('utxo-activity');
  if (activityNetwork === 'bitcoin' || activityNetwork === 'syscoin') return [{ id: 'public_1', name: 'Activity watch', addresses: { [activityNetwork]: activityNetwork === 'bitcoin' ? 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' : 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58' } }];
  return new URLSearchParams(window.location.search).has('empty') ? [] : [createEvmWatchAccount('public_1', 'Shared address watch', ADDRESS)];
}
export function writeAccounts(accounts: readonly PublicAccount[]) {
  audit.writes++;
  localStorage.setItem(KEY, JSON.stringify(accounts));
}
export function readSelection(): AccountSelection | null {
  return JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null');
}
export function writeSelection(selection: AccountSelection | null) { localStorage.setItem(SELECTION_KEY, JSON.stringify(selection)); }
