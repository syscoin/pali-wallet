import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AbiCoder, Interface } from 'ethers/abi';
import { Transaction } from 'ethers/transaction';
import { inspectEvmSignedBundle } from '../../../source/wallet/evmSignedRecords.ts';
import type { NativeNetworkRegistration } from '../src/custody/networkContext.ts';
import { getCreate2Address } from 'ethers/address';
import { keccak256 } from 'ethers/crypto';
import { concat } from 'ethers/utils';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { NativeRecoveryCoordinator } from '../src/custody/recovery.ts';
import { inspectRecoveryCatalogue, WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import { NativePortfolioController } from '../src/portfolio/nativePortfolio.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';
import { paliSmartAccountFactoryInterface } from '../../../source/utils/smartAccount/contracts.ts';
import { PALI_ACCOUNT_PROXY_CREATION_CODE, PALI_CANONICAL_FACTORY_ADDRESS, PALI_INFRASTRUCTURE_METADATA_BY_ID } from '../../../source/utils/smartAccount/deploymentMetadata.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES } from '../../../source/utils/smartAccount/infrastructureObservation.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public smart account fixture 1!';
const coder = AbiCoder.defaultAbiCoder();
const moduleTuple = 'tuple(address module,bytes data)';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-smart-account-test-'));
  const file = path.join(directory, 'wallet.sqlite');
  let initialized = false, substituteAddress = false, hold: (() => Promise<void>) | undefined;
  let runtime!: KeyringRuntime;
  let storage!: SqliteWalletStorage;
  const calls: string[] = [];
  const submitted: string[] = [];
  let deployed = false;
  const openStorage = async () => {
    storage = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, !initialized);
    initialized = true;
    return storage;
  };
  const backend = async (network: NativeNetworkRegistration, init: RequestInit) => {
        const request = JSON.parse(String(init.body));
        calls.push(request.method);
        let result: unknown;
        if (request.method === 'eth_chainId') result = `0x${BigInt(network.chainId).toString(16)}`;
        else if (request.method === 'eth_getCode') {
          const target = request.params[0].toLowerCase();
          const builtIn = SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES.some(address => address.toLowerCase() === target);
          result = builtIn || deployed && runtime.catalogue.getSnapshot()?.accounts.some(account => account.type === 'SmartAccount' && account.address.toLowerCase() === target) ? '0x01' : '0x';
        }
        else if (request.method === 'eth_getTransactionCount') result = `0x${submitted.length.toString(16)}`;
        else if (request.method === 'eth_getBalance') result = request.params[0].toLowerCase() === runtime.catalogue.getSnapshot()?.accounts.find(account => account.type === 'SmartAccount')?.address.toLowerCase() ? '0x0' : '0x1000000000000000';
        else if (request.method === 'eth_gasPrice') result = '0x2';
        else if (request.method === 'eth_maxPriorityFeePerGas') result = '0x1';
        else if (request.method === 'eth_estimateGas') result = '0x186a0';
        else if (request.method === 'eth_getTransactionReceipt') {
          const raw = submitted.find(raw => Transaction.from(raw).hash === request.params[0]);
          const transaction = raw && Transaction.from(raw);
          result = transaction ? { transactionHash: transaction.hash, from: transaction.from, to: transaction.to, status: '0x1',
            blockNumber: '0x10', blockHash: '0x' + 'aa'.repeat(32) } : null;
        }
        else if (request.method === 'eth_getBlockByNumber') result = { number: '0x10', hash: '0x' + 'aa'.repeat(32), gasLimit: '0x1c9c380', baseFeePerGas: '0x1' };
        else if (request.method === 'eth_sendRawTransaction') {
          const identity = (await storage.recovery.readIdentity())!.root!;
          const saved = await storage.signedRecords.read(identity.profileId);
          assert(saved);
          assert.equal(inspectEvmSignedBundle(saved, identity.profileId).transactions, submitted.length + 1);
          submitted.push(request.params[0]);
          if (submitted.length === 2) deployed = true;
          result = Transaction.from(request.params[0]).hash;
        }
        else if (request.method === 'eth_call') {
          if (request.params[0].to.toLowerCase() !== PALI_CANONICAL_FACTORY_ADDRESS.toLowerCase()) {
            result = coder.encode(['uint256'], [0]);
          } else {
          const parsed = paliSmartAccountFactoryInterface.parseTransaction({ data: request.params[0].data });
          assert(parsed);
          if (parsed.name === 'getInitData') {
            const initCode = coder.encode([`${moduleTuple}[]`, `${moduleTuple}[]`, moduleTuple, `${moduleTuple}[]`],
              [[[parsed.args[0], parsed.args[1]]], [], ['0x' + '00'.repeat(20), '0x'], []]);
            result = paliSmartAccountFactoryInterface.encodeFunctionResult(parsed.fragment, [initCode]);
          } else {
            assert.equal(parsed.name, 'getAddress');
            await hold?.();
            const initializer = new Interface(['function initializeAccount(bytes initCode)']).encodeFunctionData('initializeAccount', [parsed.args[1]]);
            const proxy = concat([PALI_ACCOUNT_PROXY_CREATION_CODE,
              coder.encode(['address', 'bytes'], [PALI_INFRASTRUCTURE_METADATA_BY_ID.accountImplementation.address, initializer])]);
            const address = substituteAddress ? '0x' + 'aa'.repeat(20)
              : getCreate2Address(PALI_CANONICAL_FACTORY_ADDRESS, parsed.args[0], keccak256(proxy));
            result = paliSmartAccountFactoryInterface.encodeFunctionResult(parsed.fragment, [address]);
          }
          }
        } else assert.fail(`Unexpected RPC ${request.method}`);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  const factory = createKeyringRuntimeFactory({
    ensureCryptoReady: async () => undefined, readEvmRetirement: null, openStorage,
    connectionFetch: (_url, init) => backend(getNativeNetwork('ethereum'), init),
    prepareSmartAccount(network, index, owner, signal, guard) {
      return new EvmTransferReadRpc(network, { fetch: (_url, init) => backend(network, init) }).prepareSmartAccount(index, owner, signal, guard);
    },
  });
  const open = async () => {
    const owner = new NativeCustodyAuthority({ async open() { runtime = await factory.open() as KeyringRuntime; return runtime; } });
    await owner.initialize();
    return owner;
  };
  let owner = await open();
  await owner.importPhrase(PHRASE, PASSWORD);
  await runtime.backup.confirm(await runtime.backup.fingerprint());
  await owner.refreshAuthenticatedMetadata();
  return {
    get owner() { return owner; }, get runtime() { return runtime; }, calls, submitted,
    substitute() { substituteAddress = true; }, hold(value: () => Promise<void>) { hold = value; },
    async change(request: Parameters<NativeCustodyAuthority['manageAccounts']>[0]) {
      await owner.manageAccounts(request, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    },
    async selectNetwork(id: string) {
      await owner.selectNetwork(id, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    },
    async inspectRecovery() {
      const binding = (await storage.recovery.readIdentity())!.walletBindingId;
      const record = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
      return { record, accounts: inspectRecoveryCatalogue(record, binding).accounts };
    },
    async resetPassword(password: string) {
      owner.lock();
      const recovery = new NativeRecoveryCoordinator({ owner, async retireControllers() {},
        ensureCryptoReady: async () => undefined, openStorage });
      try {
        const proof = await recovery.prepare(PHRASE, password, () => undefined);
        assert.equal(await recovery.commit(proof), 'committed-locked');
      } finally { await recovery.dispose(); }
      owner = await open();
      await owner.unlock(password);
    },
    async reopen() { await owner.dispose(); owner = await open(); },
    async close() { await owner.dispose(); await rm(directory, { recursive: true, force: true }); },
  };
}

test('real SDK smart account creation, selection and cold unlock retain the original owner and receive address', async () => {
  const f = await fixture();
  try {
    const ownerAddress = f.owner.getSnapshot().account!.address;
    await f.change({ kind: 'create', label: 'Other selected account', password: PASSWORD });
    assert.notEqual(f.owner.getSnapshot().account!.address, ownerAddress);
    await f.change({ kind: 'create-smart', label: 'Smart savings', password: PASSWORD });
    const smart = f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!;
    assert.equal(smart.id, 'smart:60:0');
    assert.equal(smart.smartAccount!.managementAddress.toLowerCase(), ownerAddress.toLowerCase());
    assert.equal(smart.smartAccount!.chainId, 1);
    assert.equal(smart.smartAccount!.isDeployed, false);
    assert.equal(f.owner.getSnapshot().account!.address, smart.address);
    assert.throws(() => f.runtime.transfers!.assertUnlocked(() => undefined), { code: 'NOT_READY' });
    const connection = await f.runtime.openConnectionHost();
    assert.equal(connection.context().accounts.some(account => account.id === smart.id), false);
    await f.change({ kind: 'rename', id: smart.id, label: 'Renamed savings' });
    await f.reopen();
    await f.owner.unlock(PASSWORD);
    assert.equal(f.owner.getSnapshot().account!.address, smart.address);
    assert.equal(f.owner.getCatalogue()!.active.accountId, smart.id);
    assert.equal(f.owner.getCatalogue()!.accounts.find(account => account.id === smart.id)!.label, 'Renamed savings');
    const received: string[] = [];
    const portfolio = new NativePortfolioController(f.owner, { async readBalance(_network, address) { received.push(address); return { chainId: 1, units: '42' }; } });
    const disconnect = portfolio.connect();
    await portfolio.refresh();
    assert.equal(portfolio.getActiveAccount()!.address, smart.address);
    assert(received.every(address => address === smart.address));
    disconnect();
    await f.change({ kind: 'select', id: 'hd:60:0' });
    assert.equal(f.owner.getSnapshot().account!.address, ownerAddress);
    await assert.rejects(f.change({ kind: 'remove', id: 'hd:60:0', password: PASSWORD }), { code: 'ACCOUNT_NOT_REMOVABLE' });
  } finally { await f.close(); }
});

test('a smart account remains selected on its chain and uses shared compatible-account fallback on another chain', async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'Chain account', password: PASSWORD });
    await f.selectNetwork('ethereum');
    assert.equal(f.owner.getCatalogue()!.active.accountId, 'smart:60:0');
    await f.selectNetwork('syscoin-nevm');
    assert.equal(f.owner.getCatalogue()!.active.accountId, 'hd:60:0');
    assert.equal(f.owner.getCatalogue()!.accounts.some(account => account.type === 'SmartAccount'), false);
    await f.selectNetwork('ethereum');
    await f.change({ kind: 'select', id: 'smart:60:0' });
    assert.equal(f.owner.getSnapshot().account!.network, getNativeNetwork('ethereum').id);
  } finally { await f.close(); }
});

