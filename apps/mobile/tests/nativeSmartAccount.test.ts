import { decodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { getSmartAccountUserOpHash } from '../../../source/utils/smartAccount/userOperationHash.ts';
import { getConfiguredAuthenticatorAddress } from '../../../source/utils/smartAccount/account.ts';
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
import { getPaliEntryPointAddress, paliEntryPointInterface, paliEcdsaValidatorInterface, paliSmartAccountInterface, paliSmartAccountFactoryInterface } from '../../../source/utils/smartAccount/contracts.ts';
import { getZkSysGasTankAddress, PALI_ACCOUNT_PROXY_CREATION_CODE, PALI_CANONICAL_FACTORY_ADDRESS, PALI_INFRASTRUCTURE_METADATA_BY_ID } from '../../../source/utils/smartAccount/deploymentMetadata.ts';
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
  let deployedCode = '0x01';
  let readReceipts = true;
  let userOperationSuccess = true;
  let nonceReset = false;
  let blockedRecipient = false;
  let smartBalance = '0x0';
  let payerBalance = '0x1000000000000000';
  let gasCredit = 0n;
  let interruptAfterReceipt = false;
  let smartCodeRead: (() => void) | undefined;
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
          const smartTarget = runtime.catalogue.getSnapshot()?.accounts.some(account => account.type === 'SmartAccount' && account.address.toLowerCase() === target);
          result = builtIn ? '0x01' : deployed && smartTarget ? deployedCode : '0x';
          if (smartTarget) {
            smartCodeRead?.();
            if (deployed && interruptAfterReceipt) {
              interruptAfterReceipt = false;
              owner.lock();
            }
          }
        }
        else if (request.method === 'eth_getTransactionCount') result = nonceReset ? '0x0' : `0x${submitted.length.toString(16)}`;
        else if (request.method === 'eth_getBalance') result = request.params[0].toLowerCase() === runtime.catalogue.getSnapshot()?.accounts.find(account => account.type === 'SmartAccount')?.address.toLowerCase() ? smartBalance : payerBalance;
        else if (request.method === 'eth_gasPrice') result = '0x2';
        else if (request.method === 'eth_maxPriorityFeePerGas') result = '0x1';
        else if (request.method === 'eth_estimateGas') result = '0x186a0';
        else if (request.method === 'eth_getTransactionReceipt') {
          const raw = submitted.find(raw => Transaction.from(raw).hash === request.params[0]);
          const transaction = raw ? Transaction.from(raw) : undefined;
          let logs: unknown[] = [];
          if (transaction?.to === getPaliEntryPointAddress(Number(network.chainId))) {
            const [operations] = paliEntryPointInterface.decodeFunctionData('handleOps', transaction.data);
            const op = operations[0];
            const operation = { sender: op.sender, nonce: op.nonce.toString(), initCode: op.initCode, callData: op.callData,
              accountGasLimits: op.accountGasLimits, preVerificationGas: op.preVerificationGas.toString(), gasFees: op.gasFees,
              paymasterAndData: op.paymasterAndData, signature: op.signature };
            const event = paliEntryPointInterface.encodeEventLog(paliEntryPointInterface.getEvent('UserOperationEvent')!,
              [getSmartAccountUserOpHash(operation, Number(network.chainId)), op.sender, '0x' + '00'.repeat(20), op.nonce, userOperationSuccess, 100, 50]);
            logs = [{ ...event, address: transaction.to, transactionHash: transaction.hash,
              blockHash: '0x' + 'aa'.repeat(32), blockNumber: '0x10' }];
          }
          result = transaction && readReceipts ? { transactionHash: transaction.hash, from: transaction.from, to: transaction.to, status: '0x1',
            blockNumber: '0x10', blockHash: '0x' + 'aa'.repeat(32), logs } : null;
        }
        else if (request.method === 'eth_getBlockByNumber') result = { number: '0x10', hash: '0x' + 'aa'.repeat(32), gasLimit: '0x1c9c380', baseFeePerGas: '0x1' };
        else if (request.method === 'eth_sendRawTransaction') {
          const identity = (await storage.recovery.readIdentity())!.root!;
          const saved = await storage.signedRecords.read(identity.profileId);
          assert(saved);
          assert.equal(inspectEvmSignedBundle(saved, identity.profileId).transactions, submitted.length + 1);
          submitted.push(request.params[0]);
          if (Transaction.from(request.params[0]).to === getPaliEntryPointAddress(Number(network.chainId))) deployed = true;
          result = Transaction.from(request.params[0]).hash;
        }
        else if (request.method === 'eth_call') {
          const to = request.params[0].to.toLowerCase();
          const data = request.params[0].data;
          const smartAddress = runtime.catalogue.getSnapshot()?.accounts.find(account => account.type === 'SmartAccount')?.address.toLowerCase();
          if (to === getZkSysGasTankAddress(Number(network.chainId))?.toLowerCase()) {
            result = coder.encode(['uint256'], [gasCredit]);
          } else if (to === smartAddress && data.startsWith(paliSmartAccountInterface.getFunction('isModuleInstalled')!.selector)) {
            const args = paliSmartAccountInterface.decodeFunctionData('isModuleInstalled', data);
            result = paliSmartAccountInterface.encodeFunctionResult('isModuleInstalled', [args[1].toLowerCase() === getConfiguredAuthenticatorAddress(Number(network.chainId), 'ecdsa').toLowerCase()]);
          } else if (to === smartAddress && data.startsWith(paliSmartAccountInterface.getFunction('activeValidator')!.selector)) {
            result = paliSmartAccountInterface.encodeFunctionResult('activeValidator', [getConfiguredAuthenticatorAddress(Number(network.chainId), 'ecdsa')]);
          } else if (to === getConfiguredAuthenticatorAddress(Number(network.chainId), 'ecdsa').toLowerCase() && data.startsWith(paliEcdsaValidatorInterface.getFunction('owners')!.selector)) {
            const ownerAddress = runtime.catalogue.getSnapshot()!.accounts.find(account => account.id === 'hd:60:0')!.address;
            result = paliEcdsaValidatorInterface.encodeFunctionResult('owners', [[ownerAddress]]);
          } else if (to === getConfiguredAuthenticatorAddress(Number(network.chainId), 'ecdsa').toLowerCase() && data.startsWith(paliEcdsaValidatorInterface.getFunction('threshold')!.selector)) {
            result = paliEcdsaValidatorInterface.encodeFunctionResult('threshold', [1]);
          } else if (to !== PALI_CANONICAL_FACTORY_ADDRESS.toLowerCase()) {
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
    checkSmartAccountAddress: async () => ({ isBlacklisted: blockedRecipient, severity: 'high' }),
    ensureCryptoReady: async () => undefined, readEvmRetirement: null, openStorage,
    connectionFetch: (_url, init) => backend(getNativeNetwork(runtime.catalogue.getSnapshot()?.active.networkId ?? 'ethereum'), init),
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
    gasSponsored() { payerBalance = '0x0'; gasCredit = 10n ** 20n; },
    loseGasCredit() { gasCredit = 0n; },
    fundedSmart() { smartBalance = '0x1000000000000000'; },
    holdReceipts() { readReceipts = false; },
    showReceipts(success = true) { readReceipts = true; userOperationSuccess = success; },
    reorg() { readReceipts = false; nonceReset = true; },
    blockRecipient() { blockedRecipient = true; },
    undeployed() { deployed = false; },
    deployed(code = '0x01') { deployed = true; deployedCode = code; },
    interruptAfterReceipt() { interruptAfterReceipt = true; },
    onSmartCodeRead(hook: () => void) { smartCodeRead = hook; },
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
    async removeCompletedJournalBytes() {
      await owner.dispose();
      const retired = nodeConnection(file);
      try { await retired.connection.runAsync('DELETE FROM evm_signed_records'); }
      finally { await retired.connection.closeAsync(); }
      owner = await open(); await owner.unlock(PASSWORD);
    },
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

for (const failure of [null, 'invalid-code', 'owner-loss'] as const)
  test(`existing smart deployment refreshes without signing (${failure ?? 'healthy'})`, async () => {
    const f = await fixture();
    let current = true;
    let deployment: Awaited<ReturnType<KeyringRuntime['openSmartAccountDeployment']>> | undefined;
    try {
      await f.change({ kind: 'create-smart', label: 'Existing deployment', password: PASSWORD });
      const before = f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!;
      f.deployed(failure === 'invalid-code' ? '0x0' : '0x6000');
      if (failure === 'owner-loss') f.onSmartCodeRead(() => { current = false; });
      const reads = f.calls.length;
      deployment = await f.runtime.openSmartAccountDeployment(() => { assert(current, 'Owner ended'); });
      await deployment.prepare();
      assert.equal(deployment.getSnapshot().phase, failure ? 'failed' : 'complete');
      assert.equal(deployment.getSnapshot().transactionHash, null);
      assert.equal(deployment.getSnapshot().maximumPrefundUnits, null);
      assert.equal(f.submitted.length, 0);
      assert.equal(f.calls.slice(reads).some(method => ['eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionCount', 'eth_sendRawTransaction'].includes(method)), false);
      const after = f.owner.getCatalogue()!.accounts.find(account => account.id === before.id)!;
      assert.deepEqual(after.smartAccount, { ...before.smartAccount, isDeployed: !failure });
      if (!failure) {
        deployment.dispose(); deployment = undefined;
        await f.reopen(); await f.owner.unlock(PASSWORD);
        assert.deepEqual(f.owner.getCatalogue()!.accounts.find(account => account.id === before.id)!.smartAccount, after.smartAccount);
      }
    } finally { deployment?.dispose(); await f.close(); }
  });

test('restart after the deployment receipt refreshes metadata without another transaction', async () => {
  const f = await fixture();
  let deployment: Awaited<ReturnType<KeyringRuntime['openSmartAccountDeployment']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Interrupted deployment', password: PASSWORD });
    const smartId = f.owner.getCatalogue()!.active.accountId;
    deployment = await f.runtime.openSmartAccountDeployment(() => undefined);
    await deployment.prepare();
    f.interruptAfterReceipt();
    const pending = deployment.authorize(deployment.getSnapshot().revision);
    for (let attempt = 0; attempt < 300 && !['complete', 'failed'].includes(deployment.getSnapshot().phase); attempt++) {
      const review = deployment.getSnapshot().payerReview;
      if (review) deployment.confirmPayer(review.id);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await pending;
    assert.equal(deployment.getSnapshot().phase, 'failed');
    assert.equal(f.submitted.length, 2);
    deployment.dispose();
    await f.reopen(); await f.owner.unlock(PASSWORD);
    assert.equal(f.owner.getCatalogue()!.accounts.find(account => account.id === smartId)!.smartAccount!.isDeployed, false);
    deployment = await f.runtime.openSmartAccountDeployment(() => undefined);
    await deployment.prepare();
    assert.equal(deployment.getSnapshot().phase, 'complete');
    assert.equal(deployment.getSnapshot().transactionHash, null);
    assert.equal(f.submitted.length, 2);
    assert.equal(f.owner.getCatalogue()!.accounts.find(account => account.id === smartId)!.smartAccount!.isDeployed, true);
  } finally { deployment?.dispose(); await f.close(); }
});


for (const alreadyDeployed of [false, true]) test(`real SDK smart native send authorizes exact value and submits without waiting (${alreadyDeployed ? 'deployed' : 'counterfactual'})`, async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    const payer = f.owner.getSnapshot().account!.address;
    await f.change({ kind: 'create-smart', label: 'Smart sender', password: PASSWORD });
    const smart = f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!;
    f.fundedSmart(); f.holdReceipts();
    if (alreadyDeployed) f.deployed();
    const recipient = '0x2222222222222222222222222222222222222222';
    operation = await f.runtime.openSmartAccountSend(recipient, { kind: 'exact', amount: '0.000000000000000009' }, () => undefined);
    await operation.prepare();
    const ready = operation.getSnapshot();
    assert.equal(ready.phase, 'authorize', JSON.stringify(ready));
    assert.deepEqual(ready.intent, { kind: 'native-transfer', recipient, amountUnits: '9' });
    assert.equal(f.submitted.length, 0);
    assert.equal(ready.authorization!.initCode === '0x', alreadyDeployed);
    const pending = operation.authorize(ready.revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    const review = operation.getSnapshot().payerReview;
    assert(review, JSON.stringify(operation.getSnapshot()));
    assert.equal(review.transaction.from, payer);
    assert.equal(review.purpose, 'submit-operation');
    assert.equal(f.submitted.length, 0);
    operation.confirmPayer(review.id);
    await pending;
    assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
    assert.equal(f.submitted.length, 1);
    const outer = Transaction.from(f.submitted[0]!);
    assert.equal(outer.from, payer);
    assert.equal(outer.value, 0n);
    const entryPoint = new Interface(['function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)']);
    const [ops] = entryPoint.decodeFunctionData('handleOps', outer.data);
    assert.equal(ops[0].sender, smart.address);
    assert.equal(ops[0].callData, ready.authorization!.callData);
    const [, execution] = paliSmartAccountInterface.decodeFunctionData('execute', ops[0].callData);
    assert.equal('0x' + execution.slice(2, 42), recipient);
    assert.equal(BigInt('0x' + execution.slice(42, 106)), 9n);
    assert.equal(f.calls.includes('eth_getTransactionReceipt'), false);
  } finally { operation?.dispose(); await f.close(); }
});

test('smart native sends reject invalid input and blocked recipients before authorizing', async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Smart sender', password: PASSWORD });
    for (const [recipient, amount] of [['bad', '1'], ['0x2222222222222222222222222222222222222222', '1e2'], ['0x2222222222222222222222222222222222222222', '0']])
      await assert.rejects(f.runtime.openSmartAccountSend(recipient!, { kind: 'exact', amount: amount! }, () => undefined), { code: 'INVALID_INPUT' });
    f.blockRecipient();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '1' }, () => undefined);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(operation.getSnapshot().authorization, null);
    assert.equal(f.submitted.length, 0);
  } finally { operation?.dispose(); await f.close(); }
});


