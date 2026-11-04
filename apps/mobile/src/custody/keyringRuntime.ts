import type { IKeyringAccountState } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { normalizePublicAddress } from '../core/addresses.ts';
import { RPC_ENDPOINTS } from '../platformRpc.ts';
import type { OpenWalletStorage } from '../storage/types.ts';
import { WalletStorageError } from '../storage/types.ts';
import type { CustodyRuntime, CustodyRuntimeFactory } from './types.ts';
import { CustodyRuntimeError } from './types.ts';
import { type JournalRemovalSnapshot, NativeTransferJournal, TransferJournalError, journalRequiresReopen } from './transferJournal.ts';
import { NativeWalletCatalogue, WalletCatalogueError, MAX_HD_ACCOUNTS, MAX_HD_ACCOUNT_INDEX } from './walletCatalogue.ts';
import { getNativeNetwork, nativeSigningEnabled, type EvmNetworkId } from './networkContext.ts';
import type { NativeAccountRequest, NativeAccountRuntime, NativeNetworkRuntime } from './accounts.ts';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import type { NativeTransferRuntime } from './transfers.ts';
import { assertTransferIntentEnvelope, snapshotErc20TransferIntent } from './transferIntent.ts';
import { normalizeErc20Address } from '../portfolio/erc20Metadata.ts';
import { NativeTokenRegistry } from '../portfolio/tokenRegistry.ts';
import type { NativeTokenScope } from '../portfolio/tokenRegistry.ts';
import type { NativeTokenRuntime } from '../portfolio/nativeTokens.ts';
import { NativeActivityHistory } from '../activity/historyStore.ts';
import { createActivityScope, type ActivityScope } from '../activity/types.ts';
import type { NativeActivityRuntime } from '../activity/nativeActivity.ts';

type SoftwareSdk = typeof import('@sidhujag/sysweb3-keyring/cjs/software.js');
type IndexedKeyring = InstanceType<SoftwareSdk['SoftwareKeyring']> & {
  deriveEvmHdRuntimeAccount?: (request: { index: number }, options: { assertCurrent(): void }) => Promise<IKeyringAccountState>;
};

export class KeyringRuntimeError extends CustodyRuntimeError {
  constructor(code: KeyringRuntimeError['code']) {
    super(code);
    this.name = 'KeyringRuntimeError';
  }
}

export type KeyringRuntimeDependencies = Readonly<{
  ensureCryptoReady(): Promise<void>;
  openStorage(): Promise<OpenWalletStorage>;
  loadSdk?: () => Promise<SoftwareSdk>;
}>;

/** Internal capability consumed by the epoch-bound backup controller only. */
export interface KeyringRuntime extends CustodyRuntime {
  readonly activity?: NativeActivityRuntime;
  /** Local public token descriptors only; never exposes the underlying store. */
  readonly tokens?: NativeTokenRuntime;
  /** Native transfer host only; never exposed directly to a screen. */
  readonly transfers?: NativeTransferRuntime;
  /** Public metadata only; no selection/signing authority. Cleared on lock. */
  readonly catalogue: { getSnapshot(): NativeWalletCatalogueSnapshot | null };
  readonly backup: {
    readPhrase(password: string): Promise<readonly string[]>;
    fingerprint(): Promise<string>;
    confirm(fingerprint: string): Promise<void>;
  };
}

function validPassword(password: unknown, creating: boolean): asserts password is string {
  if (
    typeof password !== 'string' || !password.isWellFormed() ||
    password.length === 0 || new TextEncoder().encode(password).length > 1024 ||
    (creating && [...password].length < 12)
  ) throw new KeyringRuntimeError('INVALID_INPUT');
}

/** A Promise/thenable return cannot satisfy the host's synchronous revocation check. */
function checkGuard(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
    throw new KeyringRuntimeError('CANCELLED');
  }
}

/**
 * Adapt the published software keyring without exposing it, account secrets or
 * storage to a screen. The factory cannot load SDK code before native crypto
 * qualification and cannot silently substitute an in-memory store.
 */
