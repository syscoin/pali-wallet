import { custodyIdle, securityPreferences } from './security';
// Actual custody/transfer controllers, with deterministic in-memory runtime ports.
import { NativeCustodyAuthority } from '../../src/custody/authority';
import { SeedBackupFlow } from '../../src/custody/seedBackup';
import { HdKeyExportFlow } from '../../src/custody/hdKeyExport';
import { KeyringRuntimeError, type KeyringRuntime } from '../../src/custody/keyringRuntime';
import { NativeTransfers, type NativeTransferRuntime } from '../../src/custody/transfers';
import { NativeTransferRpc } from '../../src/custody/transferRpc';
import { createBalanceReader } from '../../src/platformRpc';
import { importedKeyIdentity, normalizeImportedKey, type NativeImportView } from '../../src/custody/importedAccounts';
import { NativeActivity } from '../../src/activity/nativeActivity';
import { NativeTokens } from '../../src/portfolio/nativeTokens';
import type { NativeAccountView } from '../../src/custody/accounts';
import type { NativeWalletCatalogueSnapshot } from '../../src/custody/walletCatalogue';
import type { CustodyRuntime } from '../../src/custody/types';
import { NATIVE_NETWORKS } from '../../src/custody/networkContext';
import { ADDRESS, SECOND, audit, events, unlockGate, signGate, keyReadGate, PUBLIC_TEST_KEY, keyFailure, importGate, importFailure } from './state';
import { recoveryAudit, recoveryGate } from './recoveryState';
import type { RecoveryInventory } from '../../src/custody/recoveryInventory';

const needsInitialBackup = new URLSearchParams(window.location.search).has('backup-required');
let backupConfirmed = !needsInitialBackup;
const publicBackupWords = Object.freeze([...Array<string>(11).fill('abandon'), 'about']);
const fingerprint = '1'.repeat(64);

