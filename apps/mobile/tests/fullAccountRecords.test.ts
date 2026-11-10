import { withTestPinOperation } from './fixtures/pinOperation.ts';
import { signTestTransfer } from './fixtures/operationAuthorization.ts';
import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HDNodeWallet, Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import {
  createKeyringRuntimeFactory,
  type KeyringRuntime,
} from '../src/custody/keyringRuntime.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const pinCredential = createTestPinCredentialPort();

process.env.NODE_ENV = 'production';
const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = '123456';

async function fixture() {
  const sdk = await loadNativeKeyringSdk();
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-full-records-'));
  const file = path.join(directory, 'wallet.sqlite');
  const calls = { first: 0, derive: 0, imports: 0, adds: 0 };
  const keyrings: InstanceType<typeof sdk.HostKeyring>[] = [];
  class Counted extends sdk.HostKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...options); keyrings.push(this);
      const first = this.createFirstAccount;
      this.createFirstAccount = async (...args) => {
        calls.first++;
        return first(...args);
      };
      const add = this.addNewAccount;
      this.addNewAccount = async (...args) => {
        calls.adds++;
        return add(...args);
      };
    }
    async deriveEvmHdRuntimeAccount(
      ...args: Parameters<
        typeof sdk.HostKeyring.prototype.deriveEvmHdRuntimeAccount
      >
    ) {
      calls.derive++;
      return super.deriveEvmHdRuntimeAccount(...args);
    }
    async importAccount(
      ...args: Parameters<typeof sdk.HostKeyring.prototype.importAccount>
    ) {
      calls.imports++;
      return super.importAccount(...args);
    }
  }
  class CountedSoftware extends sdk.SoftwareKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.SoftwareKeyring>) {
      super(...options);
      const first = this.createFirstAccount;
      this.createFirstAccount = async (...args) => {
        calls.first++;
        return first(...args);
      };
    }
  }
  let runtime!: KeyringRuntime;
  let storage!: SqliteWalletStorage;
  const factory = createKeyringRuntimeFactory({ pinCredential, requestOperationCredential: async (_request, _signal, check) => { check(); return { method: 'pin', pin: PASSWORD }; }, privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null,
    async ensureCryptoReady() {
      assert(globalThis.crypto.subtle);
    },
    async openStorage() {
      const fresh = !existsSync(file);
      storage = await SqliteWalletStorage.open(
        nodeConnection(file).connection,
        digest,
        INSTALLATION,
        fresh
      );
      return storage;
    },
    loadSdk: async () => ({ ...sdk, HostKeyring: Counted, SoftwareKeyring: CountedSoftware }),
  });
  const open = () =>
    new NativeCustodyAuthority({
      async open() {
        runtime = (await factory.open()) as KeyringRuntime;
        return runtime;
      },
    });
  let authority = open();
  await authority.initialize();
  await authority.importPhrase(PHRASE, PASSWORD);
  await runtime.backup.confirm(await runtime.backup.fingerprint());
  authority.lock();
  await authority.unlock(PASSWORD);
  return {
    calls,
    get keyring() { return keyrings.find((keyring) => keyring.hasPublicSession())!; },
    get authority() {
      return authority;
    },
    get runtime() {
      return runtime;
    },
    get storage() {
      return storage;
    },
    async record() {
      return (await storage.keyringStorage.get(WALLET_CATALOGUE_KEY)) as any;
    },
    async execute(
      request: Parameters<NativeCustodyAuthority['manageAccounts']>[0]
    ) {
      await authority.manageAccounts(
        request,
        authority.getSnapshot().revision,
        authority.getCatalogue()!.revision
      );
    },
    async reopen() {
      await authority.dispose();
      authority = open();
      await authority.initialize();
      await authority.unlock(PASSWORD);
    },
    async close() {
      try {
        await authority.dispose();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

test('complete SDK records survive normal unlock without deriving or importing accounts again', async () => {
  const f = await fixture();
  try {
    const record = await f.record();
    assert(record.groups[0].accounts.HDAccount[0].xprv.length > 30);
    for (const property of [
      'nextIndex',
      'retiredIndices',
      'nextImportedIndex',
      'retiredImportedIndices',
    ])
      assert(!Object.hasOwn(record, property));
    assert(!JSON.stringify(f.authority.getCatalogue()).includes('xprv'));
    assert.deepEqual(f.calls, { first: 1, derive: 0, imports: 0, adds: 0 });
    const before = JSON.stringify(record);
    f.authority.lock();
    await f.authority.unlock(PASSWORD);
    await f.reopen();
    assert.deepEqual(f.calls, { first: 1, derive: 0, imports: 0, adds: 0 });
    assert.equal(JSON.stringify(await f.record()), before);
  } finally {
    await f.close();
  }
});

test('the existing SDK reuses a deleted HD ID and the canonical map preserves a legal imported alias', async () => {
  const f = await fixture();
  try {
    await f.execute({ kind: 'create', label: 'Second', password: PASSWORD });
    const second = f.authority
      .getCatalogue()!
      .accounts.find(
        (account) => account.type === 'HDAccount' && account.index === 1
      )!;
    const secret = HDNodeWallet.fromPhrase(
      PHRASE,
      undefined,
      "m/44'/60'/0'/0/1"
    ).privateKey;
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: second.id, password: PASSWORD });
    await f.authority.importAccount(
      {
        privateKey: secret,
        label: 'Imported alias',
        expectedAddress: second.address,
      },
      PASSWORD,
      f.authority.getSnapshot().revision,
      f.authority.getCatalogue()!.revision
    );
    await f.execute({ kind: 'create', label: 'HD alias', password: PASSWORD });
    const aliases = f.authority
      .getCatalogue()!
      .accounts.filter((account) => account.address === second.address);
    assert.deepEqual(aliases.map((account) => account.type).sort(), [
      'HDAccount',
      'Imported',
    ]);
    assert.equal(
      aliases.find((account) => account.type === 'HDAccount')!.index,
      1
    );
    const before = await f.record(),
      counters = { ...f.calls };
    await f.reopen();
    assert.deepEqual(f.calls, counters);
    assert.deepEqual(await f.record(), before);
    const signed = await signTestTransfer(f.runtime.transfers!, PASSWORD,
      {
        type: 2, accessList: [],
        from: second.address,
        to: '0x1111111111111111111111111111111111111111',
        chainId: '1',
        nonce: '0',
        value: '1',
        gasLimit: '21000',
        data: '0x',
        maxFeePerGas: '2',
        maxPriorityFeePerGas: '1',
      },
      { assertCurrent: () => undefined, signal: new AbortController().signal }
    );
    assert.equal(Transaction.from(signed.rawTransaction).from, second.address);
    assert.equal(
      f.calls.imports,
      1,
      'only the actual user import calls the SDK importer'
    );
    assert.equal(
      f.calls.first,
      1,
      'only initial creation calls createFirstAccount'
    );
  } finally {
    await f.close();
  }
});

test('an actual SDK HD4096 record survives nonactive cold loading, selection and signing', async () => {
  const f = await fixture();
  try {
    const record = await f.record(), group = record.groups[0];
    const ring = f.keyring;
    const check = ring.capturePublicSessionGuard();
    const account = await withTestPinOperation(f.storage.pin, pinCredential, ring, PASSWORD, check,
      () => ring.deriveEvmHdRuntimeAccount({index: 4096}, {assertCurrent: check}));
    group.accounts.HDAccount[4096] = account;
    await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, record);
    await f.reopen();
    assert(f.authority.getCatalogue()!.accounts.some((row) => row.id === 'hd:60:4096'));
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'hd:60:0');
    await f.execute({kind: 'select', id: 'hd:60:4096'});
    const signed = await signTestTransfer(f.runtime.transfers!, PASSWORD, {type: 2, accessList: [], from: account.address, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1'}, { assertCurrent: () => undefined, signal: new AbortController().signal });
    assert.equal(Transaction.from(signed.rawTransaction).from, account.address);
    const current = f.authority.getCatalogue()!;
    const secret = await f.runtime.keyExport!.readSelected({ authorityRevision: f.authority.getSnapshot().revision, catalogueRevision: current.revision,
      accountId: 'hd:60:4096', index: 4096, address: account.address, networkId: current.active.networkId,
      registrationHash: getNativeNetwork(current.active.networkId, current.networks).registrationHash }, PASSWORD, () => undefined);
    assert.equal(new Wallet(secret).address, account.address);

  } finally { await f.close(); }
});

test('public catalogue snapshots cannot mutate retained network or active-account state', async () => {
  const f = await fixture();
  try {
    const before = await f.record(), snapshot = f.authority.getCatalogue()!;
    assert.equal(Reflect.set(snapshot.active, 'accountId', 'hd:60:4096'), false);
    assert.equal(Reflect.set(snapshot.networks[0]!, 'rpcUrl', 'https://untrusted.invalid'), false);
    assert.equal(Reflect.set(snapshot.networks, '0', snapshot.networks[1]), false);
    assert.deepEqual(await f.record(), before);
    assert.deepEqual(f.authority.getCatalogue(), snapshot);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally { await f.close(); }
});
