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
import { HdKeyExportFlow } from '../../src/custody/hdKeyExport';
import { KeyringRuntimeError, type KeyringRuntime } from '../../src/custody/keyringRuntime';
import { NativeTransfers, type NativeTransferRuntime } from '../../src/custody/transfers';
import { NativeTransferRpc } from '../../src/custody/transferRpc';
import { createBalanceReader } from '../../src/platformRpc';
import { importedKeyIdentity, normalizeImportedKey, type NativeImportView, type NativeUtxoImportDraft } from '../../src/custody/importedAccounts';
import { NativeActivity } from '../../src/activity/nativeActivity';
import { NativeTokens } from '../../src/portfolio/nativeTokens';
import type { NativeAccountView } from '../../src/custody/accounts';
import type { NativeWalletCatalogueSnapshot } from '../../src/custody/walletCatalogue';
import type { CustodyRuntime } from '../../src/custody/types';
import { NATIVE_NETWORKS } from '../../src/custody/networkContext';
import { ADDRESS, SECOND, audit, events, unlockGate, signGate, keyReadGate, activityResetGate, PUBLIC_TEST_KEY, keyFailure, importGate, importFailure } from './state';
import { recoveryAudit, recoveryGate } from './recoveryState';
import type { RecoveryInventory } from '../../src/custody/recoveryInventory';
import type { NativeNoteInventory, NativeSavedNote } from '../../src/custody/noteBackupRuntime';
import { createWalletRemovalFixture, fixtureWalletPresent, recreateFixtureWallet, removalFixtureEnabled } from './walletRemovalFixture';
import { sysxSendFixture } from './sysxSendFixture';
import { BITCOIN_BIP84_ADDRESS, BITCOIN_BIP84_KEY, BITCOIN_WIF_ADDRESS, BITCOIN_WIF_KEY } from './utxoImportVectors';

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
async function readFixtureNoteInventory(check: () => void): Promise<NativeNoteInventory> {
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
    async revealNote(note, password, checkAttempt) {
      check();
      checkAttempt();
      const index = notes.indexOf(note);
      if (index < 0) throw Error('Unexpected fixture selection');
      revealAttempts.push(index + 1);
      if (holdReveal) {
        holdReveal = false;
        await new Promise<void>((resolve) => { releaseReveal = resolve; });
      }
      // Let a stale synthetic result cross the fake adapter to independently
      // check publication by the real screen after a refused ownership guard.
      try { check(); checkAttempt(); } catch { revealRevoked++; }
      revealSettled++;
      if (password !== fixturePassword) throw Error('Synthetic private authentication diagnostic');
      const bytes = (index + 1).toString(16).padStart(2, '0').repeat(62);
      return `tornado-eth-${note.amount}-1-0x${bytes}`;
    },
  });
}