test('locking a native Smart send at payer review retires its signed operation without broadcasting', async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Smart sender', password: PASSWORD });
    f.fundedSmart();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.01' }, () => undefined);
    await operation.prepare();
    const pending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    const payer = operation.getSnapshot().payerReview;
    assert(payer);
    f.owner.lock();
    operation.confirmPayer(payer.id);
    await pending;
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(f.submitted.length, 0);
  } finally { operation?.dispose(); await f.close(); }
});


test('fresh absent code overrides saved deployed metadata for a Smart send', async () => {
  const f = await fixture();
  let deployment: Awaited<ReturnType<KeyringRuntime['openSmartAccountDeployment']>> | undefined;
  let send: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Reorg fixture', password: PASSWORD });
    f.deployed();
    deployment = await f.runtime.openSmartAccountDeployment(() => undefined);
    await deployment.prepare();
    assert.equal(deployment.getSnapshot().phase, 'complete');
    assert.equal(f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!.smartAccount!.isDeployed, true);
    deployment.dispose(); deployment = undefined;
    f.undeployed(); f.fundedSmart();
    send = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.1' }, () => undefined);
    await send.prepare();
    assert.equal(send.getSnapshot().phase, 'authorize', JSON.stringify(send.getSnapshot()));
    assert.notEqual(send.getSnapshot().authorization!.initCode, '0x');
    assert.equal(f.submitted.length, 0);
  } finally { send?.dispose(); deployment?.dispose(); await f.close(); }
});