test('a substituted factory address cannot create a saved smart account', async () => {
  const f = await fixture();
  try {
    f.substitute();
    await assert.rejects(f.change({ kind: 'create-smart', label: 'Rejected account', password: PASSWORD }));
    await f.owner.unlock(PASSWORD);
    assert.equal(f.owner.getCatalogue()!.accounts.length, 1);
  } finally { await f.close(); }
});

test('lock while the owned factory read is pending prevents creation', async () => {
  const f = await fixture();
  let finish!: () => void, enter!: () => void;
  const reached = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { finish = resolve; });
  try {
    f.hold(async () => { enter(); await held; });
    const creating = f.change({ kind: 'create-smart', label: 'Cancelled account', password: PASSWORD });
    await reached;
    f.owner.lock(); finish();
    await assert.rejects(creating, { code: 'CANCELLED' });
    await f.owner.unlock(PASSWORD);
    assert.equal(f.owner.getCatalogue()!.accounts.length, 1);
  } finally { finish(); await f.close(); }
});


test('recovery lists smart accounts on every saved chain and preserves their metadata through password reset', async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'Ethereum savings', password: PASSWORD });
    await f.selectNetwork('syscoin-nevm');
    await f.change({ kind: 'create-smart', label: 'NEVM savings', password: PASSWORD });
    const before = await f.inspectRecovery();
    const smart = before.accounts.filter(account => account.type === 'SmartAccount');
    assert.deepEqual(smart.map(account => account.smartAccount!.chainId).sort((a, b) => a - b), [1, 57]);
    const smartRecords = (before.record as any).groups[0].accounts.SmartAccount;
    await f.resetPassword('Public replacement smart account password 2!');
    const after = await f.inspectRecovery();
    assert.deepEqual(after.accounts.filter(account => account.type === 'SmartAccount'), smart);
    assert.deepEqual((after.record as any).groups[0].accounts.SmartAccount, smartRecords);
    assert.equal(f.owner.getCatalogue()!.active.accountId, 'smart:60:1');
    assert.equal(f.owner.getSnapshot().account!.address, smart.find(account => account.id === 'smart:60:1')!.address);
    await f.selectNetwork('ethereum');
    await f.change({ kind: 'select', id: 'smart:60:0' });
    assert.equal(f.owner.getSnapshot().account!.address, smart.find(account => account.id === 'smart:60:0')!.address);
  } finally { await f.close(); }
});


