// Actual custody/transfer controllers, with deterministic in-memory runtime ports.
import { NativeCustodyAuthority } from '../../src/custody/authority';
import { NativeTransfers, type NativeTransferRuntime } from '../../src/custody/transfers';
import { NativeTransferRpc } from '../../src/custody/transferRpc';
import { NativeTransferJournal } from '../../src/custody/transferJournal';
import { NativeActivity } from '../../src/activity/nativeActivity';
import { NativeTokens } from '../../src/portfolio/nativeTokens';
import type { NativeAccountView } from '../../src/custody/accounts';
import type { NativeWalletCatalogueSnapshot } from '../../src/custody/walletCatalogue';
import type { CustodyRuntime } from '../../src/custody/types';
import type { KeyringStoragePort } from '../../src/storage/types';
import { NATIVE_NETWORKS } from '../../src/custody/networkContext';
import { ADDRESS, SECOND, audit, events, unlockGate, signGate } from './state';

let catalogue: NativeWalletCatalogueSnapshot = Object.freeze<NativeWalletCatalogueSnapshot>({
  revision: 0, removed: [], networks: NATIVE_NETWORKS,
  active: { accountId: 'hd:60:0', networkId: 'ethereum' },
  accounts: [
    { id: 'hd:60:0', type: 'HDAccount', index: 0, slip44: 60, label: 'Account 1', address: ADDRESS },
    { id: 'hd:60:1', type: 'HDAccount', index: 1, slip44: 60, label: 'Account 2', address: SECOND },
  ],
});
export let latestAuthority: NativeCustodyAuthority | null = null;
export let latestTransfers: NativeTransfers | null = null;
export const retiredAuthorities: NativeCustodyAuthority[] = [];
let sessionUnlocked = false;
const stored: Record<string, unknown> = {};
const store: KeyringStoragePort = {
  async get(key) { return stored[key] === undefined ? undefined : structuredClone(stored[key]); },
  async set(key, value) { stored[key] = structuredClone(value); },
  async deleteItem() { throw Error('Fixture never deletes a journal'); },
  async createManyIfAbsent(values) { if (Object.keys(values).some((key) => key in stored)) return false; Object.assign(stored, structuredClone(values)); return true; },
  async compareAndSet(key, expected, value) { if (JSON.stringify(stored[key]) !== JSON.stringify(expected)) return false; stored[key] = structuredClone(value); return true; },
};
export function createNativeWalletControllers() {
  const runtime: CustodyRuntime = {
    accounts: {
      supported: () => true,
      getSnapshot: () => catalogue,
      reserve(request, expectedRevision) {
        if (expectedRevision !== catalogue.revision) throw Error('CANCELLED');
        return {
          cancel() {},
          async execute(guard) {
            guard();
            if (request.kind !== 'select') throw Error('This fixture only selects HD accounts');
            const account = catalogue.accounts.find((candidate) => candidate.id === request.id);
            if (!account) throw Error('Unknown fixture HD account');
            catalogue = Object.freeze({ ...catalogue, revision: catalogue.revision + 1, active: { ...catalogue.active, accountId: account.id } });
            guard();
          },
        };
      },
    },
    session: {
      async createWallet() { throw Error('Fixture cannot create real wallets'); },
      async importWallet() { throw Error('Fixture cannot import real wallets'); },
      async unlock(password) {
        audit.unlocks++; events.push('unlock:start');
        await unlockGate();
        sessionUnlocked = password === 'public-password';
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
      async readState() { return { presence: 'existing', backup: 'confirmed' }; },
      async close() { audit.closed++; events.push('close'); },
    },
  };
  const authority = new NativeCustodyAuthority({ open: async () => runtime });
  latestAuthority = authority;
  retiredAuthorities.push(authority);
  const transferRuntime: NativeTransferRuntime = {
    async journal(guard) { guard(); return new NativeTransferJournal(store, { walletFingerprint: '1'.repeat(64), address: ADDRESS, chainId: '1' }, guard); },
    async authorize(_password, guard) { guard(); },
    async sign(_transaction, _password, guard) { audit.signs++; events.push('sign:start'); await signGate(); guard(); events.push('sign:finish'); throw Error('Fixture does not submit signatures'); },
  };
  const transfers = new NativeTransfers(authority, () => transferRuntime, { rpc: new NativeTransferRpc({ fetch: fixtureFetch }) });
  latestTransfers = transfers;
  const tokens = new NativeTokens(authority, () => undefined);
  const activity = new NativeActivity(authority, () => undefined);
  const accounts: NativeAccountView = {
    getSnapshot: () => authority.getCatalogue(), getContextRevision: () => authority.getSnapshot().revision,
    subscribe: (listener) => authority.subscribe(() => listener()),
    execute: (...args) => authority.manageAccounts(...args), cancel: () => authority.cancelAccountOperation(),
  };
  const backup = {
    cancel() { events.push('backup:cancel'); }, dispose() {}, onClear() { return () => undefined; },
    async begin() { throw Error('Fixture never exports keys'); }, async confirm() { throw Error('Fixture never exports keys'); },
  };
  return { authority, transfers: transfers.view, tokens: tokens.view, activity, accounts, backup,
    disposeTokens: () => tokens.dispose(), disposeTransfers: () => transfers.dispose() };
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