for (const loseCredit of [false, true]) test(`gas-tank deployment with zero payer balance preserves fee coverage (${loseCredit ? 'credit-lost' : 'funded'})`, async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountDeployment']>> | undefined;
  try {
    await f.selectNetwork('zksys-testnet');
    await f.change({ kind: 'create-smart', label: 'Sponsored smart account', password: PASSWORD });
    f.gasSponsored();
    operation = await f.runtime.openSmartAccountDeployment(() => undefined);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize', JSON.stringify(operation.getSnapshot()));
    const sending = operation.authorize(operation.getSnapshot().revision);
    for (let attempt = 0; attempt < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; attempt++)
      await new Promise(resolve => setTimeout(resolve, 5));
    const payer = operation.getSnapshot().payerReview;
    assert(payer, JSON.stringify(operation.getSnapshot()));
    assert.equal(payer.coveredFeeUnits, payer.maximumFeeUnits);
    assert.equal(payer.maximumTotalUnits, '0');
    if (loseCredit) f.loseGasCredit();
    operation.confirmPayer(payer.id);
    await sending;
    assert.equal(operation.getSnapshot().phase, loseCredit ? 'failed' : 'complete', JSON.stringify(operation.getSnapshot()));
    assert.equal(f.submitted.length, loseCredit ? 0 : 1);
  } finally { operation?.dispose(); await f.close(); }
});


