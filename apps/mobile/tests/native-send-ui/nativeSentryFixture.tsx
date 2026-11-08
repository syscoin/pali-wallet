import React from 'react';
import { NativeSentryKeys } from '../../src/screens/NativeSentryKeys';
import type {
  NativeSentryKeyManagement,
  SentryKeyImportReview,
} from '../../src/custody/sentryKeyManagement';
import type { SentryKeySummary } from '../../../../source/wallet/sentryKeyVault';
import { parseSentryKeyBatch } from '../../../../source/utils/sentry/importBatch';
import { normalizeSentryServiceSettings } from '../../../../source/shared/sentrySettings';

// Public presentation fixture. Key derivation, SQL and native crypto are absent.
const calls: { method: string; count?: number }[] = [];
const copied: string[] = [];
let clipboard = '';
let review: SentryKeyImportReview | undefined;
let saved: readonly SentryKeySummary[] = [];
let check = () => undefined;
const owner = new AbortController();
let settings = { serviceUrl: 'https://sysnode.info', maxFeeSatoshis: '100000' };
const settingsHold = new URLSearchParams(location.search).get('settingsHold');
let heldSettingsStage: string | undefined;
let releaseSettings: (() => void) | undefined;
let pendingSettings = 0;
async function holdSettings(stage: string) {
  if (settingsHold !== stage) return;
  heldSettingsStage = stage;
  await new Promise<void>((resolve) => {
    releaseSettings = resolve;
  });
  heldSettingsStage = undefined;
}
const manager: NativeSentryKeyManagement = {
  async getSettings(guard) {
    pendingSettings++;
    try {
      check();
      guard();
      await holdSettings('read');
      check();
      guard();
      return settings;
    } finally {
      pendingSettings--;
    }
  },
  async saveSettings(input, password, guard) {
    pendingSettings++;
    try {
      check();
      guard();
      await holdSettings('auth');
      check();
      guard();
      if (password !== 'Fixture password 1!')
        throw new Error('Invalid fixture confirmation');
      await holdSettings('write');
      check();
      guard();
      settings = normalizeSentryServiceSettings(input);
      calls.push({ method: 'saveSettings' });
      return settings;
    } finally {
      pendingSettings--;
    }
  },
  async list() {
    check();
    return saved;
  },
  async prepareImport(input, role, scheme) {
    check();
    if (pendingSettings) throw new Error('BUSY');
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
      heldSettingsStage(): string | undefined;
      pendingSettings(): number;
      releaseSettings(): void;
    };
  }
}
window.__nativeSentryFixture = {
  calls: () => calls,
  setClipboard: (value) => {
    clipboard = value;
  },
  copied: () => copied,
  heldSettingsStage: () => heldSettingsStage,
  pendingSettings: () => pendingSettings,
  releaseSettings: () => releaseSettings?.(),
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
