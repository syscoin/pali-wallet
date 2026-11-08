// Real removal flow and authority, with synthetic password and storage ports.
// No SQLite, SecureStore, keys or personal wallet records are used by this fixture.
import type { NativeCustodyAuthority } from '../../src/custody/authority';
import type { KeyringRuntime } from '../../src/custody/keyringRuntime';
import { NativeWalletRemoval, WalletRemovalError } from '../../src/custody/walletRemoval';
import type { OpenWalletStorage, RecoveryStorageSnapshot } from '../../src/storage/types';
import { clearNativeAccountSelection, saveAccountSelection } from './platform';

export const removalFixtureEnabled = new URLSearchParams(window.location.search).has('wallet-removal-fixture');
export let fixtureWalletPresent = true;
export function recreateFixtureWallet() { fixtureWalletPresent = true; }

type Boundary = 'authorize' | 'commit';
type Result = 'removed' | 'unchanged' | 'unconfirmed';
const audit = { authorizations: 0, confirmationAttempts: 0, commits: 0, reopens: 0 };
let result: Result = 'removed';
let held: Boundary | null = null;
let releaseGate: (() => void) | undefined;
const gate = async (boundary: Boundary) => {
  if (held === boundary) await new Promise<void>((resolve) => { releaseGate = resolve; });
};
export const walletRemovalFixture = {
  result(value: Result) { result = value; },
  hold(boundary: Boundary) { held = boundary; },
  release() {
    held = null;
    const release = releaseGate;
    releaseGate = undefined;
    release?.();
  },
  audit: () => ({ ...audit }),
  saveSelection: saveAccountSelection,
};

const installation = '41'.repeat(16);
const pair = '42'.repeat(32);
const before: RecoveryStorageSnapshot = {
  state: { presence: 'existing', backup: 'confirmed' },
  identity: { walletBindingId: pair, pairFingerprint: pair, root: null, verification: 'requires-unlock' },
  metadata: [{ key: 'installation', value: installation }],
  records: [{ key: 'vault', value: 'Synthetic sealed wallet' }], notes: [], signedRecords: [],
};
const empty: RecoveryStorageSnapshot = {
  state: { presence: 'empty', backup: 'unconfirmed' },
  identity: null, metadata: before.metadata, records: [], notes: [], signedRecords: [],
};
const unavailable = async (): Promise<never> => { throw Error('Unplanned wallet-removal fixture operation'); };

function storagePort(read: () => RecoveryStorageSnapshot, removal?: OpenWalletStorage['removal']): OpenWalletStorage {
  return {
    keyringStorage: { get: unavailable, set: unavailable, deleteItem: unavailable, createManyIfAbsent: unavailable, compareAndSet: unavailable, compareAndSetMany: unavailable },
    signedRecords: { read: unavailable, compareAndSet: unavailable },
    authGuard: { checkAllowed: unavailable, recordFailure: unavailable, recordSuccess: unavailable },
    recovery: { async readSnapshot() { return read(); }, async readIdentity() { return read().identity; }, bindIdentity: unavailable },
    removal,
    async readState() { return read().state; },
    getWalletFingerprint: unavailable,
    confirmBackup: unavailable,
    async close() {},
  };
}

export function createWalletRemovalFixture(
  owner: NativeCustodyAuthority,
  catalogue: KeyringRuntime['catalogue'],
  passwordMatches: (password: string) => boolean
) {
  let dispatched: Result | undefined;
  const storage = storagePort(() => before, {
    async commit(snapshot, guard) {
      guard();
      if (snapshot !== before || owner.getSnapshot().phase !== 'disposed') throw Error('Unexpected removal admission');
      audit.commits++;
      dispatched = result;
      // The simulated durability boundary is already crossed. A late UI
      // cancellation must still let the real controller verify the outcome.
      await gate('commit');
      if (dispatched !== 'removed') return { status: 'reopen-required' };
      fixtureWalletPresent = false;
      return { status: 'wallet-records-removed' };
    },
  });
  const runtime: Pick<KeyringRuntime, 'authorizeWalletRemoval' | 'catalogue'> = {
    catalogue,
    async authorizeWalletRemoval(password, guard, beforeSnapshot) {
      guard();
      audit.authorizations++;
      await gate('authorize');
      if (!passwordMatches(password)) throw new WalletRemovalError('INVALID_CREDENTIAL');
      guard();
      await beforeSnapshot(guard);
      guard();
      return { snapshot: before, assertCurrent: guard };
    },
  };
  const flow = new NativeWalletRemoval({
    beforeSnapshot: async () => undefined,
    owner,
    source: () => ({ runtime, storage }),
    async reopen(expected) {
      audit.reopens++;
      if (expected !== installation || dispatched === 'unconfirmed') throw Error('Synthetic verification failure');
      return storagePort(() => dispatched === 'removed' ? empty : before);
    },
    clearNativeSelection: clearNativeAccountSelection,
    assertActive() {},
  });
  return {
    authorize: flow.authorize.bind(flow),
    confirm: (...args: Parameters<typeof flow.confirm>) => { audit.confirmationAttempts++; return flow.confirm(...args); },
    cancel: flow.cancel.bind(flow),
    dispose: flow.dispose.bind(flow),
    hasVerifiedRemoval: flow.hasVerifiedRemoval.bind(flow),
  };
}
