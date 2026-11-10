import { unsignedTransferBytes } from '../../src/custody/evmFeeContracts.ts';
import { nativeOperationAuthentication } from '../../src/platform/operationAuthentication';
import { isOperationAuthenticationCancellation } from '../../src/core/operationAuthentication';
import { createTestOperationAuthorizer } from '../fixtures/operationAuthorization.ts';
import { activityFetch } from './utxoActivityFixture';
import { createNativeUtxoActivity } from '../../src/custody/utxoActivity';
import { createUtxoActivityReader } from '../../src/core/utxoActivity';
import { createUtxoBalanceReader } from '../../src/core/utxoBalanceReader.ts';
import { getUtxoNetwork, UTXO_NETWORKS } from '../../src/core/utxoNetworks.ts';
import { custodyIdle, securityPreferences } from './security';
// Actual custody/transfer controllers, with deterministic in-memory runtime ports.
import { NativeCustodyAuthority } from '../../src/custody/authority';
import { NativeConnectionsController } from '../../src/connections/controller';
import { SeedBackupFlow } from '../../src/custody/seedBackup';
import { HdKeyExportFlow, type NativeHdKeyExportRuntime } from '../../src/custody/hdKeyExport';
import { bindNativePrivateAuthentication, bindNativePrivateAuthenticationChild, withNativePrivateAuthentication, type NativePrivateAuthentication, type NativePrivateAuthenticationScope } from '../../src/custody/privateAuthentication';
import { KeyringRuntimeError, type KeyringRuntime } from '../../src/custody/keyringRuntime';
import { NativeTransfers, type NativeTransferRuntime } from '../../src/custody/transfers';
import { NativeTransferRpc } from '../../src/custody/transferRpc';
import { createBalanceReader } from '../../src/platformRpc';
import { importedKeyIdentity, normalizeImportedKey, type NativeImportView, type NativeUtxoImportDraft } from '../../src/custody/importedAccounts';
import { NativeActivity } from '../../src/activity/nativeActivity';
import { NativeTokens } from '../../src/portfolio/nativeTokens';
import type { NativeTokenRuntime } from '../../src/portfolio/nativeTokens';
import { NativeTokenRegistry } from '../../src/portfolio/tokenRegistry';
import type { KeyringStoragePort } from '../../src/storage/types';
import { DeviceUnlockPrompt } from '../../src/platform/deviceUnlockPrompt';
import { AppState } from 'react-native';
import type { NativeAccountView } from '../../src/custody/accounts';
import type { NativeWalletCatalogueSnapshot } from '../../src/custody/walletCatalogue';
import type { CustodyRuntime, NativeOperationCredential } from '../../src/custody/types';
import { getNativeNetwork, NATIVE_NETWORKS } from '../../src/custody/networkContext';
import { ADDRESS, SECOND, audit, events, unlockGate, signGate, keyReadGate, activityResetGate, PUBLIC_TEST_KEY, keyFailure, importGate, importFailure } from './state';
import { recoveryAudit, recoveryGate } from './recoveryState';
import type { RecoveryInventory } from '../../src/custody/recoveryInventory';
import type { NativeNoteInventory, NativeSavedNote } from '../../src/custody/noteBackupRuntime';
import { createWalletRemovalFixture, fixtureWalletPresent, recreateFixtureWallet, removalFixtureEnabled } from './walletRemovalFixture';
import { sysxSendFixture } from './sysxSendFixture';
import { BITCOIN_BIP84_ADDRESS, BITCOIN_BIP84_KEY, BITCOIN_WIF_ADDRESS, BITCOIN_WIF_KEY } from './utxoImportVectors';

const idleTrezorSnapshot = Object.freeze({
  phase: 'idle' as const, operation: null, networkLabel: '', accountLabel: '', address: null, signer: null, error: null,
});