for (const success of [true, false]) test(`Smart Activity survives reopen and displays the inner ${success ? 'success' : 'revert'}`, async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    const payer = f.owner.getSnapshot().account!.address;
    await f.change({ kind: 'create-smart', label: 'Activity sender', password: PASSWORD });
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined);
    await operation.prepare();
    const sending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview; i++) await new Promise(resolve => setTimeout(resolve, 5));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id);
    await sending;
    assert.equal(operation.getSnapshot().phase, 'complete');
    operation.dispose();
    await f.reopen(); await f.owner.unlock(PASSWORD);
    const loaded = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.equal(loaded.locals.length, 1);
    const row = loaded.locals[0]!;
    assert.equal(row.hash, Transaction.from(f.submitted[0]!).hash);
    assert.equal(row.amountUnits, '9');
    assert.equal(row.recipient, '0x2222222222222222222222222222222222222222');
    assert.equal(row.smartAccount?.payer?.toLowerCase(), payer.toLowerCase());
    assert.equal(row.inspectionOnly, true);
    assert.equal(row.speedUpEligible, undefined);
    await f.change({ kind: 'select', id: 'hd:60:0' });
    const payerBefore = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    await f.change({ kind: 'select', id: 'smart:60:0' });
    f.showReceipts(success);
    const observed = await f.runtime.activity!.observeLocal!(row, () => undefined, new AbortController().signal);
    assert.equal(observed.status === 'mined' && observed.outcome, success ? 'confirmed' : 'reverted');
    const archived = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.equal(archived.locals[0]!.phase, success ? 'confirmed' : 'reverted');
    const pendingPage = await f.runtime.activity!.loadSavedPending!(archived.scope, undefined, () => undefined);
    assert.equal(pendingPage.records.length, 0);
    // Observing the inner operation must not rewrite the outer payer's retained phase.
    await f.change({ kind: 'select', id: 'hd:60:0' });
    const payerView = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.equal(payerView.locals[0]!.phase, payerBefore.locals[0]!.phase);
    await f.change({ kind: 'select', id: 'smart:60:0' });
    f.reorg();
    const missing = await f.runtime.activity!.observeLocal!(row, () => undefined, new AbortController().signal);
    assert.equal(missing.status, 'missing');
    const pending = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.equal(pending.locals[0]!.phase, 'submitted');
    assert.equal(pending.saved.archived[0]!.phase, 'submitted');
    f.showReceipts(success);
    await f.runtime.activity!.observeLocal!(row, () => undefined, new AbortController().signal);
    await f.removeCompletedJournalBytes();
    const retired = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.equal(retired.locals.length, 0);
    const archivedRow = retired.saved.archived[0]!;
    assert.equal(archivedRow.smartAccount?.operationHash, row.smartAccount?.operationHash);
    const checkedAgain = await f.runtime.activity!.observeLocal!(archivedRow, () => undefined, new AbortController().signal);
    assert.equal(checkedAgain.status === 'mined' && checkedAgain.outcome, success ? 'confirmed' : 'reverted');
    f.reorg();
    assert.equal((await f.runtime.activity!.observeLocal!(archivedRow, () => undefined, new AbortController().signal)).status, 'missing');
    await f.reopen(); await f.owner.unlock(PASSWORD);
    const afterRestart = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.equal(afterRestart.saved.archived[0]!.phase, 'submitted');
    assert.equal(afterRestart.saved.archived[0]!.smartAccount!.operationHash, row.smartAccount!.operationHash);
  } finally { operation?.dispose(); await f.close(); }
});


