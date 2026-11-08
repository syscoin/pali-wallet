import React from 'react';
import { NativeSentryKeys } from '../../src/screens/NativeSentryKeys';
import type {
  NativeSentryKeyManagement,
  SentryKeyImportReview,
} from '../../src/custody/sentryKeyManagement';
import type { SentryKeySummary } from '../../../../source/wallet/sentryKeyVault';
import { parseSentryKeyBatch } from '../../../../source/utils/sentry/importBatch';

// Public presentation fixture. Key derivation, SQL and native crypto are absent.
const calls: { method: string; count?: number }[] = [];
const copied: string[] = [];
let clipboard = '';
let review: SentryKeyImportReview | undefined;
let saved: readonly SentryKeySummary[] = [];
let check = () => undefined;
const owner = new AbortController();
const manager: NativeSentryKeyManagement = {
  async list() {
    check();
    return saved;
  },
  async prepareImport(input, role, scheme) {
    check();
    const parsed = parseSentryKeyBatch(input, scheme);
    if (parsed.issues.length)
      throw Object.assign(new Error('Invalid import'), {
        code: 'INVALID_INPUT',
        issues: parsed.issues,
      });
    calls.push({ method: 'prepareImport', count: parsed.entries.length });
    return (review = Object.freeze({
      network: 'mainnet',
      expiresAt: performance.now() + 90000,
      keys: parsed.entries.map(({ label }, index) => ({
        label,
        role,
        scheme,
        publicKey: (index ? '48' : '39').repeat(
          scheme === 'bls-basic' ? 48 : 32
        ),
      })),
    }));
  },
  async confirmImport(current, password) {
    check();
    if (current !== review || password !== 'Fixture password 1!')
      throw new Error('Invalid fixture confirmation');
    calls.push({ method: 'confirmImport', count: current.keys.length });
    saved = current.keys.map((key, index) => ({
      ...key,
      id: `key-${index}`,
      network: 'mainnet',
    }));
    return saved;
  },
  async prepareRemoval(id) {
    check();
    const key = saved.find((entry) => entry.id === id);
    if (!key) throw new Error('Missing fixture key');
    return { key, expiresAt: performance.now() + 90000 };
  },
  async confirmRemoval(current, password, backedUp) {
    check();
    if (password !== 'Fixture password 1!' || !backedUp)
      throw new Error('Invalid fixture confirmation');
    saved = saved.filter((key) => key.id !== current.key.id);
    return { removedKeyId: current.key.id };
  },
  cancel() {
    review = undefined;
  },
  dispose() {
    owner.abort();
  },
};
declare global {
  interface Window {
    __nativeSentryFixture: {
      calls(): readonly { method: string; count?: number }[];
      setClipboard(value: string): void;
      copied(): readonly string[];
    };
  }
}
window.__nativeSentryFixture = {
  calls: () => calls,
  setClipboard: (value) => {
    clipboard = value;
  },
  copied: () => copied,
};
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: {
    readText: async () => clipboard,
    writeText: async (value: string) => {
      copied.push(value);
    },
  },
});
const open = async (_signal: AbortSignal, guard: () => void) => {
  check = () => {
    guard();
    if (owner.signal.aborted) throw new Error('CANCELLED');
  };
  check();
  return manager;
};
export function NativeSentryFixture() {
  return (
    <NativeSentryKeys
      networkLabel="Syscoin"
      open={open}
      onBack={() => calls.push({ method: 'close' })}
    />
  );
}