const noteFixtureEnabled = new URLSearchParams(window.location.search).has('private-note-fixture');
const recorded = Date.UTC(2024, 5, 15);
const noteResults = {
  empty: [],
  saved: [
    { amount: '1', createdAt: recorded, reconciliation: 'restored-note' },
    { amount: '10', createdAt: recorded, reconciliation: 'withdrawal-history' },
    { amount: '0.1', createdAt: recorded },
  ],
  twins: Array.from({ length: 2 }, () => ({ amount: '1', createdAt: recorded })),
  paged: Array.from({ length: 21 }, () => ({ amount: '1', createdAt: recorded })),
  stale: [{ amount: '100', createdAt: recorded }],
} satisfies Record<string, readonly NativeSavedNote[]>;
type NoteResult = keyof typeof noteResults | 'error';
let nextNoteRead: { result: NoteResult; held: boolean } = { result: 'empty', held: false };
let releaseNoteRead: (() => void) | undefined;
let noteReads = 0, noteSettled = 0, noteRevoked = 0, fixtureRpcCalls = 0;
let holdReveal = false, releaseReveal: (() => void) | undefined;
const revealAttempts: number[] = [];
let revealSettled = 0, revealRevoked = 0;
export const noteInventoryFixture = {
  next(result: NoteResult, held = false) { nextNoteRead = { result, held }; },
  release() { const release = releaseNoteRead; releaseNoteRead = undefined; release?.(); },
  audit() { return { reads: noteReads, settled: noteSettled, revoked: noteRevoked }; },
  holdReveal() { holdReveal = true; },
  releaseReveal() { const release = releaseReveal; releaseReveal = undefined; release?.(); },
  revealAudit() { return { attempts: [...revealAttempts], settled: revealSettled, revoked: revealRevoked }; },
  rpcCalls() { return fixtureRpcCalls; },
  lockAuthority() {
    if (!latestAuthority) throw Error('No opened native authority');
    latestAuthority.lock();
  },
};
async function readFixtureNoteInventory(check: () => void,
  authenticate: (scope: NativePrivateAuthenticationScope, guard: () => void) => Promise<void>): Promise<NativeNoteInventory> {
  check();
  const { result, held } = nextNoteRead;
  nextNoteRead = { result: 'empty', held: false };
  noteReads++;
  if (held) await new Promise<void>((resolve) => { releaseNoteRead = resolve; });
  // Deliberately finish after a refused guard to also exercise the screen's
  // final ownership check, independently of the production runtime.
  try { check(); } catch { noteRevoked++; }
  noteSettled++;
  if (result === 'error') throw Error('Synthetic private storage diagnostic');
  const notes = Object.freeze(noteResults[result].map((note) => Object.freeze({ ...note })));
  return Object.freeze<NativeNoteInventory>({
    notes,
    async revealNote(note, checkAttempt, authentication) {
      check();
      checkAttempt();
      const index = notes.indexOf(note);
      if (index < 0) throw Error('Unexpected fixture selection');
      revealAttempts.push(index + 1);
      await authenticate(authentication, checkAttempt);
      if (holdReveal) {
        holdReveal = false;
        await new Promise<void>((resolve) => { releaseReveal = resolve; });
      }
      // Let a stale synthetic result cross the fake adapter to independently
      // check publication by the real screen after a refused ownership guard.
      try { check(); checkAttempt(); } catch { revealRevoked++; }
      revealSettled++;
      const bytes = (index + 1).toString(16).padStart(2, '0').repeat(62);
      return `tornado-eth-${note.amount}-1-0x${bytes}`;
    },
  });
}

const wifFixtureEnabled = new URLSearchParams(window.location.search).has('wif-fixture');
const visualReviewEnabled = new URLSearchParams(window.location.search).get('visual-review') === '1';
let visualWalletPresent = !(visualReviewEnabled && new URLSearchParams(window.location.search).get('native-empty') === '1');
let visualDeviceUnlockEnabled = visualReviewEnabled && new URLSearchParams(window.location.search).get('device-unlock') === '1';
const needsInitialBackup = new URLSearchParams(window.location.search).has('backup-required');
let backupConfirmed = visualWalletPresent && !needsInitialBackup;
const publicBackupWords = Object.freeze([...Array<string>(11).fill('abandon'), 'about']);
const fingerprint = '1'.repeat(64);
export const visualReviewFixture = Object.freeze({
  enabled: visualReviewEnabled,
  label: 'Simulated wallet and device authentication. No real keys or OS biometric prompt.',
  password: '123456',
  phrase: publicBackupWords.join(' '),
  state: () => ({ present: visualWalletPresent, deviceUnlockEnabled: visualDeviceUnlockEnabled, backupConfirmed }),
});
const visualTokenValues = new Map<string, unknown>();
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const visualTokenStorage: KeyringStoragePort = {
  async get(key) { return structuredClone(visualTokenValues.get(key)); },
  async set(key, value) { visualTokenValues.set(key, structuredClone(value)); },
  async deleteItem(key) { visualTokenValues.delete(key); },
  async createManyIfAbsent(items, guard) {
    if (Object.keys(items).some(key => visualTokenValues.has(key))) return false;
    guard?.();
    for (const [key, value] of Object.entries(items)) visualTokenValues.set(key, structuredClone(value));
    return true;
  },
  async compareAndSet(key, expected, value, removeIfEqual, guard) {
    if (!sameValue(visualTokenValues.get(key), expected) || Object.entries(removeIfEqual ?? {}).some(([name, before]) => !sameValue(visualTokenValues.get(name), before))) return false;
    guard?.(); visualTokenValues.set(key, structuredClone(value));
    for (const name of Object.keys(removeIfEqual ?? {})) visualTokenValues.delete(name);
    return true;
  },
  async compareAndSetMany(changes, guard) {
    if (changes.some(change => !sameValue(visualTokenValues.get(change.key), change.expected))) return false;
    guard();
    for (const change of changes) {
      if (change.value === undefined) visualTokenValues.delete(change.key);
      else visualTokenValues.set(change.key, structuredClone(change.value));
    }
    return true;
  },
};