for (const sponsored of [false, true]) test(`Smart native MAX uses the shared reserve and exact final approval (${sponsored ? 'gas credit' : 'payer fees'})`, async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    if (sponsored) await f.selectNetwork('zksys-testnet');
    await f.change({ kind: 'create-smart', label: 'MAX sender', password: PASSWORD });
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    if (sponsored) f.gasSponsored();
    const recipient = '0x2222222222222222222222222222222222222222';
    operation = await f.runtime.openSmartAccountSend(recipient, { kind: 'maximum' }, () => undefined);
    await operation.prepare();
    const ready = operation.getSnapshot();
    assert.equal(ready.phase, 'authorize', JSON.stringify(ready));
    assert.equal(ready.intent.kind, 'native-transfer');
    if (ready.intent.kind !== 'native-transfer') assert.fail('MAX did not resolve to an exact transfer');
    const expected = BigInt('0x1000000000000000') - BigInt(ready.maximumPrefundUnits!) - 1000000000000n;
    assert.equal(ready.intent.amountUnits, expected.toString());
    assert.equal(f.submitted.length, 0);
    const sending = operation.authorize(ready.revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const payer = operation.getSnapshot().payerReview!;
    assert(payer, JSON.stringify(operation.getSnapshot()));
    operation.confirmPayer(payer.id);
    await sending;
    assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
    const [operations] = paliEntryPointInterface.decodeFunctionData('handleOps', Transaction.from(f.submitted[0]!).data);
    const [, execution] = paliSmartAccountInterface.decodeFunctionData('execute', operations[0].callData);
    assert.equal(BigInt('0x' + execution.slice(42, 106)), expected);
    assert.equal(ready.maximumPrefundUnits === '0', sponsored);
  } finally { operation?.dispose(); await f.close(); }
});