const wifFixtureEnabled = new URLSearchParams(window.location.search).has('wif-fixture');
const needsInitialBackup = new URLSearchParams(window.location.search).has('backup-required');
let backupConfirmed = !needsInitialBackup;
const publicBackupWords = Object.freeze([...Array<string>(11).fill('abandon'), 'about']);
const fingerprint = '1'.repeat(64);

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
let fixturePassword = 'public-password';
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
  const runtime: CustodyRuntime = {
    security: { async reauthenticateIdlePolicy(password, check) { check(); events.push('idle:auth'); await unlockGate(); if (password !== fixturePassword) throw new KeyringRuntimeError('INVALID_CREDENTIAL'); check(); } },
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
          catalogue = Object.freeze({ ...catalogue, revision: catalogue.revision + 1, active: { accountId, networkId: registration.id } });
          guard();
        } };
      },
    },
    accounts: {
      supported: () => true,
      getSnapshot: () => catalogue,
      reserve(request, expectedRevision) {
        if (expectedRevision !== catalogue.revision) throw new KeyringRuntimeError('CANCELLED');
        return {
          cancel() {},
          async execute(guard) {
            guard();
            let active = catalogue.active.accountId;
            let items = [...catalogue.accounts];
            if (request.kind === 'create') {
              if (request.password !== 'public-password') throw new KeyringRuntimeError('INVALID_CREDENTIAL');
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
                if (request.password !== 'public-password') throw new KeyringRuntimeError('INVALID_CREDENTIAL');
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
      reserve(input, password, expectedRevision) {
        if (expectedRevision !== catalogue.revision) throw new KeyringRuntimeError('CANCELLED');
        const index = nextAccountIndex('Imported');
        const fixture = wifFixtureEnabled ? fixtureUtxoImport(input) : undefined;
        const key = fixture ? input.privateKey : normalizeImportedKey(input.privateKey);
        const identity = fixture
          ? { id: `imported:0:${index}`, index, ...fixture }
          : importedKeyIdentity(key, index);
        if (input.expectedAddress !== identity.address || !input.label.trim()) throw new KeyringRuntimeError('INVALID_INPUT');
        if (catalogue.accounts.some((account) => account.address === identity.address)) throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
        return { cancel() {}, async execute(guard) {
          guard(); audit.importAttempts++; events.push('import:start');
          await importGate();
          if (importFailure) throw new KeyringRuntimeError(importFailure);
          if (password !== 'public-password') throw new KeyringRuntimeError('INVALID_CREDENTIAL');
          guard();
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
      async createWallet() { throw Error('Fixture cannot create real wallets'); },
      async importWallet() { throw Error('Fixture cannot import real wallets'); },
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
        if (!fixtureWalletPresent) return { presence: 'empty', backup: 'unconfirmed' };
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
    checkSite: unavailableConnection,
    checkAddress: unavailableConnection,
    projectId: '0'.repeat(32),
    metadata: { name: 'Watch UI fixture', description: '', url: 'https://fixture.invalid', icons: [] },
  });
  latestAuthority = authority;
  retiredAuthorities.push(authority);
  const transferRuntime: NativeTransferRuntime = {
    replay() { throw Error("Fixture has no retained signed transactions"); },
    async submit(_raw, _hash, guard) { guard(); throw Error('Fixture does not submit signatures'); },
    async journal(guard) { guard(); return {
      async planAutomaticNonce({ latest, pending }) { guard(); return { kind: 'ready', nonce: Math.max(latest, pending), balanceState: 'pending', nativeReservations: { canonical: 0n, pending: 0n } }; },
      async assertSpendingNonce() { guard(); }, async load() { guard(); return null; },
      async saveSigned() { throw Error('Fixture does not submit signatures'); },
      async transition() { throw Error('Fixture does not submit signatures'); } }; },
    assertUnlocked(guard) { guard(); },
    async sign(_transaction, guard) { audit.signs++; events.push('sign:start'); await signGate(); guard(); events.push('sign:finish'); throw Error('Fixture does not submit signatures'); },
  };
  const transfers = new NativeTransfers(authority, () => transferRuntime, { rpc: new NativeTransferRpc({ networkId: 'ethereum', fetch: fixtureFetch }) });
  latestTransfers = transfers;
  const tokens = new NativeTokens(authority, () => undefined);
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
    async readPhrase(password) {
      if (!sessionUnlocked) throw Error('Locked fixture session');
      if (password !== 'public-password') throw new KeyringRuntimeError('INVALID_CREDENTIAL');
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
  const keyRuntime: KeyringRuntime['keyExport'] = {
    async readSelected(scope, password, guard) {
      guard();
      if (!sessionUnlocked) throw Error('Locked fixture session');
      audit.keyAttempts++;
      if (password === 'public-password') audit.keyReads++;
      events.push('key:start');
      await keyReadGate();
      if (keyFailure) throw new KeyringRuntimeError(keyFailure);
      if (password !== 'public-password') throw new KeyringRuntimeError('INVALID_CREDENTIAL');
      guard();
      events.push('key:finish');
      if (wifFixtureEnabled && scope.accountId.startsWith('hd:0:')) return `zprv${'A'.repeat(107)}`;
      return importedKeys.get(scope.accountId) ?? PUBLIC_TEST_KEY;
    },
  };
  const keyExport = new HdKeyExportFlow(authority, () => keyRuntime);
  keyExport.onClear(() => events.push('key:cancel'));
  const imports: NativeImportView = { previewUtxo: (...args) => authority.previewUtxoImport(...args), submit: (...args) => authority.importAccount(...args), cancel: () => authority.cancelAccountOperation() };
  return { authority, connections: connections.view, keyExport, imports,
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
      readNoteInventory: readFixtureNoteInventory,
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
  return {
    prepare(phrase: string, password: string, guard: () => void) {
      recoveryAudit.prepared++; cancelled = false;
      pending = (async () => {
        guard(); await controllers.authority.dispose(); await recoveryGate('prepare'); guard();
        if (cancelled) throw Error('CANCELLED');
        if (phrase !== publicBackupWords.join(' ')) throw Error('WRONG_PHRASE');
        replacement = password; return proof;
      })(); return pending;
    },
    commit(value: unknown) {
      pending = (async () => {
        if (value !== proof || cancelled) throw Error('CANCELLED');
        fixturePassword = replacement; replacement = ''; recoveryAudit.committed++;
        await recoveryGate('commit'); if (cancelled) throw Error('CANCELLED'); return 'committed-locked';
      })(); return pending;
    },
    cancel() { cancelled = true; replacement = ''; },
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
