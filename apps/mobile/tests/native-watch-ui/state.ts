// Synthetic public fixtures only. This module is never imported by production.
import type { AccountSelection } from '../../src/core/accountDirectory';
import type { PublicAccount } from '../../src/core/types';
import { createEvmWatchAccount } from '../../src/core/watchOnlyAuthority';
export const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
export const SECOND = '0x1111111111111111111111111111111111111111';
export const events: string[] = [];
export const audit = { unlocks: 0, signs: 0, broadcasts: 0, closed: 0, readFailures: 0, writes: 0 };
let pendingUnlock: (() => void) | null = null;
let pendingSign: (() => void) | null = null;
export let delayUnlock = false;
export let delaySign = false;
export let failRead = new URLSearchParams(window.location.search).has('read-failure');
export function setReadFailure(value: boolean) { failRead = value; }
export function setDelayUnlock(value: boolean) { delayUnlock = value; }
export function setDelaySign(value: boolean) { delaySign = value; }
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
  return new URLSearchParams(window.location.search).has('empty') ? [] : [createEvmWatchAccount('public_1', 'Shared address watch', ADDRESS)];
}
export function writeAccounts(accounts: readonly PublicAccount[]) {
  audit.writes++;
  localStorage.setItem(KEY, JSON.stringify(accounts));
}
export function readSelection(): AccountSelection | null {
  return JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null');
}
export function writeSelection(selection: AccountSelection) { localStorage.setItem(SELECTION_KEY, JSON.stringify(selection)); }