test('Smart ERC20 send preserves 255-decimal base units through approval, signing and Activity', async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Token sender', password: PASSWORD });
    const metadata = { contractAddress: '0x5555555555555555555555555555555555555555', decimals: 255, name: 'Exact token', symbol: 'EXACT' };
    const registry = await f.runtime.tokens!.load(() => undefined);
    await f.runtime.tokens!.add(registry.revision, metadata, () => undefined);
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    const recipient = '0x2222222222222222222222222222222222222222';
    operation = await f.runtime.openSmartAccountSend(recipient, { kind: 'erc20', contractAddress: metadata.contractAddress,
      amount: '0.' + '0'.repeat(254) + '9' }, () => undefined);
    await operation.prepare();
    const ready = operation.getSnapshot();
    assert.equal(ready.phase, 'authorize', JSON.stringify(ready));
    assert.equal(ready.intent.kind, 'erc20-transfer');
    if (ready.intent.kind !== 'erc20-transfer') assert.fail('Not an ERC20 review');
    assert.equal(ready.intent.amountUnits, '9');
    assert.deepEqual(ready.intent.token, metadata);
    assert.equal(f.submitted.length, 0);
    const sending = operation.authorize(ready.revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview; i++) await new Promise(resolve => setTimeout(resolve, 5));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id);
    await sending;
    assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
    const [ops] = paliEntryPointInterface.decodeFunctionData('handleOps', Transaction.from(f.submitted[0]!).data);
    const [, payload] = paliSmartAccountInterface.decodeFunctionData('execute', ops[0].callData);
    assert.equal('0x' + payload.slice(2, 42), metadata.contractAddress);
    assert.equal(BigInt('0x' + payload.slice(42, 106)), 0n);
    assert.deepEqual(decodeErc20Transfer('0x' + payload.slice(106)), { recipient, amountUnits: '9' });
    operation.dispose(); await f.reopen(); await f.owner.unlock(PASSWORD);
    const activity = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.equal(activity.locals[0]!.amountUnits, '9');
    assert.deepEqual(activity.locals[0]!.token, metadata);
    assert.equal(activity.locals[0]!.recipient, recipient);
    f.showReceipts();
    const observed = await f.runtime.activity!.observeLocal!(activity.locals[0]!, () => undefined, new AbortController().signal);
    assert.equal(observed.status === 'mined' && observed.outcome, 'confirmed');
    const saved = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.deepEqual(saved.saved.archived[0]!.token, metadata);
  } finally { operation?.dispose(); await f.close(); }
});

test('Smart ERC20 send requires the selected account owned token catalogue', async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'Token sender', password: PASSWORD });
    await assert.rejects(f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', {
      kind: 'erc20', contractAddress: '0x5555555555555555555555555555555555555555', amount: '1',
    }, () => undefined), { code: 'NOT_READY' });
    assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});