test('real smart deployment uses the owned payer, separate consent and durable SDK submission', async () => {
  const f = await fixture();
  let deployment: Awaited<ReturnType<KeyringRuntime['openSmartAccountDeployment']>> | undefined;
  try {
    const owner = f.owner.getSnapshot().account!.address;
    await f.change({ kind: 'create-smart', label: 'Deploy fixture', password: PASSWORD });
    const smart = f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!;
    deployment = await f.runtime.openSmartAccountDeployment(() => undefined);
    await deployment.prepare();
    assert.equal(deployment.getSnapshot().phase, 'authorize');
    assert.equal(f.submitted.length, 0);
    const pending = deployment.authorize(deployment.getSnapshot().revision);
    for (let attempt = 0; attempt < 300 && !['complete', 'failed'].includes(deployment.getSnapshot().phase); attempt++) {
      const state = deployment.getSnapshot();
      if (state.payerReview) deployment.confirmPayer(state.payerReview.id);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await pending;
    assert.equal(deployment.getSnapshot().phase, 'complete', JSON.stringify(deployment.getSnapshot()));
    assert.equal(f.submitted.length, 2);
    const funding = Transaction.from(f.submitted[0]!);
    const execution = Transaction.from(f.submitted[1]!);
    assert.equal(funding.from, owner);
    assert.equal(funding.to, smart.address);
    assert(funding.value > 0n);
    assert.equal(execution.from, owner);
    assert.equal(execution.nonce, funding.nonce + 1);
    assert.equal(f.runtime.catalogue.getSnapshot()!.accounts.find(account => account.id === smart.id)!.smartAccount!.isDeployed, true);
    deployment.dispose(); deployment = undefined;
    await f.reopen();
    await f.owner.unlock(PASSWORD);
    const recovered = f.owner.getCatalogue()!.accounts.find(account => account.id === smart.id)!;
    assert.equal(recovered.address, smart.address);
    assert.equal(recovered.smartAccount!.isDeployed, true);
    assert.equal(recovered.smartAccount!.managementAddress.toLowerCase(), owner.toLowerCase());
  } finally { deployment?.dispose(); await f.close(); }
});


for (const cancel of ['owner', 'lock'] as const) test(`real deployment ${cancel} retirement rejects the held payer review`, async () => {
  const f = await fixture();
  let current = true;
  let deployment: Awaited<ReturnType<KeyringRuntime['openSmartAccountDeployment']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Cancelled deployment', password: PASSWORD });
    deployment = await f.runtime.openSmartAccountDeployment(() => { assert(current, 'owner retired'); });
    await deployment.prepare();
    const pending = deployment.authorize(deployment.getSnapshot().revision);
    for (let attempt = 0; attempt < 300 && !deployment.getSnapshot().payerReview && deployment.getSnapshot().phase !== 'failed'; attempt++)
      await new Promise(resolve => setTimeout(resolve, 5));
    const review = deployment.getSnapshot().payerReview;
    assert(review);
    if (cancel === 'owner') current = false; else f.owner.lock();
    deployment.confirmPayer(review.id);
    await pending;
    assert.equal(deployment.getSnapshot().phase, 'failed');
    assert.equal(f.submitted.length, 0);
  } finally { deployment?.dispose(); await f.close(); }
});