let catalogue: NativeWalletCatalogueSnapshot = Object.freeze<NativeWalletCatalogueSnapshot>({
  revision: 0, networks: NATIVE_NETWORKS, utxoNetworks: UTXO_NETWORKS,
  active: wifFixtureEnabled ? { accountId: 'hd:0:0', networkId: 'bitcoin' } : { accountId: 'hd:60:0', networkId: 'ethereum' },
  accounts: wifFixtureEnabled ? [
    { id: 'hd:0:0', type: 'HDAccount', index: 0, slip44: 0, label: 'Account 1', address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' },
  ] : [
    { id: 'hd:60:0', type: 'HDAccount', index: 0, slip44: 60, label: 'Account 1', address: ADDRESS },
    ...(needsInitialBackup ? [] : [{ id: 'hd:60:1', type: 'HDAccount' as const, index: 1, slip44: 60 as const, label: 'Account 2', address: SECOND }]),
    ...(new URLSearchParams(window.location.search).has('account-limit') ? Array.from({ length: 18 }, (_, index) => ({
      id: `hd:60:${index + 2}`, type: 'HDAccount' as const, index: index + 2, slip44: 60 as const, label: `Account ${index + 3}`, address: `0x${(index + 100).toString(16).padStart(40, '0')}`,
    })) : []),
  ],
});
function fixtureUtxoImport(input: NativeUtxoImportDraft) {
  if (!wifFixtureEnabled || catalogue.active.networkId !== 'bitcoin')
    throw new KeyringRuntimeError('INVALID_INPUT');
  if (input.privateKey === BITCOIN_WIF_KEY && input.utxoAddressType === 'p2pkh')
    return { address: BITCOIN_WIF_ADDRESS };
  if (input.privateKey === BITCOIN_BIP84_KEY && !Object.hasOwn(input, 'utxoAddressType'))
    return { address: BITCOIN_BIP84_ADDRESS, utxoExtended: true as const };
  throw new KeyringRuntimeError('INVALID_INPUT');
}
export let latestAuthority: NativeCustodyAuthority | null = null;
export let latestTransfers: NativeTransfers | null = null;
export const retiredAuthorities: NativeCustodyAuthority[] = [];
let sessionUnlocked = false;
let fixturePassword: string = visualReviewEnabled ? visualReviewFixture.password : '123456';
export function recreateRemovalWallet(accountId: 'hd:60:0' | 'hd:60:1') {
  if (!removalFixtureEnabled || fixtureWalletPresent || !catalogue.accounts.some(({ id }) => id === accountId))
    throw Error('Unexpected fixture wallet recreation');
  catalogue = Object.freeze({ ...catalogue, revision: catalogue.revision + 1, active: { ...catalogue.active, accountId } });
  recreateFixtureWallet();
}
// Match the pinned SDK allocator: removed slots are reusable within each bucket.
const nextAccountIndex = (type: 'HDAccount' | 'Imported') => {
  const used = new Set(catalogue.accounts.filter((account) => account.type === type).map((account) => account.index));
  let index = 0;
  while (used.has(index)) index++;
  return index;
};
const importedKeys = new Map<string, string>();
export function createNativeWalletControllers() {
  const authentication = visualReviewEnabled ? new DeviceUnlockPrompt({
    state: () => AppState.currentState ?? 'unknown',
    subscribe(listener) {
      const subscriptions = [
        AppState.addEventListener('change', state => listener(state)),
        AppState.addEventListener('blur', () => listener('blur')),
        AppState.addEventListener('focus', () => listener('focus')),
      ];
      return () => subscriptions.forEach(subscription => subscription.remove());
    },
  }) : undefined;
  const createVisualWallet = (password: string) => {
    if (!visualReviewEnabled || visualWalletPresent) throw Error('Fixture cannot create real wallets');
    fixturePassword = password; visualWalletPresent = true; backupConfirmed = false; sessionUnlocked = true;
    visualTokenValues.clear();
    catalogue = Object.freeze({ ...catalogue, revision: catalogue.revision + 1,
      active: { accountId: 'hd:60:0', networkId: 'ethereum' },
      accounts: [{ id: 'hd:60:0', type: 'HDAccount' as const, index: 0, slip44: 60, label: 'Account 1', address: ADDRESS }],
    });
  };
  const hdUtxoFixture = new URLSearchParams(window.location.search).has('hd-utxo-send');
  if (hdUtxoFixture)
    catalogue = Object.freeze({
      ...catalogue,
      active: { accountId: 'hd:0:0', networkId: 'bitcoin' },
      accounts: [{ id: 'hd:0:0', type: 'HDAccount' as const, index: 0, slip44: 0, label: 'Account 1',
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' }],
    });
  if (sysxSendFixture.enabled)
    catalogue = Object.freeze({
      ...catalogue,
      active: { accountId: 'hd:57:0', networkId: 'syscoin' },
      accounts: [
        { id: 'hd:57:0', type: 'HDAccount', index: 0, slip44: 57, label: 'Account 1', address: sysxSendFixture.owner },
        { id: 'hd:57:1', type: 'HDAccount', index: 1, slip44: 57, label: 'Account 2', address: sysxSendFixture.second },
        { id: 'hd:0:0', type: 'HDAccount', index: 0, slip44: 0, label: 'Account 1', address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' },
      ] as const,
    });
  const authenticateOperation = async (credential: NativeOperationCredential, check: () => void) => {
    check();
    if (credential.method === 'biometric') {
      if (!authentication || !visualDeviceUnlockEnabled) throw refused('DEVICE_UNLOCK_UNAVAILABLE');
      try { await authentication.run(async () => { await unlockGate(); check(); }); }
      catch (error) { check(); if (error instanceof Error && error.message === 'DEVICE_UNLOCK_UNAVAILABLE') throw refused('DEVICE_UNLOCK_UNAVAILABLE'); throw error; }
    } else {
      await unlockGate();
      if (credential.pin !== fixturePassword) throw refused('INVALID_CREDENTIAL');
    }
    check();
  };
  const credentialRefusals = new WeakSet<object>();
  const refused = (code: 'CANCELLED' | 'INVALID_CREDENTIAL' | 'DEVICE_UNLOCK_UNAVAILABLE' | 'AUTH_THROTTLED') => {
    const error = new KeyringRuntimeError(code); credentialRefusals.add(error); return error;
  };
  const requestFixtureCredential = async (binding: NativePrivateAuthentication, signal: AbortSignal, guard: () => void,
    purpose: 'secret-read' | 'account-change') => {
    try {
      await withNativePrivateAuthentication(binding, signal, () => { if (!sessionUnlocked) throw refused('CANCELLED'); }, proofSignal =>
        nativeOperationAuthentication.request({ id: crypto.randomUUID(), purpose,
          biometricsEnabled: !!authentication && visualDeviceUnlockEnabled }, proofSignal, guard, async (credential, check) => {
          try { await authenticateOperation(credential, check); return { accepted: true }; }
          catch (error) {
            check();
            if (error instanceof KeyringRuntimeError && credentialRefusals.has(error) &&
                (error.code === 'INVALID_CREDENTIAL' || error.code === 'DEVICE_UNLOCK_UNAVAILABLE' || error.code === 'AUTH_THROTTLED'))
              return { accepted: false, reason: error.code };
            throw error;
          }
        }));
    } catch (error) {
      if (isOperationAuthenticationCancellation(error)) throw refused('CANCELLED');
      throw error;
    }
  };
  const runtime: CustodyRuntime = {
    async previewPhrase(phrase, check) {
      check();
      if (!visualReviewEnabled || phrase !== visualReviewFixture.phrase) throw new Error('INVALID_INPUT');
      return [{ label: 'EVM account', address: ADDRESS }];
    },
    ...(authentication ? { deviceUnlock: {
      async status() { return { available: true, enabled: visualDeviceUnlockEnabled }; },
      async enroll(password, check) {
        check();
        if (!sessionUnlocked || password !== fixturePassword) return { authenticated: false };
        await authentication.run(unlockGate);
        check(); visualDeviceUnlockEnabled = true;
        return { authenticated: true };
      },
      async disable(password, check) {
        check();
        if (!sessionUnlocked || password !== fixturePassword) return { authenticated: false };
        visualDeviceUnlockEnabled = false;
        return { authenticated: true };
      },
      async unlock(check) {
        check();
        if (!visualWalletPresent || !visualDeviceUnlockEnabled || sessionUnlocked) return { authenticated: false };
        await authentication.run(unlockGate);
        check(); sessionUnlocked = true;
        return { authenticated: true };
      },
    } satisfies NonNullable<CustodyRuntime['deviceUnlock']> } : {}),
    security: {
      isAuthenticationRefusal: error => !!error && typeof error === 'object' && credentialRefusals.has(error),
      authenticateOperation,
      async authenticationStatus() { return { pinConfigured: true, biometricsAvailable: !!authentication, biometricsEnabled: visualDeviceUnlockEnabled }; },
      async changePin(current, next, check) { check(); if (current !== fixturePassword || !/^\d{6}$/.test(next)) throw refused('INVALID_CREDENTIAL'); fixturePassword = next; check(); },
      async reauthenticateIdlePolicy(password, check) { check(); events.push('idle:auth'); await unlockGate(); if (password !== fixturePassword) throw new KeyringRuntimeError('INVALID_CREDENTIAL'); check(); },
    },
    networks: {
      getSelectedId: () => catalogue.active.networkId,
      reserve(id, expectedRevision) {
        const registration = NATIVE_NETWORKS.find((network) => network.id === id) ??
          (sysxSendFixture.enabled ? UTXO_NETWORKS.find((network) => network.id === id) : undefined);
        if (expectedRevision !== catalogue.revision || !registration) throw new KeyringRuntimeError('CANCELLED');
        return { cancel() {}, async execute(guard) {
          guard();
          const accountId = sysxSendFixture.enabled ? catalogue.accounts.find(({ slip44 }) =>
            slip44 === ('slip44' in registration ? registration.slip44 : 60))?.id : catalogue.active.accountId;
          if (!accountId) throw new KeyringRuntimeError('INVALID_INPUT');
          const address = catalogue.accounts.find(account => account.id === accountId)?.address;
          if (!address) throw new KeyringRuntimeError('INVALID_INPUT');
          catalogue = Object.freeze({ ...catalogue, revision: catalogue.revision + 1, active: { accountId, networkId: registration.id } });
          guard();
          const assertCurrent = () => { guard(); if (catalogue.revision !== expectedRevision + 1 || catalogue.active.accountId !== accountId || catalogue.active.networkId !== registration.id) throw new KeyringRuntimeError('CANCELLED'); };
          return Object.freeze({ target: registration, sourceCatalogueRevision: expectedRevision,
            selection: Object.freeze({ accountId, address, networkId: registration.id }), assertCurrent });
        } };
      },
    },
    accounts: {
      isAuthenticationRefusal: error => !!error && typeof error === 'object' && credentialRefusals.has(error),
      supported: () => true,
      getSnapshot: () => catalogue,
      reserve(request, expectedRevision) {
        if (expectedRevision !== catalogue.revision) throw new KeyringRuntimeError('CANCELLED');
        const cancellation = new AbortController();
        return {
          cancel() { cancellation.abort(); },
          async execute(check) {
            const guard = () => { check(); if (cancellation.signal.aborted) throw refused('CANCELLED'); };
            guard();
            if (request.kind === 'create' || request.kind === 'remove' || request.kind === 'create-smart') {
              try {
                await nativeOperationAuthentication.request({ id: crypto.randomUUID(), purpose: 'account-change', biometricsEnabled: !!authentication && visualDeviceUnlockEnabled }, cancellation.signal, guard, async (credential, assertAttemptCurrent) => {
                  try { await authenticateOperation(credential, assertAttemptCurrent); return { accepted: true }; }
                  catch (error) {
                    assertAttemptCurrent();
                    if (error instanceof Error && (error.message === 'INVALID_CREDENTIAL' || error.message === 'DEVICE_UNLOCK_UNAVAILABLE')) return { accepted: false, reason: error.message };
                    throw error;
                  }
                });
              } catch (error) {
                guard();
                if (isOperationAuthenticationCancellation(error)) throw refused('CANCELLED');
                if (error instanceof Error && (error.message === 'INVALID_CREDENTIAL' || error.message === 'DEVICE_UNLOCK_UNAVAILABLE')) throw refused(error.message);
                throw error;
              }
              guard();
            }
            let active = catalogue.active.accountId;
            let items = [...catalogue.accounts];
            if (request.kind === 'create') {
              const index = nextAccountIndex('HDAccount');
              const account = { id: `hd:60:${index}`, type: 'HDAccount' as const, index, slip44: 60 as const, label: request.label,
                address: index === 1 ? SECOND : '0x2222222222222222222222222222222222222222' };
              items.push(account); active = account.id;
            } else {
              const account = items.find((candidate) => candidate.id === ('id' in request ? request.id : ''));
              if (!account) throw new KeyringRuntimeError('INVALID_INPUT');
              if (request.kind === 'select') active = account.id;
              else if (request.kind === 'rename') items = items.map((item) => item.id === account.id ? { ...item, label: request.label } : item);
              else if (request.kind === 'remove') {
                if (account.id === active || account.type === 'HDAccount' && account.index === 0) throw new KeyringRuntimeError('ACCOUNT_NOT_REMOVABLE');
                items = items.filter((item) => item.id !== account.id); importedKeys.delete(account.id);
              } else throw new KeyringRuntimeError('INVALID_INPUT');
            }
            catalogue = Object.freeze({ ...catalogue, accounts: items, revision: catalogue.revision + 1, active: { ...catalogue.active, accountId: active } });
            guard();
          },
        };
      },
    },
    imports: {
      async previewUtxo(input, expectedRevision, check) {
        check();
        if (expectedRevision !== catalogue.revision) throw new KeyringRuntimeError('CANCELLED');
        const fixture = fixtureUtxoImport(input);
        if (catalogue.accounts.some(({ address }) => address === fixture.address))
          throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
        return fixture.address;
      },
      reserve(input, expectedRevision, signal, binding) {
        if (expectedRevision !== catalogue.revision) throw new KeyringRuntimeError('CANCELLED');
        const index = nextAccountIndex('Imported');
        const fixture = wifFixtureEnabled ? fixtureUtxoImport(input) : undefined;
        const key = fixture ? input.privateKey : normalizeImportedKey(input.privateKey);
        const identity = fixture
          ? { id: `imported:0:${index}`, index, ...fixture }
          : importedKeyIdentity(key, index);
        if (input.expectedAddress !== identity.address || !input.label.trim()) throw new KeyringRuntimeError('INVALID_INPUT');
        if (catalogue.accounts.some((account) => account.address === identity.address)) throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
        let cancelled = false;
        const check = (guard: () => void) => {
          if (cancelled || signal.aborted) throw new KeyringRuntimeError('CANCELLED');
          guard();
        };
        return { cancel() { cancelled = true; }, async execute(guard) {
          check(guard); audit.importAttempts++; events.push('import:start');
          await requestFixtureCredential(binding, signal, () => check(guard), 'account-change');
          check(guard);
          await importGate();
          check(guard);
          if (importFailure) throw new KeyringRuntimeError(importFailure);
          importedKeys.set(identity.id, key);
          const account = { id: identity.id, type: 'Imported' as const, index: identity.index, slip44: fixture ? 0 : 60, label: input.label, address: identity.address,
            ...(fixture?.utxoExtended && { utxoExtended: true as const }) };
          catalogue = Object.freeze({ ...catalogue, accounts: [...catalogue.accounts, account], revision: catalogue.revision + 1,
            active: { ...catalogue.active, accountId: account.id } });
          audit.imports++; events.push('import:committed'); guard();
        } };
      },
    },
    session: {
      async createWallet(password) { createVisualWallet(password); },
      async importWallet(phrase, password) {
        if (!visualReviewEnabled || phrase.trim().toLowerCase().split(/\s+/).join(' ') !== publicBackupWords.join(' ')) throw Error('Fixture cannot import real wallets');
        createVisualWallet(password);
      },
      async unlock(password) {
        audit.unlocks++; events.push('unlock:start');
        await unlockGate();
        sessionUnlocked = password === fixturePassword;
        events.push('unlock:finish');
        return { authenticated: sessionUnlocked };
      },
      async readSelectedAddress() {
        if (!sessionUnlocked) throw Error('Locked fixture session');
        return catalogue.accounts.find((account) => account.id === catalogue.active.accountId)!.address;
      },
      async lock() { sessionUnlocked = false; events.push('lock'); },
    },
    storage: {
      async readState() {
        if (visualReviewEnabled ? !visualWalletPresent : !fixtureWalletPresent) return { presence: 'empty', backup: 'unconfirmed' };
        return { presence: 'existing', backup: backupConfirmed ? 'confirmed' : 'unconfirmed' };
      },
      ...(removalFixtureEnabled ? { async retireForRemoval(operation: () => Promise<void>) { await operation(); } } : {}),
      async close() { audit.closed++; events.push('close'); },
    },
  };
  const authority = new NativeCustodyAuthority({ open: async () => runtime }, { preferences: securityPreferences, assertActive: custodyIdle.captureGuard() });
  const unavailableConnection = async (): Promise<never> => {
    throw Error('Synthetic watch fixture has no WalletConnect transport');
  };
  const connections = new NativeConnectionsController({
    source: authority,
    activateAccount: (id, revision, guard) => authority.selectConnectionAccount(id, revision, guard),
    preparePlatform: unavailableConnection,
    openHost: unavailableConnection,
    openExternalUrl: unavailableConnection,
    checkSite: unavailableConnection,
    checkAddress: unavailableConnection,
    projectId: '0'.repeat(32),
    metadata: { name: 'Watch UI fixture', description: '', url: 'https://fixture.invalid', icons: [] },
  });
  latestAuthority = authority;
  retiredAuthorities.push(authority);
  const operationAuthorization = createTestOperationAuthorizer(authenticateOperation, unsignedTransferBytes);
  const transferRuntime: NativeTransferRuntime = {
    isAuthenticationRefusal: error => !!error && typeof error === 'object' && credentialRefusals.has(error),
    authorizeOperation: operationAuthorization.authorizeOperation,
    releaseOperationAuthorization: operationAuthorization.releaseOperationAuthorization,
    authenticateOperation,
    replay() { throw Error("Fixture has no retained signed transactions"); },
    async submit(_raw, _hash, guard) { guard(); throw Error('Fixture does not submit signatures'); },
    async journal(guard) { guard(); return {
      async planAutomaticNonce({ latest, pending }) { guard(); return { kind: 'ready', nonce: Math.max(latest, pending), balanceState: 'pending', nativeReservations: { canonical: 0n, pending: 0n } }; },
      async assertSpendingNonce() { guard(); }, async load() { guard(); return null; },
      async saveSigned() { throw Error('Fixture does not submit signatures'); },
      async transition() { throw Error('Fixture does not submit signatures'); } }; },
    assertUnlocked(guard) { guard(); },
    async sign(_transaction, authority) { operationAuthorization.consume(authority.authorization, _transaction, authority.assertCurrent); audit.signs++; events.push('sign:start'); await signGate(); authority.assertCurrent(); events.push('sign:finish'); throw Error('Fixture does not submit signatures'); },
  };
  const transfers = new NativeTransfers(authority, () => transferRuntime, { rpc: new NativeTransferRpc({ networkId: 'ethereum', fetch: fixtureFetch }) });
  latestTransfers = transfers;
  const visualTokenRegistry = new NativeTokenRegistry(visualTokenStorage);
  const tokenScope = () => {
    const state = authority.getSnapshot(), selected = catalogue.accounts.find(account => account.id === catalogue.active.accountId);
    if (state.phase !== 'ready' || !state.account || !selected || !sessionUnlocked) throw Error('Inactive visual token scope');
    const network = getNativeNetwork(state.account.network, catalogue.networks);
    return { walletFingerprint: fingerprint, accountId: selected.id, address: state.account.address,
      network: network.id, chainId: network.chainId, registrationHash: network.registrationHash };
  };
  const visualTokenRuntime: NativeTokenRuntime = {
    load: check => visualTokenRegistry.load(tokenScope(), check),
    add: (revision, metadata, check) => visualTokenRegistry.add(tokenScope(), revision, metadata, check),
    remove: (revision, address, check) => visualTokenRegistry.remove(tokenScope(), revision, address, check),
  };
  const tokens = new NativeTokens(authority, () => visualReviewEnabled ? visualTokenRuntime : undefined);
  const activity = new NativeActivity(authority, () => undefined);
  const activityRuntime: Pick<KeyringRuntime, 'withUtxoActivityRead'> = {
    async withUtxoActivityRead(expected, signal, check, assertView, read) {
      const current = () => {
        check();
        assertView();
        if (!sessionUnlocked || signal.aborted) throw Error('Inactive fixture view');
      };
      current();
      const result = await read({ context: expected, identifier: expected.address,
        registration: getUtxoNetwork(expected.networkId), isAccount: false, assertCurrent: check }, signal, current);
      current();
      return result;
    },
  };
  const utxoActivity = hdUtxoFixture ? createNativeUtxoActivity(authority, () => activityRuntime, createUtxoActivityReader({ async fetch(url, init) {
    const response = await activityFetch(url, init);
    if (!response) throw Error('Unexpected UTXO Activity route');
    return response;
  } })) : undefined;
  const accounts: NativeAccountView = {
    getSnapshot: () => authority.getCatalogue(), getContextRevision: () => authority.getSnapshot().revision,
    subscribe: (listener) => authority.subscribe(() => listener()),
    execute: (...args) => authority.manageAccounts(...args), cancel: () => authority.cancelAccountOperation(),
  };
  const backupRuntime: KeyringRuntime['backup'] = {
    isAuthenticationRefusal: error => !!error && typeof error === 'object' && credentialRefusals.has(error),
    async readPhrase(credential) {
      const password = typeof credential === 'string' ? credential : credential.method === 'pin' ? credential.pin : visualDeviceUnlockEnabled ? fixturePassword : '';
      if (!sessionUnlocked) throw Error('Locked fixture session');
      if (password !== (visualReviewEnabled ? fixturePassword : '123456')) throw refused('INVALID_CREDENTIAL');
      return publicBackupWords;
    },
    async fingerprint() {
      if (!sessionUnlocked) throw Error('Locked fixture session');
      return fingerprint;
    },
    async confirm(expected) {
      if (!sessionUnlocked || expected !== fingerprint) throw Error('Invalid fixture backup confirmation');
      backupConfirmed = true; events.push('backup:confirmed');
    },
  };
  const backup = new SeedBackupFlow(authority, () => backupRuntime);
  backup.onClear(() => events.push('backup:cancel'));
  const keyRuntime: NativeHdKeyExportRuntime = {
    isAuthenticationRefusal: error => !!error && typeof error === 'object' && credentialRefusals.has(error),
    async readSelected(scope, signal, guard, scopeAuthentication) {
      guard();
      if (!sessionUnlocked) throw Error('Locked fixture session');
      audit.keyAttempts++;
      events.push('key:start');
      await requestFixtureCredential(bindNativePrivateAuthentication(scopeAuthentication, {
        assertCurrent: () => { if (!sessionUnlocked || signal.aborted) throw refused('CANCELLED'); }, isPromptActive: () => authentication?.isActive() === true,
      }), signal, guard, 'secret-read');
      audit.keyReads++;
      await keyReadGate();
      if (keyFailure) throw refused(keyFailure);
      guard();
      events.push('key:finish');
      if (wifFixtureEnabled && scope.accountId.startsWith('hd:0:')) return `zprv${'A'.repeat(107)}`;
      return importedKeys.get(scope.accountId) ?? PUBLIC_TEST_KEY;
    },
  };
  const keyExport = new HdKeyExportFlow(authority, () => keyRuntime);
  keyExport.onClear(() => events.push('key:cancel'));
  const imports: NativeImportView = { previewUtxo: (...args) => authority.previewUtxoImport(...args),
    submit: (input, revision, catalogueRevision, signal, scope) => authority.importAccount(input, revision, catalogueRevision, signal,
      bindNativePrivateAuthentication(scope, { assertCurrent: () => { if (signal.aborted) throw refused('CANCELLED'); },
        isPromptActive: () => authentication?.isActive() === true })),
    cancel: () => authority.cancelAccountOperation() };
  return { authority, connections: connections.view, keyExport, imports,
    ...(authentication ? { authentication } : {}),
    trezor: {background() {}, async cancel() {}, subscribe: () => () => undefined,
      getSnapshot: () => idleTrezorSnapshot,
      async startImport() {throw Error('Trezor is outside this fixture');},
      async resumeImport() {throw Error('Trezor is outside this fixture');},
      async resumeSend(): Promise<never> {throw Error('Trezor is outside this fixture');}},
    canManageGuardianPolicy: () => false,
    canSignSmartAccount: () => false, canManageSlhDsa: () => false,
    canManageSmartAccountModules: () => false,
    async openSmartAccountModules() { throw Error('Modules are outside this fixture'); },
    async openSlhDsaManagement() { throw Error('SLH is outside this fixture'); },
    canUseWalletAuthenticator: () => false,
    async resetActivity(check: () => void) {
      check();
      events.push('activity:reset:start');
      activity.invalidate();
      await activityResetGate();
      check();
      events.push('activity:reset:done');
      await activity.refresh();
    },
    ...(wifFixtureEnabled ? { async openUtxoSend() { throw Error('Synthetic UI fixture does not sign'); } } : {}),
    balanceReader: {
      ...createBalanceReader({ fetch: fixtureFetch }),
      ...(sysxSendFixture.enabled ? { readUtxoBalance: createUtxoBalanceReader({ fetch: sysxSendFixture.fetch }).readBalance } : {}),
    }, transfers: transfers.view, tokens: tokens.view, activity, utxoActivity, accounts, backup,
    ...(removalFixtureEnabled ? { removal: createWalletRemovalFixture(authority, { getSnapshot: () => sessionUnlocked ? catalogue : null }, (password) => password === fixturePassword) } : {}),
    ...(noteFixtureEnabled ? {
      readNoteInventory: (check: () => void, scope: NativePrivateAuthenticationScope) => {
        const parent = bindNativePrivateAuthentication(scope, { assertCurrent: () => { if (!sessionUnlocked) throw refused('CANCELLED'); }, isPromptActive: () => authentication?.isActive() === true });
        return readFixtureNoteInventory(check, (child, guard) => requestFixtureCredential(
          bindNativePrivateAuthenticationChild(parent, child), new AbortController().signal, guard, 'secret-read'));
      },
      async openNoteCapacity(check: () => void) {
        check();
        return {
          async getCapacity() { check(); return { capacity: 128 as const, noteCount: 0, bundleLimitBytes: 4 * 1024 * 1024, storedBytes: 0 }; },
          async setCapacity() { throw Error('Fixture does not change note capacity'); },
        };
      },
    } : {}),
    async readRecoveryInventory(): Promise<RecoveryInventory> {
      return { status: 'needs-matching-phrase-verification', reason: null, backup: backupConfirmed ? 'confirmed' : 'unconfirmed', privateNotes: 'not-supported',
        counts: { hdAccounts: catalogue.accounts.filter((a) => a.type === 'HDAccount').length, importedKeys: importedKeys.size, retainedSignedTransactions: 0, tokenEntries: 0, historySummaries: 0, cachedTransactions: 0, activityPreferences: 0 } };
    },
    ...(sysxSendFixture.enabled ? { async openUtxoSend(check: () => void) { return sysxSendFixture.open(check); } } : {}),
    ...(hdUtxoFixture ? { async openUtxoSend(check: () => void) {
      check();
      const unused = async () => { throw Error('Synthetic route fixture does not sign'); };
      return { cancel() {}, async list() { return []; }, prepare: unused, prepareRetry: unused, confirm: unused, check: unused };
    } } : {}),
    disposeTokens: () => tokens.dispose(), disposeTransfers: () => transfers.dispose(),
    async disposeConnections() { await connections.dispose(); events.push('connections:dispose'); } };
}
/** This adapter tests real UI ownership, not the already tested storage protocol. */
export function createNativeRecoveryCoordinator(controllers: ReturnType<typeof createNativeWalletControllers>) {
  recoveryAudit.created++;
  const proof = Object.freeze({}); let cancelled = false, replacement = '', pending: Promise<unknown> = Promise.resolve();
  let assertPrepared: (() => void) | undefined;
  return {
    prepare(phrase: string, guard: () => void) {
      recoveryAudit.prepared++; cancelled = false;
      pending = (async () => {
        guard(); await controllers.authority.dispose(); await recoveryGate('prepare'); guard();
        if (cancelled) throw Error('CANCELLED');
        if (phrase !== publicBackupWords.join(' ')) throw Error('WRONG_PHRASE');
        assertPrepared = guard; return proof;
      })(); return pending;
    },
    async setPin(value: unknown, pin: string) {
      if (value !== proof || cancelled || !assertPrepared || !/^\d{6}$/.test(pin)) throw Error('CANCELLED');
      assertPrepared(); replacement = pin;
    },
    commit(value: unknown) {
      pending = (async () => {
        if (value !== proof || cancelled || !/^\d{6}$/.test(replacement)) throw Error('CANCELLED');
        fixturePassword = replacement; replacement = ''; recoveryAudit.committed++;
        await recoveryGate('commit'); if (cancelled) throw Error('CANCELLED'); return 'committed-locked';
      })(); return pending;
    },
    cancel() { cancelled = true; replacement = ''; assertPrepared = undefined; },
    async dispose() { await pending.catch(() => undefined); await recoveryGate('dispose'); recoveryAudit.disposed++; },
  };
}
export const fixtureFetch: typeof fetch = async (_url, init) => {
  fixtureRpcCalls++;
  const request = JSON.parse(String(init?.body));
  let result: unknown;
  switch (request.method) {
    case 'eth_chainId': result = '0x1'; break;
    case 'eth_getBalance': result = '0x10000000000000000'; break;
    case 'eth_getTransactionCount': result = '0x0'; break;
    case 'eth_getBlockByNumber': result = { number: '0x20', hash: '0x' + '2'.repeat(64), gasLimit: '0x1c9c380', baseFeePerGas: '0x1' }; break;
    case 'eth_gasPrice': result = '0x3'; break;
    case 'eth_feeHistory': result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'], reward: [['0x1', '0x1', '0x1']] }; break;
    case 'eth_maxPriorityFeePerGas': result = '0x1'; break;
    case 'eth_estimateGas': result = '0x5208'; break;
    case 'eth_getTransactionReceipt': result = null; break;
    case 'eth_sendRawTransaction': audit.broadcasts++; throw Error('Fixture forbids broadcast');
    default: throw Error(`Unhandled synthetic RPC ${request.method}`);
  }
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'Content-Type': 'application/json' } });
};

export function fixtureCatalogue() { return catalogue; }