export function createKeyringRuntimeFactory(
  dependencies: KeyringRuntimeDependencies
): CustodyRuntimeFactory {
  return {
    async open(): Promise<KeyringRuntime> {
      await dependencies.ensureCryptoReady();
      const storage = await dependencies.openStorage();
      try {
        const sdk = await (dependencies.loadSdk?.() ?? import('@sidhujag/sysweb3-keyring/cjs/software.js'));
        const host = sdk.createSoftwareKeyringHost(storage.keyringStorage);
        const keyring = new sdk.SoftwareKeyring(host) as IndexedKeyring;
        const state = {
          activeAccount: { id: 0, type: sdk.KeyringAccountType.HDAccount },
          activeNetwork: {
            kind: sdk.INetworkType.Ethereum,
            chainId: 1,
            slip44: 60,
            currency: 'ETH',
            label: 'Ethereum',
            url: RPC_ENDPOINTS.ethereum!,
          },
          accounts: {
            HDAccount: {} as Record<number, IKeyringAccountState>,
            Imported: {}, Ledger: {}, Trezor: {}, SmartAccount: {},
          },
        };
        keyring.setVaultStateGetter(() => state);
        const catalogue = new NativeWalletCatalogue(storage.keyringStorage);
        const tokens = new NativeTokenRegistry(storage.keyringStorage);
        const activityHistory = new NativeActivityHistory(storage.keyringStorage);
        let catalogueSnapshot: NativeWalletCatalogueSnapshot | null = null;
        let generation = 0;
        let closed = false;
        let active: Promise<unknown> | null = null;
        let reserved: object | null = null;
        let closing: Promise<void> | null = null;

        const current = (captured: number) => {
          if (closed || captured !== generation) throw new Error('CANCELLED');
          if (catalogue.requiresReopen || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage)) throw new KeyringRuntimeError('CLEANUP_FAILED');
        };
        const lock = (): Promise<void> => {
          generation++;
          // Invoke the SDK now: its secret buffers are retired synchronously.
          const pending = keyring.lockWallet();
          state.accounts.HDAccount = {};
          catalogueSnapshot = null;
          // Retire secrets synchronously, then report quarantine asynchronously.
          // storage.close() must still install its cleanup promise and drain work.
          return pending.then(() => {
            if (catalogue.requiresReopen || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage)) throw new KeyringRuntimeError('CLEANUP_FAILED');
          });
        };
        const run = <T>(operation: (captured: number) => Promise<T>): Promise<T> => {
          if (closed) return Promise.reject(new Error('CANCELLED'));
          if (catalogue.requiresReopen || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage)) {
            void lock().catch(() => undefined);
            return Promise.reject(new KeyringRuntimeError('CLEANUP_FAILED'));
          }
          if (active || reserved) return Promise.reject(new Error('BUSY'));
          const captured = generation;
          // Admit before invoking any injected storage/SDK callback.
          const task = Promise.resolve().then(() => operation(captured));
          const handled = task.catch(async (error: unknown) => {
            const wasCurrent = captured === generation && !closed;
            try { await lock(); }
            catch { closed = true; throw new KeyringRuntimeError('CLEANUP_FAILED'); }
            if (!wasCurrent || closed) throw new KeyringRuntimeError('CANCELLED');
            if (error instanceof KeyringRuntimeError) throw error;
            if (error instanceof TransferJournalError && error.code === 'PENDING_TRANSFER') throw new KeyringRuntimeError('PENDING_TRANSFER');
            if (error instanceof WalletCatalogueError && error.code === 'CATALOGUE_LIMIT') throw new KeyringRuntimeError('ACCOUNT_LIMIT');
            if (error instanceof WalletCatalogueError && error.code === 'CATALOGUE_NOT_REMOVABLE') throw new KeyringRuntimeError('ACCOUNT_NOT_REMOVABLE');
            if (error instanceof WalletStorageError && error.code === 'AUTH_THROTTLED')
              throw new KeyringRuntimeError('AUTH_THROTTLED');
            throw new KeyringRuntimeError('OPERATION_FAILED');
          }).finally(() => { active = null; });
          active = handled;
          return handled;
        };
        const checkedAccount = (account: IKeyringAccountState, index: number) => {
          if (!account || account.id !== index || account.isImported || account.isLedgerWallet ||
              account.isTrezorWallet || account.isSmartAccount) throw new Error('UNAVAILABLE');
          normalizePublicAddress(account.address, 'ethereum');
          return account;
        };
        const deriveAt = async (index: number, captured: number, assertCurrent: () => void = () => undefined) => {
          current(captured); checkGuard(assertCurrent);
          if (typeof keyring.deriveEvmHdRuntimeAccount !== 'function') throw new KeyringRuntimeError('NOT_READY');
          const account = await keyring.deriveEvmHdRuntimeAccount({ index }, { assertCurrent: () => { current(captured); checkGuard(assertCurrent); } });
          current(captured); checkGuard(assertCurrent);
          return checkedAccount(account, index);
        };
        const hydrate = async (captured: number) => {
          current(captured);
          const first = checkedAccount(await keyring.createFirstAccount(), 0);
          current(captured);
          const derived = new Map<number, IKeyringAccountState>([[0, first]]);
          const walletFingerprint = await storage.getWalletFingerprint();
          current(captured);
          const nextCatalogue = await catalogue.reconcile({ walletFingerprint, address: first.address, publicKey: first.xpub },
            () => current(captured), async (index) => {
              const account = await deriveAt(index, captured);
              derived.set(index, account);
              return { address: account.address, publicKey: account.xpub };
            });
          current(captured);
          for (const account of nextCatalogue.accounts) {
            await new NativeTransferJournal(storage.keyringStorage, { walletFingerprint, address: account.address, chainId: '1' }, () => current(captured), Date.now, account.index).load();
            current(captured);
          }
          state.accounts.HDAccount = Object.fromEntries(nextCatalogue.accounts.map((a) => [a.index, { ...derived.get(a.index)!, label: a.label }]));
          const selected = nextCatalogue.accounts.find((a) => a.id === nextCatalogue.active.accountId)!;
          state.activeAccount = { id: selected.index, type: sdk.KeyringAccountType.HDAccount };
          const selectedNetwork = getNativeNetwork(nextCatalogue.active.networkId);
          state.activeNetwork = { ...state.activeNetwork, chainId: Number(selectedNetwork.chainId), slip44: selectedNetwork.slip44, url: selectedNetwork.rpcUrl, currency: selectedNetwork.symbol, label: selectedNetwork.id };
          catalogueSnapshot = nextCatalogue;
        };
        const authenticate = async (password: string, captured: number) => {
          validPassword(password, false);
          await storage.authGuard.checkAllowed();
          current(captured);
          const result = await keyring.unlock(password);
          if (!result || typeof result.canLogin !== 'boolean') throw new Error('UNAVAILABLE');
          if (!result.canLogin) {
            // A definitive rejected credential still counts when lock/background
            // revokes the session while its unabortable KDF is finishing.
            await storage.authGuard.recordFailure();
            current(captured);
            return false;
          }
          current(captured);
          await storage.authGuard.recordSuccess();
          current(captured);
          return true;
        };
        const reserveContext = (input: NativeAccountRequest | { kind: 'select-network'; id: EvmNetworkId }, expectedRevision: number, networkSelection = false) => {
            if (closed || !keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
            if (active || reserved) throw new KeyringRuntimeError('BUSY');
            if (typeof keyring.deriveEvmHdRuntimeAccount !== 'function' || catalogueSnapshot.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
            const request = decodeStorageValue(encodeStorageValue(input)) as NativeAccountRequest | { kind: 'select-network'; id: EvmNetworkId };
            if (!request || typeof request !== 'object' || Array.isArray(request) || (!networkSelection && request.kind === 'select-network')) throw new KeyringRuntimeError('INVALID_INPUT');
            const fields = request.kind === 'create' ? ['kind', 'label', 'password'] : request.kind === 'restore'
              ? ['kind', 'index', 'label', 'password'] : request.kind === 'rename' ? ['kind', 'id', 'label']
              : request.kind === 'remove' ? ['kind', 'id', 'password'] : request.kind === 'select' || request.kind === 'select-network' ? ['kind', 'id'] : [];
            if (!fields.length || Object.keys(request).sort().join(',') !== fields.sort().join(',') ||
                ('id' in request && request.kind !== 'select-network' && (typeof request.id !== 'string' || !/^hd:60:(?:0|[1-9][0-9]{0,3})$/.test(request.id))) ||
                ('index' in request && (!Number.isSafeInteger(request.index) || request.index < 1 || request.index > 4095)) ||
                ('label' in request && (typeof request.label !== 'string' || !request.label.isWellFormed() || !request.label || request.label.trim() !== request.label || request.label.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(request.label))))
              throw new KeyringRuntimeError('INVALID_INPUT');
            if ('password' in request) validPassword(request.password, false);
            // Expected eligibility failures leave the current authority/reviews intact.
            if ((request.kind === 'create' || request.kind === 'restore') && catalogueSnapshot.accounts.length >= MAX_HD_ACCOUNTS)
              throw new KeyringRuntimeError('ACCOUNT_LIMIT');
            if (request.kind === 'create' && catalogue.nextIndex > MAX_HD_ACCOUNT_INDEX)
              throw new KeyringRuntimeError('ACCOUNT_LIMIT');
            if (request.kind === 'restore' && !catalogueSnapshot.removed.some((account) => account.index === request.index))
              throw new KeyringRuntimeError('INVALID_INPUT');
            if (request.kind === 'select-network') getNativeNetwork(request.id);
            if ('id' in request && request.kind !== 'select-network') {
              const target = catalogueSnapshot.accounts.find((account) => account.id === request.id);
              if (!target) throw new KeyringRuntimeError('INVALID_INPUT');
              if (request.kind === 'remove' && (target.index === 0 || target.id === catalogueSnapshot.active.accountId || catalogueSnapshot.accounts.length <= 1))
                throw new KeyringRuntimeError('ACCOUNT_NOT_REMOVABLE');
            }
            const token = {};
            reserved = token;
            const generationAtAdmission = ++generation;
            let used = false;
            return {
              cancel() { if (!used && reserved === token) reserved = null; used = true; },
              execute(assertCurrent: () => void) {
                if (used || reserved !== token || generationAtAdmission !== generation) {
                  if (reserved === token) reserved = null;
                  return Promise.reject(new KeyringRuntimeError('CANCELLED'));
                }
                used = true; reserved = null;
                return run(async (captured) => {
                  current(captured); checkGuard(assertCurrent);
                  if ('password' in request) {
                    if (!await authenticate(request.password, captured)) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
                    current(captured); checkGuard(assertCurrent);
                    await hydrate(captured);
                    current(captured); checkGuard(assertCurrent);
                  }
                  const before = catalogueSnapshot;
                  if (!before || before.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
                  let derived: IKeyringAccountState | undefined;
                  let mutation;
                  if (request.kind === 'create' || request.kind === 'restore') {
                    const index = request.kind === 'create' ? catalogue.nextIndex : request.index;
                    derived = await deriveAt(index, captured, assertCurrent);
                    current(captured); checkGuard(assertCurrent);
                    mutation = { kind: request.kind, index, address: derived.address, publicKey: derived.xpub, label: request.label } as const;
                  } else {
                    mutation = request.kind === 'remove' ? { kind: 'remove' as const, id: request.id, journal: null as JournalRemovalSnapshot | null } : request;
                    if (request.kind === 'remove') {
                      const account = before.accounts.find((a) => a.id === request.id);
                      if (!account) throw new KeyringRuntimeError('CANCELLED');
                      const fingerprint = await storage.getWalletFingerprint();
                      current(captured); checkGuard(assertCurrent);
                      const journal = new NativeTransferJournal(storage.keyringStorage, { walletFingerprint: fingerprint, address: account.address, chainId: '1' }, () => { current(captured); checkGuard(assertCurrent); }, Date.now, account.index, undefined, (record, guard) => activityHistory.archiveTerminal(record, guard));
                      const pending = await journal.removalSnapshot();
                      current(captured); checkGuard(assertCurrent);
                      mutation = { kind: 'remove' as const, id: request.id, journal: pending };
                    }
                  }
                  const next = await catalogue.mutate(expectedRevision, mutation, () => { current(captured); checkGuard(assertCurrent); });
                  current(captured); checkGuard(assertCurrent);
                  if (derived) state.accounts.HDAccount[derived.id] = derived;
                  state.accounts.HDAccount = Object.fromEntries(next.accounts.map((a) => [a.index, { ...state.accounts.HDAccount[a.index]!, label: a.label }]));
                  const selected = next.accounts.find((a) => a.id === next.active.accountId)!;
                  state.activeAccount = { id: selected.index, type: sdk.KeyringAccountType.HDAccount };
                  const selectedNetwork = getNativeNetwork(next.active.networkId);
                  state.activeNetwork = { ...state.activeNetwork, chainId: Number(selectedNetwork.chainId), slip44: selectedNetwork.slip44, url: selectedNetwork.rpcUrl, currency: selectedNetwork.symbol, label: selectedNetwork.id };
                  catalogueSnapshot = next;
                });
              },
            };
        };
        const accounts: NativeAccountRuntime = {
          supported: () => typeof keyring.deriveEvmHdRuntimeAccount === 'function',
          getSnapshot: () => closed || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage) || !keyring.isUnlocked() ? null : catalogueSnapshot,
          reserve: (input, expectedRevision) => reserveContext(input, expectedRevision),
        };
        const networks: NativeNetworkRuntime = {
          getSelectedId: () => closed || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage) || !keyring.isUnlocked() ? null : catalogueSnapshot?.active.networkId ?? null,
          reserve: (id, expectedRevision) => {
            if (typeof id !== 'string') throw new KeyringRuntimeError('INVALID_INPUT');
            const network = getNativeNetwork(id);
            return reserveContext({ kind: 'select-network', id: network.id }, expectedRevision, true);
          },
        };
        const canSign = () => !!catalogueSnapshot && nativeSigningEnabled(catalogueSnapshot.active.networkId);
        const activityContext = async (assertCurrent: () => void): Promise<{ scope: ActivityScope; guard: () => void; index: number }> => {
          const captured = generation;
          const guard = () => { current(captured); checkGuard(assertCurrent); if (!keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY'); };
          guard();
          const selected = catalogueSnapshot!.accounts.find((account) => account.id === catalogueSnapshot!.active.accountId)!;
          const networkId = catalogueSnapshot!.active.networkId;
          const fingerprint = await storage.getWalletFingerprint(); guard();
          return { scope: createActivityScope(fingerprint, selected.id, selected.address, networkId), guard, index: selected.index };
        };
        const checkActivityContext = async (scope: ActivityScope, assertCurrent: () => void) => {
          const context = await activityContext(assertCurrent);
          if (context.scope.key !== scope.key || context.scope.sourceId !== scope.sourceId) throw new KeyringRuntimeError('CANCELLED');
          return context;
        };
        const tokenOperation = <T>(assertCurrent: () => void, action: (scope: NativeTokenScope, guard: () => void) => Promise<T>): Promise<T> => {
          if (active || reserved) return Promise.reject(new KeyringRuntimeError('BUSY'));
          const captured = generation;
          const check = () => {
            current(captured); checkGuard(assertCurrent);
            if (!keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
          };
          try { check(); } catch (error) { return Promise.reject(error); }
          // Reserve before any await so account/network/authentication cannot race admission.
          const task = Promise.resolve().then(async () => {
            check();
            const selected = catalogueSnapshot!.accounts.find((account) => account.id === catalogueSnapshot!.active.accountId)!;
            const network = getNativeNetwork(catalogueSnapshot!.active.networkId);
            const walletFingerprint = await storage.getWalletFingerprint(); check();
            const result = await action(Object.freeze({ walletFingerprint, accountId: selected.id, address: selected.address,
              network: network.id, chainId: network.chainId, registrationHash: network.registrationHash }), check);
            check(); return result;
          }).catch(async (error: unknown) => {
            if (tokens.requiresReopen) {
              try { await lock(); } catch { /* Quarantine remains visible to authority cleanup. */ }
              throw new KeyringRuntimeError('CLEANUP_FAILED');
            }
            throw error;
          }).finally(() => { if (active === task) active = null; });
          active = task;
          return task;
        };
        return {
          accounts,
          networks,
          tokens: {
            load: async (guard) => {
              // Connection replay may retire a read while its storage call is draining.
              // Wait for that reservation, then validate the new caller before reading.
              while (active) { await active.catch(() => undefined); checkGuard(guard); }
              return tokenOperation(guard, (scope, check) => tokens.load(scope, check));
            },
            add: (revision, metadata, guard) => tokenOperation(guard, (scope, check) => tokens.add(scope, revision, metadata, check)),
            remove: (revision, contract, guard) => tokenOperation(guard, (scope, check) => tokens.remove(scope, revision, contract, check)),
          },
          catalogue: { getSnapshot: () => closed || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage) || !keyring.isUnlocked() ? null : catalogueSnapshot },
          session: {
            createWallet: (password) => run(async (captured) => {
              validPassword(password, true);
              current(captured);
              const phrase = keyring.createNewSeed(12);
              if (typeof phrase !== 'string' || !keyring.isSeedValid(phrase)) throw new Error('UNAVAILABLE');
              await keyring.initializeSession(phrase, password);
              current(captured);
              await hydrate(captured);
            }),
            importWallet: (phrase, password) => run(async (captured) => {
              validPassword(password, true);
              if (typeof phrase !== 'string' || !phrase.isWellFormed() || phrase.length > 4096) throw new KeyringRuntimeError('INVALID_INPUT');
              const normalized = phrase.normalize('NFKD').trim().replace(/\s+/gu, ' ');
              if (![12, 24].includes(normalized.split(' ').length) || !keyring.isSeedValid(normalized)) throw new KeyringRuntimeError('INVALID_INPUT');
              current(captured);
              await keyring.initializeSession(normalized, password);
              current(captured);
              await hydrate(captured);
            }),
            unlock: (password) => run(async (captured) => {
              const authenticated = await authenticate(password, captured);
              if (authenticated) await hydrate(captured);
              return { authenticated };
            }),
            async readEthereumAddress() {
              if (closed || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage) || !keyring.isUnlocked()) throw new Error('NOT_READY');
              const account = state.accounts.HDAccount[state.activeAccount.id];
              if (!account) throw new Error('NOT_READY');
              return normalizePublicAddress(account.address, 'ethereum');
            },
            lock,
          },
          activity: {
            async load(assertCurrent) {
              const { scope, guard, index } = await activityContext(assertCurrent);
              const journal = new NativeTransferJournal(storage.keyringStorage, { walletFingerprint: scope.walletFingerprint, address: scope.address, chainId: scope.network.chainId }, guard, Date.now, index, scope.network, (record, check) => activityHistory.archiveTerminal(record, check));
              const local = await journal.activity(); guard();
              const saved = await activityHistory.load(scope, guard); guard();
              return { scope, local, saved };
            },
            async saveCache(scope, candidates, assertCurrent) {
              const { guard } = await checkActivityContext(scope, assertCurrent);
              await activityHistory.saveCache(scope, candidates, guard);
            },
            async saveView(scope, view, assertCurrent) {
              const { guard } = await checkActivityContext(scope, assertCurrent);
              await activityHistory.saveView(scope, view, guard);
            },
          },
          transfers: {
            async token(contractAddress, assertCurrent) {
              const contract = normalizeErc20Address(contractAddress);
              while (active) { await active.catch(() => undefined); checkGuard(assertCurrent); }
              return tokenOperation(assertCurrent, async (scope, check) => {
                const inventory = await tokens.load(scope, check);
                check();
                const token = inventory.items.find((item) => item.contractAddress === contract);
                if (!token) throw new KeyringRuntimeError('NOT_READY');
                return token;
              });
            },
            async journal(assertCurrent) {
              if (closed || !keyring.isUnlocked()) throw new KeyringRuntimeError('CANCELLED');
              if (!canSign()) throw new KeyringRuntimeError('NOT_READY');
              const captured = generation;
              current(captured); checkGuard(assertCurrent);
              if (!keyring.isUnlocked() || !state.accounts.HDAccount[state.activeAccount.id]) throw new KeyringRuntimeError('CANCELLED');
              const fingerprint = await storage.getWalletFingerprint();
              current(captured); checkGuard(assertCurrent);
              const address = normalizePublicAddress(state.accounts.HDAccount[state.activeAccount.id]!.address, 'ethereum');
              return new NativeTransferJournal(storage.keyringStorage, { walletFingerprint: fingerprint, address, chainId: '1' }, () => { current(captured); checkGuard(assertCurrent); }, Date.now, state.activeAccount.id, undefined, (record, guard) => activityHistory.archiveTerminal(record, guard));
            },
            authorize: (password, assertCurrent) => {
              if (closed || !keyring.isUnlocked()) return Promise.reject(new KeyringRuntimeError('CANCELLED'));
              if (!canSign()) return Promise.reject(new KeyringRuntimeError('NOT_READY'));
              return run(async (captured) => {
              if (!keyring.isUnlocked()) throw new KeyringRuntimeError('CANCELLED');
              checkGuard(assertCurrent);
              if (!await authenticate(password, captured)) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
              current(captured); checkGuard(assertCurrent);
              await hydrate(captured);
              current(captured); checkGuard(assertCurrent);
            }); },
            sign: (transaction, password, assertCurrent, inputIntent) => {
              if (closed || !keyring.isUnlocked()) return Promise.reject(new KeyringRuntimeError('CANCELLED'));
              if (!canSign()) return Promise.reject(new KeyringRuntimeError('NOT_READY'));
              let intent;
              try {
                intent = inputIntent === undefined ? undefined : snapshotErc20TransferIntent(inputIntent);
                assertTransferIntentEnvelope(transaction, intent);
              } catch { return Promise.reject(new KeyringRuntimeError('INVALID_INPUT')); }
              return run(async (captured) => {
              if (!keyring.isUnlocked()) throw new KeyringRuntimeError('CANCELLED');
              checkGuard(assertCurrent);
              if (!await authenticate(password, captured)) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
              current(captured); checkGuard(assertCurrent);
              await hydrate(captured);
              current(captured); checkGuard(assertCurrent);
              assertTransferIntentEnvelope(transaction, intent);
              const signed = keyring.signPreparedEvmTransaction({
                account: { id: state.activeAccount.id, type: 'HDAccount', expectedAddress: transaction.from },
                network: { kind: 'ethereum', chainId: '1', slip44: 60, url: RPC_ENDPOINTS.ethereum! },
                transaction,
              }, { assertCurrent: () => { current(captured); checkGuard(assertCurrent); } });
              current(captured); checkGuard(assertCurrent);
              return Object.freeze({ rawTransaction: signed.rawTransaction, hash: signed.hash });
            }); },
          },
          storage: {
            readState: () => storage.readState(),
            close() {
              if (!closing) {
                closed = true;
                const work = active;
                const revocation = lock();
                closing = (async () => {
                  await Promise.allSettled([work, revocation]);
                  let failed = false;
                  try { await keyring.lockWallet(); } catch { failed = true; }
                  try { await storage.close(); } catch { failed = true; }
                  if (failed) throw new KeyringRuntimeError('CLEANUP_FAILED');
                })();
              }
              return closing;
            },
          },
          backup: {
            readPhrase: (password) => run(async (captured) => {
              if (!keyring.isUnlocked()) throw new Error('NOT_READY');
              if (!await authenticate(password, captured)) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
              const phrase = await keyring.getSeed(password);
              current(captured);
              if (typeof phrase !== 'string' || !keyring.isSeedValid(phrase)) throw new Error('UNAVAILABLE');
              return Object.freeze(phrase.split(' '));
            }),
            fingerprint: () => storage.getWalletFingerprint(),
            confirm: (fingerprint) => run(async (captured) => {
              if (!keyring.isUnlocked()) throw new Error('NOT_READY');
              current(captured);
              await storage.confirmBackup(fingerprint);
              current(captured);
            }),
          },
        };
      } catch {
        try { await storage.close(); } catch { /* the factory remains unavailable */ }
        throw new Error('UNAVAILABLE');
      }
    },
  };
}