let catalogue: NativeWalletCatalogueSnapshot = Object.freeze<NativeWalletCatalogueSnapshot>({
  revision: 0, removed: [], networks: NATIVE_NETWORKS,
  active: { accountId: 'hd:60:0', networkId: 'ethereum' },
  accounts: [
    { id: 'hd:60:0', type: 'HDAccount', index: 0, slip44: 60, label: 'Account 1', address: ADDRESS },
    ...(needsInitialBackup ? [] : [{ id: 'hd:60:1', type: 'HDAccount' as const, index: 1, slip44: 60 as const, label: 'Account 2', address: SECOND }]),
    ...(new URLSearchParams(window.location.search).has('account-limit') ? Array.from({ length: 18 }, (_, index) => ({
      id: `hd:60:${index + 2}`, type: 'HDAccount' as const, index: index + 2, slip44: 60 as const, label: `Account ${index + 3}`, address: `0x${(index + 100).toString(16).padStart(40, '0')}`,
    })) : []),
  ],
});
export let latestAuthority: NativeCustodyAuthority | null = null;
export let latestTransfers: NativeTransfers | null = null;
export const retiredAuthorities: NativeCustodyAuthority[] = [];
let sessionUnlocked = false;
let fixturePassword = 'public-password';
let nextImportedIndex = 0;
const importedKeys = new Map<string, string>();
export function createNativeWalletControllers() {
  const runtime: CustodyRuntime = {
    security: { async reauthenticateIdlePolicy(password, check) { check(); events.push('idle:auth'); await unlockGate(); if (password !== fixturePassword) throw new KeyringRuntimeError('INVALID_CREDENTIAL'); check(); } },
    networks: {
      getSelectedId: () => catalogue.active.networkId,
      reserve(id, expectedRevision) {
        const registration = NATIVE_NETWORKS.find((network) => network.id === id);
        if (expectedRevision !== catalogue.revision || !registration) throw new KeyringRuntimeError('CANCELLED');
        return { cancel() {}, async execute(guard) {
          guard();
          catalogue = Object.freeze({ ...catalogue, revision: catalogue.revision + 1, active: { ...catalogue.active, networkId: registration.id } });
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
              const index = Math.max(...items.filter((a) => a.type === 'HDAccount').map((a) => a.index)) + 1;
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
      reserve(input, password, expectedRevision) {
        if (expectedRevision !== catalogue.revision) throw new KeyringRuntimeError('CANCELLED');
        const key = normalizeImportedKey(input.privateKey), identity = importedKeyIdentity(key, nextImportedIndex);
        if (input.expectedAddress !== identity.address || !input.label.trim()) throw new KeyringRuntimeError('INVALID_INPUT');
        if (catalogue.accounts.some((account) => account.address === identity.address)) throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
        if (catalogue.accounts.length >= 20) throw new KeyringRuntimeError('ACCOUNT_LIMIT');
        return { cancel() {}, async execute(guard) {
          guard(); audit.importAttempts++; events.push('import:start');
          await importGate();
          if (importFailure) throw new KeyringRuntimeError(importFailure);
          if (password !== 'public-password') throw new KeyringRuntimeError('INVALID_CREDENTIAL');
          guard();
          importedKeys.set(identity.id, key); nextImportedIndex++;
          const account = { id: identity.id, type: 'Imported' as const, index: identity.index, slip44: 60 as const, label: input.label, address: identity.address };
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
      async readEthereumAddress() {
        if (!sessionUnlocked) throw Error('Locked fixture session');
        return catalogue.accounts.find((account) => account.id === catalogue.active.accountId)!.address;
      },
      async lock() { sessionUnlocked = false; events.push('lock'); },
    },
    storage: {
      async readState() { return { presence: 'existing', backup: backupConfirmed ? 'confirmed' : 'unconfirmed' }; },
      async close() { audit.closed++; events.push('close'); },
    },
  };
  const authority = new NativeCustodyAuthority({ open: async () => runtime }, { preferences: securityPreferences, assertActive: custodyIdle.captureGuard() });
  latestAuthority = authority;
  retiredAuthorities.push(authority);
  const transferRuntime: NativeTransferRuntime = {
    async submit(_raw, _hash, guard) { guard(); throw Error('Fixture does not submit signatures'); },
    async journal(guard) { guard(); return { async load() { guard(); return null; },
      async saveSigned() { throw Error('Fixture does not submit signatures'); },
      async transition() { throw Error('Fixture does not submit signatures'); } }; },
    assertUnlocked(guard) { guard(); },
    async sign(_transaction, guard) { audit.signs++; events.push('sign:start'); await signGate(); guard(); events.push('sign:finish'); throw Error('Fixture does not submit signatures'); },
  };
  const transfers = new NativeTransfers(authority, () => transferRuntime, { rpc: new NativeTransferRpc({ networkId: 'ethereum', fetch: fixtureFetch }) });
  latestTransfers = transfers;
  const tokens = new NativeTokens(authority, () => undefined);
  const activity = new NativeActivity(authority, () => undefined);
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
      return importedKeys.get(scope.accountId) ?? PUBLIC_TEST_KEY;
    },
  };
  const keyExport = new HdKeyExportFlow(authority, () => keyRuntime);
  keyExport.onClear(() => events.push('key:cancel'));
  const imports: NativeImportView = { submit: (...args) => authority.importEvmAccount(...args), cancel: () => authority.cancelAccountOperation() };
  return { authority, keyExport, imports, balanceReader: createBalanceReader({ fetch: fixtureFetch }), transfers: transfers.view, tokens: tokens.view, activity, accounts, backup,
    async readRecoveryInventory(): Promise<RecoveryInventory> {
      return { status: 'needs-matching-phrase-verification', reason: null, backup: backupConfirmed ? 'confirmed' : 'unconfirmed', privateNotes: 'not-supported',
        counts: { hdAccounts: catalogue.accounts.filter((a) => a.type === 'HDAccount').length, importedKeys: importedKeys.size, retiredHdAccounts: 0, retiredImportedAccounts: 0, retainedSignedTransactions: 0, tokenEntries: 0, historySummaries: 0, cachedTransactions: 0, activityPreferences: 0 } };
    },
    disposeTokens: () => tokens.dispose(), disposeTransfers: () => transfers.dispose() };
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
  const request = JSON.parse(String(init?.body));
  let result: unknown;
  switch (request.method) {
    case 'eth_chainId': result = '0x1'; break;
    case 'eth_getBalance': result = '0x10000000000000000'; break;
    case 'eth_getTransactionCount': result = '0x0'; break;
    case 'eth_getBlockByNumber': result = { number: '0x20', hash: '0x' + '2'.repeat(64) }; break;
    case 'eth_feeHistory': result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] }; break;
    case 'eth_maxPriorityFeePerGas': result = '0x1'; break;
    case 'eth_estimateGas': result = '0x5208'; break;
    case 'eth_getTransactionReceipt': result = null; break;
    case 'eth_sendRawTransaction': audit.broadcasts++; throw Error('Fixture forbids broadcast');
    default: throw Error(`Unhandled synthetic RPC ${request.method}`);
  }
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'Content-Type': 'application/json' } });
};

export function fixtureCatalogue() { return catalogue; }
