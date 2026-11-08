import type { NativeSmartAccountOperation } from '../src/smartAccount/operation.ts';
import { createDappSigningApproval } from '../../../source/wallet/dappSigningApproval.ts';
import { decodeNftSafeTransferData } from '../../../source/shared/nftTransfer.ts';
import { decodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { getSmartAccountUserOpHash } from '../../../source/utils/smartAccount/userOperationHash.ts';
import { getConfiguredAuthenticatorAddress } from '../../../source/utils/smartAccount/account.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AbiCoder, Interface } from 'ethers/abi';
import { Transaction, recoverAddress } from 'ethers/transaction';
import { inspectEvmSignedBundle } from '../../../source/wallet/evmSignedRecords.ts';
import type { NativeNetworkRegistration } from '../src/custody/networkContext.ts';
import { getCreate2Address } from 'ethers/address';
import { keccak256 } from 'ethers/crypto';
import { concat, getBytes, hexlify } from 'ethers/utils';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { NativeRecoveryCoordinator } from '../src/custody/recovery.ts';
import { inspectRecoveryCatalogue, NativeWalletCatalogue, WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import { NativePortfolioController } from '../src/portfolio/nativePortfolio.ts';
import { digest, INSTALLATION, nodeConnection, type SqlHook } from './storageHelpers.ts';
import { createGuardianRecoveryFixture } from './native-watch-ui/guardianRecoveryFixture.ts';
import { GUARDIAN_FIXTURE_RUNTIME } from './guardianRecoveryRuntime.ts';
import { importedKeyIdentity } from '../src/custody/importedAccounts.ts';
import { getPaliEntryPointAddress, paliEntryPointInterface, paliEcdsaValidatorInterface, paliSmartAccountInterface, paliSmartAccountFactoryInterface, paliGuardianRecoveryModuleInterface } from '../../../source/utils/smartAccount/contracts.ts';
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

async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}, recordSignatures = false) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-smart-account-test-'));
  const file = path.join(directory, 'wallet.sqlite');
  let initialized = false, substituteAddress = false, hold: (() => Promise<void>) | undefined;
  let runtime!: KeyringRuntime;
  let storage!: SqliteWalletStorage;
  const calls: string[] = [];
  const signatures: { address: string; digest: string; signature: string; intentPersisted: boolean }[] = [];
  const submitted: string[] = [];
  let deployed = false;
  let deployedCode = '0x01';
  let readReceipts = true;
  let userOperationSuccess = true;
  let nonceReset = false;
  let deployedByBroadcast = false;
  let externalSmartNonce = 0n;
  let wrongChain = false;
  let blockedRecipient = false;
  let smartBalance = '0x0';
  let payerBalance = '0x1000000000000000';
  let gasCredit = 0n;
  let interruptAfterReceipt = false;
  let smartCodeRead: (() => void) | undefined;
  let afterBroadcast: (() => void) | undefined;
  let guardian: ReturnType<typeof createGuardianRecoveryFixture> | undefined;
  let externalOwner = false;
  let recoveredOwner: string | undefined;
  const openStorage = async () => {
    storage = await SqliteWalletStorage.open(nodeConnection(file, hooks).connection, digest, INSTALLATION, !initialized);
    initialized = true;
    return storage;
  };
  const backend = async (network: NativeNetworkRegistration, init: RequestInit) => {
        const request = JSON.parse(String(init.body));
        calls.push(request.method);
        const guardianModule = getConfiguredAuthenticatorAddress(Number(network.chainId), 'guardian-recovery').toLowerCase();
        if (guardian && (request.method === 'eth_getBlockByNumber' && ['latest', '0x20'].includes(request.params[0]) || request.method === 'eth_getStorageAt' ||
            request.method === 'eth_getCode' && request.params[0].toLowerCase() === guardianModule && request.params[1] === '0x20' ||
            request.method === 'eth_call' && (request.params[0].to.toLowerCase() === guardianModule ||
              request.params[1] === '0x20' && request.params[0].data.startsWith(paliSmartAccountInterface.getFunction('isModuleInstalled')!.selector)))) {
          const response = await guardian.fetch(network.rpcUrl, init);
          assert(response); return response;
        }
        let result: unknown;
        if (request.method === 'eth_chainId') result = wrongChain ? '0x2' : `0x${BigInt(network.chainId).toString(16)}`;
        else if (request.method === 'eth_getCode') {
          const target = request.params[0].toLowerCase();
          const builtIn = SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES.some(address => address.toLowerCase() === target);
          const smartTarget = runtime.catalogue.getSnapshot()?.accounts.some(account => account.type === 'SmartAccount' && account.address.toLowerCase() === target);
          result = builtIn ? '0x01' : deployed && smartTarget && (!deployedByBroadcast || request.params[1] === 'pending' || readReceipts) ? deployedCode : '0x';
          if (smartTarget) {
            smartCodeRead?.();
            if (deployed && interruptAfterReceipt) {
              interruptAfterReceipt = false;
              owner.lock();
            }
          }
        }
        else if (request.method === 'eth_getTransactionCount') result = nonceReset ? '0x0' : `0x${(request.params[1] === 'pending' || readReceipts ? submitted.length : 0).toString(16)}`;
        else if (request.method === 'eth_getBalance') result = request.params[0].toLowerCase() === runtime.catalogue.getSnapshot()?.accounts.find(account => account.type === 'SmartAccount')?.address.toLowerCase() ? smartBalance : payerBalance;
        else if (request.method === 'eth_gasPrice') result = '0x2';
        else if (request.method === 'eth_maxPriorityFeePerGas') result = '0x1';
        else if (request.method === 'eth_estimateGas') {
          const call = request.params[0];
          if (call.to?.toLowerCase() === getPaliEntryPointAddress(Number(network.chainId)).toLowerCase()) {
            const [operations] = paliEntryPointInterface.decodeFunctionData('handleOps', call.data);
            for (const op of operations) {
              const earlier = submitted.filter(raw => Transaction.from(raw).to === getPaliEntryPointAddress(Number(network.chainId))).length;
              const sequence = request.params[1] === 'pending' || readReceipts ? earlier : 0;
              assert.equal(op.nonce & ((1n << 64n) - 1n), BigInt(sequence) + externalSmartNonce, 'handleOps must estimate against matching pending state');
            }
          }
          result = '0x186a0';
        }
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
            blockNumber: '0x10', blockHash: '0x' + 'aa'.repeat(32), gasUsed: '0x186a0', logs } : null;
        }
        else if (request.method === 'eth_getBlockByNumber') result = { number: '0x10', hash: '0x' + 'aa'.repeat(32), gasLimit: '0x1c9c380', baseFeePerGas: '0x1' };
        else if (request.method === 'eth_sendRawTransaction') {
          const identity = (await storage.recovery.readIdentity())!.root!;
          const saved = await storage.signedRecords.read(identity.profileId);
          assert(saved);
          assert.equal(inspectEvmSignedBundle(saved, identity.profileId).transactions, submitted.length + 1);
          submitted.push(request.params[0]);
          if (Transaction.from(request.params[0]).to === getPaliEntryPointAddress(Number(network.chainId))) { if (!deployed) deployedByBroadcast = true; deployed = true; }
          result = Transaction.from(request.params[0]).hash;
          afterBroadcast?.();
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
            result = paliEcdsaValidatorInterface.encodeFunctionResult('owners', [[recoveredOwner ?? (externalOwner ? '0x' + '66'.repeat(20) : ownerAddress)]]);
          } else if (to === getConfiguredAuthenticatorAddress(Number(network.chainId), 'ecdsa').toLowerCase() && data.startsWith(paliEcdsaValidatorInterface.getFunction('threshold')!.selector)) {
            result = paliEcdsaValidatorInterface.encodeFunctionResult('threshold', [1]);
          } else if (to === getPaliEntryPointAddress(Number(network.chainId)).toLowerCase() && data.startsWith(paliEntryPointInterface.getFunction('getNonce')!.selector)) {
            assert.equal(request.params[1], 'pending');
            const [sender, key] = paliEntryPointInterface.decodeFunctionData('getNonce', data);
            const matching = submitted.flatMap(raw => {
              const tx = Transaction.from(raw);
              if (tx.to !== getPaliEntryPointAddress(Number(network.chainId))) return [];
              const [operations] = paliEntryPointInterface.decodeFunctionData('handleOps', tx.data);
              return [...operations].filter(op => op.sender.toLowerCase() === sender.toLowerCase() && (op.nonce >> BigInt(64)) === key);
            });
            result = coder.encode(['uint256'], [(key << BigInt(64)) + BigInt(matching.length) + externalSmartNonce]);
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
    ...(recordSignatures ? { loadSdk: async () => {
      const sdk = await loadNativeKeyringSdk();
      const Base = sdk.HostKeyring;
      return { ...sdk, HostKeyring: class extends Base {
        constructor(...args: ConstructorParameters<typeof Base>) {
          super(...args);
          const original = this.ethereumTransaction.ethSign.bind(this.ethereumTransaction);
          this.ethereumTransaction.ethSign = async (...input: Parameters<typeof original>) => {
            const saved = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as { guardianRecoveryIntents?: unknown[] };
            const signature = await original(...input);
            signatures.push({ address: input[0][0]!, digest: input[0][1]!, signature, intentPersisted: !!saved.guardianRecoveryIntents?.length });
            return signature;
          };
        }
      } };
    } } : {}),
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
    get owner() { return owner; }, get runtime() { return runtime; }, get storage() { return storage; }, calls, submitted, signatures,
    guardianStatus(mode: Parameters<ReturnType<typeof createGuardianRecoveryFixture>['select']>[0] = 'healthy') {
      const address = runtime.catalogue.getSnapshot()!.accounts.find(account => account.type === 'SmartAccount')!.address;
      guardian = createGuardianRecoveryFixture(address);
      guardian.select(mode, GUARDIAN_FIXTURE_RUNTIME);
      deployed = true;
      return guardian;
    },
    externalOwner() { externalOwner = true; },
    recoveredOwner(address: string) { recoveredOwner = address; },
    gasSponsored() { payerBalance = '0x0'; gasCredit = 10n ** 20n; },
    loseGasCredit() { gasCredit = 0n; },
    wrongChain() { wrongChain = true; },
    advanceSmartNonce() { externalSmartNonce++; },
    fundedSmart() { smartBalance = '0x1000000000000000'; },
    holdReceipts() { readReceipts = false; },
    showReceipts(success = true) { readReceipts = true; userOperationSuccess = success; },
    reorg() { readReceipts = false; nonceReset = true; },
    blockRecipient() { blockedRecipient = true; },
    undeployed() { deployed = false; },
    deployed(code = '0x01') { deployed = true; deployedCode = code; guardian = undefined; },
    interruptAfterReceipt() { interruptAfterReceipt = true; },
    onSmartCodeRead(hook: () => void) { smartCodeRead = hook; },
    onBroadcast(hook: () => void) { afterBroadcast = hook; },
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
    async reopenQuarantined() {
      await owner.dispose().catch(error => { assert.equal(error.code, 'CLEANUP_FAILED'); });
      owner = await open();
    },
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
    assert.equal(connection.context().accounts.some(account => account.id === smart.id), true);
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


for (const standard of ['ERC-721', 'ERC-1155'] as const) test(`Smart ${standard} uses the shared safe transfer and retains inner failure after restart`, async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Collectible sender', password: PASSWORD });
    const smart = f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!;
    const contractAddress = '0x5555555555555555555555555555555555555555', tokenId = ((1n << 256n) - 1n).toString();
    const collectible = standard === 'ERC-721' ? { contractAddress, tokenStandard: standard } : { contractAddress, tokenStandard: standard, tokenId };
    const registry = await f.runtime.tokens!.load(() => undefined);
    await f.runtime.tokens!.addCollectible!(registry.revision, collectible, () => undefined);
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    const recipient = '0x2222222222222222222222222222222222222222';
    const amountUnits = standard === 'ERC-721' ? '1' : '900719925474099312345';
    operation = await f.runtime.openSmartAccountSend(recipient, { kind: 'nft', collectible, tokenId, amountUnits }, () => undefined);
    await operation.prepare();
    const ready = operation.getSnapshot();
    assert.equal(ready.phase, 'authorize', JSON.stringify(ready));
    assert.equal(ready.intent.kind, 'nft-transfer');
    if (ready.intent.kind !== 'nft-transfer') assert.fail('Missing NFT intent');
    assert.equal(ready.intent.from, smart.address);
    assert.equal(ready.intent.tokenId, tokenId);
    assert.equal(ready.intent.amountUnits, amountUnits);
    const sending = operation.authorize(ready.revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview; i++) await new Promise(resolve => setTimeout(resolve, 5));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id); await sending;
    assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
    const [ops] = paliEntryPointInterface.decodeFunctionData('handleOps', Transaction.from(f.submitted[0]!).data);
    const [, execution] = paliSmartAccountInterface.decodeFunctionData('execute', ops[0].callData);
    assert.equal('0x' + execution.slice(2, 42), contractAddress);
    assert.deepEqual(decodeNftSafeTransferData('0x' + execution.slice(106), ready.intent), ready.intent);
    operation.dispose(); await f.reopen(); await f.owner.unlock(PASSWORD);
    const activity = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.deepEqual(activity.locals[0]!.collectibleTransfer, ready.intent);
    f.showReceipts(false);
    const observed = await f.runtime.activity!.observeLocal!(activity.locals[0]!, () => undefined, new AbortController().signal);
    assert.equal(observed.status === 'mined' && observed.outcome, 'reverted');
    await f.removeCompletedJournalBytes();
    const history = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.deepEqual(history.saved.archived[0]!.collectibleTransfer, ready.intent);
    assert.equal((await f.runtime.activity!.observeLocal!(history.saved.archived[0]!, () => undefined, new AbortController().signal)).status, 'mined');
  } finally { operation?.dispose(); await f.close(); }
});

test('Smart NFT requests cannot replace the owned contract, standard, fixed ID or network scope', async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'Collectible sender', password: PASSWORD });
    const collectible = { contractAddress: '0x5555555555555555555555555555555555555555', tokenStandard: 'ERC-1155' as const, tokenId: '7' };
    const registry = await f.runtime.tokens!.load(() => undefined);
    await f.runtime.tokens!.addCollectible!(registry.revision, collectible, () => undefined);
    const to = '0x2222222222222222222222222222222222222222';
    await assert.rejects(f.runtime.openSmartAccountSend(to, { kind: 'nft', collectible, tokenId: '8', amountUnits: '1' }, () => undefined));
    await assert.rejects(f.runtime.openSmartAccountSend(to, { kind: 'nft', collectible: { ...collectible, contractAddress: to }, tokenId: '7', amountUnits: '1' }, () => undefined), { code: 'NOT_READY' });
    await assert.rejects(f.runtime.openSmartAccountSend(to, { kind: 'nft', collectible: { contractAddress: collectible.contractAddress, tokenStandard: 'ERC-721' }, tokenId: '7', amountUnits: '1' }, () => undefined), { code: 'NOT_READY' });
    await f.selectNetwork('base');
    await assert.rejects(f.runtime.openSmartAccountSend(to, { kind: 'nft', collectible, tokenId: '7', amountUnits: '1' }, () => undefined));
    assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});

for (const data of ['0x', '0x12345678']) test(`real Smart dapp zero-value call ${data} preserves exact execution and Activity after restart`, async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  let approval: ReturnType<typeof createDappSigningApproval> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Dapp account', password: PASSWORD });
    f.fundedSmart(); f.deployed();
    const host = await f.runtime.openConnectionHost();
    const selected = host.context().accounts.find(account => account.type === 'SmartAccount')!;
    const grant = { accountId: selected.index, accountType: selected.type as import('../../../source/types/network.ts').KeyringAccountType, chain: 'ethereum' as import('../../../source/types/network.ts').INetworkType,
      chainId: 1, host: 'https://fixture.example', date: 1 };
    approval = createDappSigningApproval({ readScope: () => ({
      account: { id: selected.index, type: selected.type, address: selected.address, xpub: selected.xpub },
      grant, network: host.context().network, isBitcoinBased: false, sessionGeneration: host.sessionGeneration(),
    }), subscribe: (changed) => f.owner.subscribe(() => { changed(); }) });
    const recipient = '0x2222222222222222222222222222222222222222';
    const request = { from: selected.address, to: recipient, value: '0x0', data, maxFeePerGas: '0x3', maxPriorityFeePerGas: '0x1' };
    const prepared = await host.prepareTransaction({ accountId: selected.id, networkId: 'ethereum', transaction: request, approval }, () => undefined);
    assert('operation' in prepared); operation = prepared.operation;
    await operation.prepare(); const ready = operation.getSnapshot();
    assert.equal(ready.phase, 'authorize', JSON.stringify(ready));
    assert.deepEqual(ready.intent, { kind: 'dapp-call', recipient, amountUnits: '0', data, maxFeePerGas: '3', maxPriorityFeePerGas: '1' });
    assert.equal(f.submitted.length, 0);
    const sending = operation.authorize(ready.revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id); await sending;
    assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
    assert.equal(f.submitted.length, 1);
    const [ops] = paliEntryPointInterface.decodeFunctionData('handleOps', Transaction.from(f.submitted[0]!).data);
    const [, execution] = paliSmartAccountInterface.decodeFunctionData('execute', ops[0].callData);
    assert.equal('0x' + execution.slice(2, 42), recipient);
    assert.equal(BigInt('0x' + execution.slice(42, 106)), 0n);
    assert.equal('0x' + execution.slice(106), data);
    operation.dispose(); approval.dispose(); await f.reopen(); await f.owner.unlock(PASSWORD);
    const activity = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.equal(activity.locals[0]!.contractInteraction, true);
    assert.equal(activity.locals[0]!.amountUnits, '0');
    assert.equal(activity.locals[0]!.recipient, recipient);
    f.showReceipts(false);
    const observed = await f.runtime.activity!.observeLocal!(activity.locals[0]!, () => undefined, new AbortController().signal);
    assert.equal(observed.status === 'mined' && observed.outcome, 'reverted');
    await f.removeCompletedJournalBytes();
    const saved = await f.runtime.activity!.load(() => undefined, new AbortController().signal);
    assert.equal(saved.saved.archived[0]!.contractInteraction, true);
    assert.equal(saved.saved.archived[0]!.phase, 'reverted');
  } finally { operation?.dispose(); approval?.dispose(); await f.close(); }
});


for (const existing of [false, true]) test(`two real Smart sends queue before mining (${existing ? 'deployed' : 'first deployment'})`, async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Queued Smart', password: PASSWORD });
    f.fundedSmart(); f.holdReceipts();
    if (existing) f.deployed();
    const nonces: bigint[] = [];
    for (let index = 0; index < 2; index++) {
      operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined);
      await operation.prepare();
      const ready = operation.getSnapshot();
      assert.equal(ready.phase, 'authorize', JSON.stringify(ready));
      nonces.push(BigInt(ready.authorization!.nonce));
      assert.equal(ready.authorization!.initCode === '0x', existing || index > 0);
      const submission = operation.authorize(ready.revision);
      for (let attempt = 0; attempt < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; attempt++)
        await new Promise(resolve => setTimeout(resolve, 5));
      const review = operation.getSnapshot().payerReview;
      assert(review, JSON.stringify(operation.getSnapshot()));
      operation.confirmPayer(review.id);
      await submission;
      assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
      operation.dispose();
    }
    assert.equal(nonces[1], nonces[0]! + 1n);
    assert.equal(f.submitted.length, 2);
  } finally { operation?.dispose(); await f.close(); }
});


test('a changed pending nonce during payer consent requires fresh Smart authorization', async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Fresh nonce', password: PASSWORD });
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined);
    await operation.prepare();
    const old = operation.getSnapshot();
    const authorizing = operation.authorize(old.revision);
    for (let attempt = 0; attempt < 300 && !operation.getSnapshot().payerReview; attempt++)
      await new Promise(resolve => setTimeout(resolve, 5));
    const payer = operation.getSnapshot().payerReview;
    assert(payer);
    f.advanceSmartNonce();
    operation.confirmPayer(payer.id);
    await authorizing;
    const fresh = operation.getSnapshot();
    assert.equal(fresh.phase, 'authorize', JSON.stringify(fresh));
    assert.equal(BigInt(fresh.authorization!.nonce), BigInt(old.authorization!.nonce) + 1n);
    assert.notEqual(fresh.userOperationHash, old.userOperationHash);
    assert.equal(f.submitted.length, 0);
  } finally { operation?.dispose(); await f.close(); }
});


for (const phase of ['inner-sign', 'payer-review']) test(`changed RPC chain refuses Smart ${phase}`, async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Chain bound', password: PASSWORD });
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize');
    if (phase === 'inner-sign') f.wrongChain();
    const authorizing = operation.authorize(operation.getSnapshot().revision);
    if (phase === 'payer-review') {
      for (let attempt = 0; attempt < 300 && !operation.getSnapshot().payerReview; attempt++)
        await new Promise(resolve => setTimeout(resolve, 5));
      const review = operation.getSnapshot().payerReview;
      assert(review); f.wrongChain(); operation.confirmPayer(review.id);
    }
    await authorizing;
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(f.submitted.length, 0);
  } finally { operation?.dispose(); await f.close(); }
});


for (const outcome of ['success', 'revert', 'lock-after-broadcast']) test(`real Smart atomic calls preserve ordered execution and restarted status (${outcome})`, async () => {
  const f = await fixture();
  let approval: ReturnType<typeof createDappSigningApproval> | undefined;
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Batch account', password: PASSWORD });
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    if (outcome === 'lock-after-broadcast') f.onBroadcast(() => f.owner.lock());
    const host = await f.runtime.openConnectionHost(), selected = host.context().accounts.find(account => account.type === 'SmartAccount')!;
    assert.equal(host.supportsAtomicCalls(selected.id), true);
    assert.equal(host.supportsAtomicCalls('hd:60:0'), false);
    const origin = 'https://batch.example', bundleId = '0x0102', reservationId = 'reserved';
    const grant = { accountId: selected.index, accountType: selected.type as import('../../../source/types/network.ts').KeyringAccountType, chain: 'ethereum' as import('../../../source/types/network.ts').INetworkType, chainId: 1, host: origin, date: 1 };
    approval = createDappSigningApproval({ readScope: () => ({ account: { id: selected.index, type: selected.type, address: selected.address, xpub: selected.xpub }, grant, network: host.context().network, isBitcoinBased: false, sessionGeneration: host.sessionGeneration() }), subscribe: changed => f.owner.subscribe(() => changed()) });
    assert.equal(await host.calls.reserveSendCallsBundle(origin, bundleId, { atomic: true, smartAccount: true, chainId: 1 }, reservationId, selected.address), true);
    const calls = [{ to: '0x' + '22'.repeat(20), value: '0x9', data: '0x12345678' }, { to: '0x' + '33'.repeat(20), value: '0x0', data: '0x' }];
    const prepared = await host.prepareCalls({ accountId: selected.id, networkId: 'ethereum', calls: { version: '2.0.0', from: selected.address, chainId: '0x1', atomicRequired: true, calls }, origin, bundleId, reservationId, approval }, () => undefined);
    operation = prepared.operation; await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize', JSON.stringify(operation.getSnapshot()));
    assert.equal(f.submitted.length, 0);
    const sending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id); await sending;
    assert.equal(operation.getSnapshot().phase, outcome === 'lock-after-broadcast' ? 'failed' : 'complete', JSON.stringify(operation.getSnapshot()));
    assert.equal(f.submitted.length, 1);
    assert.deepEqual((await host.calls.getStoredSendCallsBundle(origin, bundleId))!.txHashes, [Transaction.from(f.submitted[0]!).hash]);
    const [ops] = paliEntryPointInterface.decodeFunctionData('handleOps', Transaction.from(f.submitted[0]!).data);
    const [mode, encoded] = paliSmartAccountInterface.decodeFunctionData('execute', ops[0].callData);
    assert.equal(mode.slice(2, 4), '01');
    const [executions] = coder.decode(['tuple(address target,uint256 value,bytes callData)[]'], encoded);
    assert.deepEqual([...executions].map(call => ({ to: call.target.toLowerCase(), value: '0x' + call.value.toString(16), data: call.callData })), calls);
    if (outcome !== 'lock-after-broadcast') assert.equal((await host.readCallsStatus(origin, bundleId, () => undefined)).status, 100);
    operation.dispose(); approval.dispose(); await f.reopen(); await f.owner.unlock(PASSWORD); f.showReceipts(outcome !== 'revert');
    const restarted = await f.runtime.openConnectionHost();
    const status = await restarted.readCallsStatus(origin, bundleId, () => undefined);
    assert.equal(status.status, outcome !== 'revert' ? 200 : 500);
    assert.equal(status.receipts?.[0]?.transactionHash, Transaction.from(f.submitted[0]!).hash);
    assert.equal(await restarted.calls.reserveSendCallsBundle(origin, bundleId, { atomic: true, smartAccount: true, chainId: 1 }, 'other', selected.address), false);
  } finally { operation?.dispose(); approval?.dispose(); await f.close(); }
});

const savedSmartAccount = (record: unknown) => (record as any).groups.find((group: any) => group.key === '60').accounts.SmartAccount[0];

test('owned Smart metadata refresh commits shared observations and survives authenticated cold reopen', async () => {
  const f = await fixture();
  try {
    const privateKey = '0x' + '02'.repeat(32);
    await f.owner.importAccount({ privateKey, label: 'Independent imported key', expectedAddress: importedKeyIdentity(privateKey, 0).address },
      PASSWORD, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    await f.change({ kind: 'create-smart', label: 'Guardian account', password: PASSWORD });
    const before = (await f.inspectRecovery()).record;
    const accountBefore = savedSmartAccount(before);
    f.guardianStatus();
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    const after = (await f.inspectRecovery()).record;
    const accountAfter = savedSmartAccount(after);
    assert.deepEqual((after as any).recovery, (before as any).recovery);
    assert.equal((after as any).recovery.length, 1);
    assert.deepEqual((after as any).groups[0].accounts.Imported, (before as any).groups[0].accounts.Imported);
    assert.deepEqual({ ...accountAfter, smartAccount: undefined }, { ...accountBefore, smartAccount: undefined });
    assert.equal(accountAfter.smartAccount.isDeployed, true);
    const policy = accountAfter.smartAccount.installedModules.find((module: any) => module.id === 'guardian-recovery');
    assert.deepEqual(policy.config.guardians, ['0x' + '55'.repeat(20)]);
    assert.equal(policy.config.threshold, 1);
    const immutable = (metadata: Record<string, unknown>) => Object.fromEntries(Object.entries(metadata).filter(([key]) => !['auth', 'availableModules', 'isDeployed', 'installedModules'].includes(key)));
    assert.deepEqual(immutable(accountAfter.smartAccount), immutable(accountBefore.smartAccount));
    assert.equal(f.submitted.length, 0);
    await f.reopen();
    await f.owner.unlock(PASSWORD);
    assert.deepEqual(savedSmartAccount((await f.inspectRecovery()).record), accountAfter);
    f.guardianStatus('no-policy');
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.installedModules.some((module: any) => module.id === 'guardian-recovery'), false);
  } finally { await f.close(); }
});

for (const mode of ['unsupported', 'unavailable'] as const) test(`a ${mode} guardian read preserves metadata and the unlocked wallet`, async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'Read failure', password: PASSWORD });
    const before = (await f.inspectRecovery()).record;
    f.guardianStatus(mode);
    await assert.rejects(f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined));
    assert.equal(f.owner.getSnapshot().phase, 'ready');
    assert.deepEqual((await f.inspectRecovery()).record, before);
    assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});

for (const change of ['signal', 'owner', 'lock', 'account', 'network', 'account-cycle', 'network-cycle'] as const) test(`Smart metadata read cannot publish after ${change} changes`, async () => {
  const f = await fixture();
  let guardian: ReturnType<typeof f.guardianStatus> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Revoked read', password: PASSWORD });
    const before = savedSmartAccount((await f.inspectRecovery()).record);
    guardian = f.guardianStatus('hold');
    const signal = new AbortController();
    let current = true;
    const work = f.runtime.refreshSmartAccountMetadata(signal.signal, () => { if (!current) throw Error('CANCELLED'); });
    const refused = assert.rejects(work);
    for (let index = 0; guardian.methods().length === 0 && index < 200; index++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(guardian.methods().length > 0);
    if (change === 'signal') signal.abort();
    if (change === 'owner') current = false;
    if (change === 'lock') f.owner.lock();
    if (change === 'account' || change === 'account-cycle') await f.change({ kind: 'select', id: 'hd:60:0' });
    if (change === 'account-cycle') await f.change({ kind: 'select', id: 'smart:60:0' });
    if (change === 'network' || change === 'network-cycle') await f.selectNetwork('syscoin-nevm');
    if (change === 'network-cycle') {
      await f.selectNetwork('ethereum');
      await f.change({ kind: 'select', id: 'smart:60:0' });
    }
    guardian.release();
    await refused;
    if (change !== 'lock') assert.equal(f.owner.getSnapshot().phase, 'ready');
    if (change === 'lock') await f.owner.unlock(PASSWORD);
    assert.deepEqual(savedSmartAccount((await f.inspectRecovery()).record), before);
    assert.equal(f.submitted.length, 0);
  } finally { guardian?.release(); await f.close(); }
});

for (const point of ['before-commit', 'lost-ack'] as const) test(`Smart metadata ${point} uses existing quarantine and authenticated reopen`, async () => {
  let armed = false;
  const fail: SqlHook = (kind, sql) => {
    if (armed && kind === 'exec' && sql === 'COMMIT') { armed = false; throw Error('simulated metadata write interruption'); }
  };
  const f = await fixture(point === 'before-commit' ? { before: fail } : { after: fail });
  try {
    await f.change({ kind: 'create-smart', label: 'Interrupted metadata', password: PASSWORD });
    const before = savedSmartAccount((await f.inspectRecovery()).record);
    f.guardianStatus(); armed = true;
    await assert.rejects(f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined));
    assert.equal(f.owner.getCatalogue(), null);
    await f.reopenQuarantined(); await f.owner.unlock(PASSWORD);
    const after = savedSmartAccount((await f.inspectRecovery()).record);
    assert.deepEqual({ ...after, smartAccount: undefined }, { ...before, smartAccount: undefined });
    assert.equal(after.smartAccount.installedModules?.some((module: any) => module.id === 'guardian-recovery') ?? false, point === 'lost-ack');
  } finally { await f.close(); }
});

test('metadata CAS refuses immutable edits and non-Smart or stale selections', async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'Immutable identity', password: PASSWORD });
    const record = (await f.inspectRecovery()).record as any;
    const account = savedSmartAccount(record);
    const root = (await f.storage.recovery.readIdentity())!.root!;
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    const before = await catalogue.reconcile({ walletFingerprint: record.walletFingerprint, address: root.address, publicKey: root.publicKey }, () => undefined);
    const metadata = { auth: account.smartAccount.auth, availableModules: account.smartAccount.availableModules,
      installedModules: account.smartAccount.installedModules, isDeployed: true };
    for (const field of ['descriptor', 'deploymentAuth', 'deploymentSalt', 'factoryAddress', 'chainId', 'contractVersion', 'customModules', 'deploymentGasPayer']) {
      await assert.rejects(catalogue.mutate(before.revision, { kind: 'refresh-smart-metadata', id: before.active.accountId,
        metadata: { ...metadata, [field]: 'rewrite' } }, () => undefined));
      assert.deepEqual((await f.inspectRecovery()).record, record);
    }
    for (const id of ['hd:60:0', 'smart:60:1']) await assert.rejects(catalogue.mutate(before.revision, { kind: 'refresh-smart-metadata', id, metadata }, () => undefined));
    await assert.rejects(catalogue.mutate(before.revision - 1, { kind: 'refresh-smart-metadata', id: before.active.accountId, metadata }, () => undefined));
    assert.deepEqual((await f.inspectRecovery()).record, record);
  } finally { await f.close(); }
});

test('cancellation while metadata SQL is held cannot commit or publish the new policy', async () => {
  let armed = false, entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture({ after: async (kind, sql) => {
    if (armed && kind === 'run' && sql.startsWith('UPDATE keyring_records')) { armed = false; entered(); await held; }
  } });
  try {
    await f.change({ kind: 'create-smart', label: 'Cancelled metadata commit', password: PASSWORD });
    const before = savedSmartAccount((await f.inspectRecovery()).record);
    const snapshot = f.owner.getCatalogue();
    f.guardianStatus(); armed = true;
    const signal = new AbortController();
    const work = f.runtime.refreshSmartAccountMetadata(signal.signal, () => undefined);
    const rejected = assert.rejects(work);
    await reached;
    assert.equal(f.owner.getCatalogue(), snapshot);
    signal.abort(); release();
    await rejected;
    assert.equal(f.owner.getCatalogue(), null);
    await f.reopenQuarantined(); await f.owner.unlock(PASSWORD);
    assert.deepEqual(savedSmartAccount((await f.inspectRecovery()).record), before);
  } finally { release(); await f.close(); }
});

test('observing an external ECDSA owner cannot grant native signing authority', async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Externally controlled account', password: PASSWORD });
    f.guardianStatus(); f.externalOwner();
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    const metadata = savedSmartAccount((await f.inspectRecovery()).record).smartAccount;
    assert.deepEqual(metadata.installedModules.find((module: any) => module.id === 'ecdsa').config.owners, ['0x' + '66'.repeat(20)]);
    f.deployed();
    f.fundedSmart();
    operation = await f.runtime.openSmartAccountSend('0x' + '44'.repeat(20), { kind: 'exact', amount: '0.001' }, () => undefined);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize');
    await operation.authorize(operation.getSnapshot().revision);
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(f.submitted.length, 0);
  } finally { operation?.dispose(); await f.close(); }
});

for (const existing of [false, true]) test(`guardian policy ${existing ? 'update' : 'install'} uses the shared operation and commits verified metadata`, async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Guardian policy', password: PASSWORD });
    f.fundedSmart(); f.guardianStatus(existing ? 'installed' : 'no-policy');
    const guardian = '0x' + '77'.repeat(20), delaySeconds = 259200;
    f.onBroadcast(() => {
      if (Transaction.from(f.submitted.at(-1)!).to !== getPaliEntryPointAddress(1)) return;
      f.guardianStatus('installed').configure(guardian, delaySeconds);
    });
    assert.equal(f.runtime.canManageGuardianPolicy(), true);
    operation = await f.runtime.openGuardianPolicy({ action: 'set', guardian, delaySeconds, acknowledgedPendingOperationId: null }, new AbortController().signal, () => undefined);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize', operation.getSnapshot().error ?? '');
    const intent = operation.getSnapshot().intent;
    assert.equal(intent.kind, 'guardian-policy');
    if (intent.kind === 'guardian-policy') assert.equal(intent.command.kind, existing ? 'update' : 'install');
    const sending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id);
    await sending;
    assert.equal(operation.getSnapshot().phase, 'complete', operation.getSnapshot().error ?? '');
    assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
    assert.equal(f.submitted.length, 1);
    const policy = savedSmartAccount((await f.inspectRecovery()).record).smartAccount.installedModules.find((module: any) => module.id === 'guardian-recovery');
    assert.deepEqual(policy.config.guardians, [guardian]);
    assert.equal(policy.config.delaySeconds, delaySeconds);
    await f.reopen(); await f.owner.unlock(PASSWORD);
    assert.deepEqual(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.installedModules.find((module: any) => module.id === 'guardian-recovery'), policy);
  } finally { operation?.dispose(); await f.close(); }
});

for (const mode of ['unavailable', 'stale'] as const) test(`guardian policy preserves the confirmed transaction when metadata is ${mode} and only re-reads on retry`, async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Guardian metadata retry', password: PASSWORD });
    f.fundedSmart(); f.guardianStatus('no-policy');
    const guardian = '0x' + '77'.repeat(20), delaySeconds = 259200;
    f.onBroadcast(() => { if (Transaction.from(f.submitted.at(-1)!).to === getPaliEntryPointAddress(1)) f.guardianStatus(mode === 'unavailable' ? 'unavailable' : 'installed'); });
    operation = await f.runtime.openGuardianPolicy({ action: 'set', guardian, delaySeconds, acknowledgedPendingOperationId: null }, new AbortController().signal, () => undefined);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize');
    const sending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id); await sending;
    assert.equal(operation.getSnapshot().phase, 'complete');
    assert.equal(operation.getSnapshot().metadataRefresh, 'failed');
    const hash = operation.getSnapshot().transactionHash;
    assert.equal(f.submitted.length, 1);
    f.guardianStatus('installed').configure(guardian, delaySeconds);
    await operation.retryMetadata();
    assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
    assert.equal(operation.getSnapshot().transactionHash, hash);
    await operation.authorize(operation.getSnapshot().revision);
    assert.equal(f.submitted.length, 1);
  } finally { operation?.dispose(); await f.close(); }
});

test('guardian policy requires the current pending recovery acknowledgement and rechecks it after fee consent', async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Guardian pending change', password: PASSWORD });
    f.fundedSmart(); f.guardianStatus();
    const draft = { action: 'set' as const, guardian: '0x' + '77'.repeat(20), delaySeconds: 259200, acknowledgedPendingOperationId: null };
    await assert.rejects(f.runtime.openGuardianPolicy(draft, new AbortController().signal, () => undefined), /GUARDIAN_POLICY_CONFIRMATION_REQUIRED/);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
    f.guardianStatus('installed');
    operation = await f.runtime.openGuardianPolicy(draft, new AbortController().signal, () => undefined);
    await operation.prepare();
    const sending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
    f.guardianStatus();
    operation.confirmPayer(operation.getSnapshot().payerReview!.id); await sending;
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(f.submitted.length, 0);
  } finally { operation?.dispose(); await f.close(); }
});

test('guardian policy binds an acknowledged pending recovery and refuses a changed epoch before signing', async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Bound guardian policy', password: PASSWORD });
    f.fundedSmart();
    const fixture = f.guardianStatus();
    const observation = await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    assert(observation?.pending);
    operation = await f.runtime.openGuardianPolicy({ action: 'set', guardian: '0x' + '77'.repeat(20), delaySeconds: 259200,
      acknowledgedPendingOperationId: observation.pending.operationId }, new AbortController().signal, () => undefined);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize');
    fixture.configure('0x' + '88'.repeat(20), 604800);
    await operation.authorize(operation.getSnapshot().revision);
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(f.submitted.length, 0);
  } finally { operation?.dispose(); await f.close(); }
});

test('an unsuccessful UserOperation cannot report a completed guardian policy from its successful outer receipt', async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Reverted guardian policy', password: PASSWORD });
    f.fundedSmart(); f.guardianStatus('no-policy'); f.showReceipts(false);
    operation = await f.runtime.openGuardianPolicy({ action: 'set', guardian: '0x' + '77'.repeat(20), delaySeconds: 259200,
      acknowledgedPendingOperationId: null }, new AbortController().signal, () => undefined);
    await operation.prepare();
    const sending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id); await sending;
    assert.equal(f.submitted.length, 1);
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(operation.getSnapshot().metadataRefresh, undefined);
    assert(operation.getSnapshot().transactionHash);
  } finally { operation?.dispose(); await f.close(); }
});

for (const acknowledged of [false, true]) test(`guardian policy snapshots the draft before asynchronous reads (acknowledged ${acknowledged})`, async () => {
  const f = await fixture();
  let held: ReturnType<typeof f.guardianStatus> | undefined;
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Immutable guardian draft', password: PASSWORD });
    f.guardianStatus();
    const observation = await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    assert(observation?.pending);
    held = f.guardianStatus('hold');
    const draft = { action: 'set' as const, guardian: '0x' + '77'.repeat(20), delaySeconds: 259200,
      acknowledgedPendingOperationId: acknowledged ? observation.pending.operationId : null };
    const pending = f.runtime.openGuardianPolicy(draft, new AbortController().signal, () => undefined);
    const refused = acknowledged ? null : assert.rejects(pending, /GUARDIAN_POLICY_CONFIRMATION_REQUIRED/);
    for (let i = 0; held.methods().length === 0 && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(held.methods().length);
    draft.guardian = '0x' + '88'.repeat(20);
    draft.delaySeconds = 604800;
    draft.acknowledgedPendingOperationId = observation.pending.operationId;
    held.select('healthy', GUARDIAN_FIXTURE_RUNTIME);
    if (refused) await refused;
    else {
      operation = await pending;
      const intent = operation.getSnapshot().intent;
      assert.equal(intent.kind, 'guardian-policy');
      if (intent.kind === 'guardian-policy' && intent.command.kind !== 'remove') {
        assert.equal(intent.command.guardian, '0x' + '77'.repeat(20));
        assert.equal(intent.command.delaySeconds, 259200);
      }
    }
    assert.equal(f.submitted.length, 0);
  } finally { held?.release(); operation?.dispose(); await f.close(); }
});


const removalDraft = { action: 'remove' as const, recoveryLossAcknowledged: true as const, acknowledgedPendingOperationId: null };
async function confirmPolicyOperation(operation: NativeSmartAccountOperation) {
  await operation.prepare();
  assert.equal(operation.getSnapshot().phase, 'authorize', operation.getSnapshot().error ?? '');
  const pending = operation.authorize(operation.getSnapshot().revision);
  for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
  operation.confirmPayer(operation.getSnapshot().payerReview!.id);
  await pending;
}

test('guardian removal requires explicit loss consent and the current pending recovery acknowledgement', async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'Remove consent', password: PASSWORD });
    f.fundedSmart(); f.guardianStatus();
    await assert.rejects(f.runtime.openGuardianPolicy({ ...removalDraft, recoveryLossAcknowledged: false } as never,
      new AbortController().signal, () => undefined), /INVALID_INPUT/);
    await assert.rejects(f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined), /GUARDIAN_POLICY_CONFIRMATION_REQUIRED/);
    assert.equal(f.submitted.length, 0);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { await f.close(); }
});

for (const lag of [false, true]) test(`guardian removal commits canonical absence and preserves its receipt through metadata lag (${lag})`, async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Remove guardian', password: PASSWORD });
    f.fundedSmart(); f.guardianStatus('installed');
    if (!lag) f.onBroadcast(() => { f.guardianStatus('no-policy'); });
    operation = await f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined);
    assert.equal(operation.getSnapshot().intent.kind, 'guardian-policy');
    await confirmPolicyOperation(operation);
    assert.equal(operation.getSnapshot().phase, 'complete', operation.getSnapshot().error ?? '');
    assert.equal(operation.getSnapshot().metadataRefresh, lag ? 'failed' : 'complete');
    const hash = operation.getSnapshot().transactionHash;
    assert(hash); assert.equal(f.submitted.length, 1);
    const [operations] = paliEntryPointInterface.decodeFunctionData('handleOps', Transaction.from(f.submitted[0]).data);
    const [, executionCalldata] = paliSmartAccountInterface.decodeFunctionData('execute', operations[0].callData);
    const execution = getBytes(executionCalldata);
    assert.equal(hexlify(execution.slice(0, 20)).toLowerCase(), operations[0].sender.toLowerCase());
    assert.equal(BigInt(hexlify(execution.slice(20, 52))), 0n);
    const removal = paliSmartAccountInterface.decodeFunctionData('uninstallModule', hexlify(execution.slice(52)));
    assert.equal(removal[0], 2n);
    assert.equal(removal[1].toLowerCase(), getConfiguredAuthenticatorAddress(1, 'guardian-recovery').toLowerCase());
    assert.equal(removal[2], '0x');
    if (lag) {
      f.guardianStatus('no-policy');
      await operation.retryMetadata();
      assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
      assert.equal(operation.getSnapshot().transactionHash, hash);
    }
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.installedModules.some((module: any) => module.id === 'guardian-recovery'), false);
    operation.dispose(); operation = undefined;
    await f.reopen(); await f.owner.unlock(PASSWORD);
    assert.equal((await f.runtime.inspectGuardianRemoval(new AbortController().signal, () => undefined)).status, 'removed');
    assert.equal(f.submitted.length, 1);
  } finally { operation?.dispose(); await f.close(); }
});

test('unresolved guardian removal is recovered from the signed journal after restart and cannot be submitted twice', async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Pending guardian removal', password: PASSWORD });
    f.fundedSmart(); f.guardianStatus('installed'); f.holdReceipts();
    operation = await f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined);
    await operation.prepare();
    const pending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview);
    operation.confirmPayer(operation.getSnapshot().payerReview!.id);
    for (let i = 0; i < 300 && !f.submitted.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(f.submitted.length, 1);
    operation.dispose(); await pending; operation = undefined;
    await f.reopen(); await f.owner.unlock(PASSWORD);
    const status = await f.runtime.inspectGuardianRemoval(new AbortController().signal, () => undefined);
    assert.equal(status.status, 'pending'); assert.equal(status.transactions.length, 1);
    await assert.rejects(f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined), /GUARDIAN_REMOVAL_PENDING/);
    f.showReceipts(false);
    assert.equal((await f.runtime.inspectGuardianRemoval(new AbortController().signal, () => undefined)).status, 'retry-ready');
    operation = await f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize');
    assert.equal(f.submitted.length, 1);
  } finally { operation?.dispose(); await f.close(); }
});


test('guardian removal inner failure never reports removal from a successful outer receipt', async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Failed removal', password: PASSWORD });
    f.fundedSmart(); f.guardianStatus('installed'); f.showReceipts(false);
    operation = await f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined);
    await confirmPolicyOperation(operation);
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(operation.getSnapshot().metadataRefresh, undefined);
    assert(operation.getSnapshot().transactionHash);
    assert.equal(f.submitted.length, 1);
    assert.equal((await f.runtime.inspectGuardianRemoval(new AbortController().signal, () => undefined)).status, 'retry-ready');
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.installedModules.some((module: any) => module.id === 'guardian-recovery'), true);
  } finally { operation?.dispose(); await f.close(); }
});

for (const cancel of ['owner', 'signal', 'lock'] as const) test(`guardian removal inspection refuses a held read after ${cancel}`, async () => {
  const f = await fixture();
  let held: ReturnType<typeof f.guardianStatus> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Bound removal read', password: PASSWORD });
    held = f.guardianStatus('hold');
    let current = true;
    const abort = new AbortController();
    const pending = f.runtime.inspectGuardianRemoval(abort.signal, () => { assert(current); });
    const rejected = assert.rejects(pending);
    for (let i = 0; held.methods().length === 0 && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(held.methods().length);
    if (cancel === 'owner') current = false;
    else if (cancel === 'signal') abort.abort();
    else f.owner.lock();
    held.release();
    await rejected;
    assert.equal(f.submitted.length, 0);
  } finally { held?.release(); await f.close(); }
});


test('guardian removal inspection rechecks the policy after a held retained-record read', async () => {
  let armed = false;
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture({ after: async (_kind, sql) => {
    if (armed && sql.startsWith("SELECT 'signed' AS source")) {
      armed = false; entered(); await gate;
    }
  } });
  try {
    await f.change({ kind: 'create-smart', label: 'Policy race', password: PASSWORD });
    const guardian = f.guardianStatus('installed');
    armed = true;
    const pending = f.runtime.inspectGuardianRemoval(new AbortController().signal, () => undefined);
    const rejected = assert.rejects(pending, /GUARDIAN_POLICY_CHANGED/);
    await waiting;
    guardian.configure('0x' + '77'.repeat(20), 259200);
    release(); await rejected;
    assert.equal(f.submitted.length, 0);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { release(); await f.close(); }
});

for (const delayedMetadata of [false, true]) test(`native guardian recovery persists before proof signing and resumes through canonical execution (${delayedMetadata})`, async () => {
  const f = await fixture({}, true);
  let recovery: Awaited<ReturnType<KeyringRuntime['openGuardianRecovery']>> | undefined;
  try {
    const privateKey = '0x' + '02'.repeat(32);
    await f.owner.importAccount({ privateKey, label: 'Replacement', expectedAddress: importedKeyIdentity(privateKey, 0).address },
      PASSWORD, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    await f.change({ kind: 'create-smart', label: 'Recoverable account', password: PASSWORD });
    const accounts = f.owner.getCatalogue()!.accounts;
    const guardian = accounts.find(account => account.id === 'hd:60:0')!;
    const replacement = accounts.find(account => account.type === 'Imported')!;
    const status = f.guardianStatus('installed'); status.configure(guardian.address, 600);
    f.externalOwner();
    recovery = await f.runtime.openGuardianRecovery({ kind: 'start', guardianId: guardian.id, replacementId: replacement.id }, new AbortController().signal, () => undefined);
    const intent = f.runtime.getGuardianRecoveryIntent()!;
    assert(intent); assert.equal(f.submitted.length, 0);
    assert.equal(((await f.inspectRecovery()).record as { guardianRecoveryIntents: unknown[] }).guardianRecoveryIntents.length, 1);
    await recovery.prepare(); assert.equal(recovery.getSnapshot().phase, 'authorize');
    f.onBroadcast(() => {
      const transaction = Transaction.from(f.submitted.at(-1)!);
      const call = paliGuardianRecoveryModuleInterface.parseTransaction({ data: transaction.data });
      if (call?.name === 'scheduleRecovery') status.recover(intent.operation, 'pending');
      if (call?.name === 'executeRecovery') { status.recover(intent.operation, 'executed'); f.recoveredOwner(delayedMetadata ? '0x' + '77'.repeat(20) : replacement.address); }
    });
    await recovery.review(); assert.equal(recovery.getSnapshot().phase, 'review', JSON.stringify(recovery.getSnapshot()));
    assert.equal(f.signatures.length, 2);
    assert(f.signatures.every(proof => proof.intentPersisted && proof.digest === intent.operation.hash));
    assert.equal(recoverAddress(intent.operation.hash, f.signatures[0]!.signature).toLowerCase(), replacement.address.toLowerCase());
    assert.equal(recoverAddress(intent.operation.hash, f.signatures[1]!.signature).toLowerCase(), guardian.address.toLowerCase());
    await recovery.confirm(recovery.getSnapshot().feeReview!.id);
    const schedule = paliGuardianRecoveryModuleInterface.decodeFunctionData('scheduleRecovery', Transaction.from(f.submitted[0]).data);
    assert.equal(recoverAddress(intent.operation.hash, schedule[4][0].signature).toLowerCase(), guardian.address.toLowerCase());
    assert.equal(recovery.getSnapshot().phase, 'waiting', JSON.stringify(recovery.getSnapshot()));
    assert.equal(f.submitted.length, 1);
    recovery.dispose(); recovery = undefined;
    await f.reopen(); await f.owner.unlock(PASSWORD);
    recovery = await f.runtime.openGuardianRecovery({ kind: 'resume' }, new AbortController().signal, () => undefined);
    await recovery.prepare(); assert.equal(recovery.getSnapshot().phase, 'waiting');
    status.recover(intent.operation, 'ready');
    await recovery.refresh(); assert.equal(recovery.getSnapshot().phase, 'ready', JSON.stringify(recovery.getSnapshot()));
    await recovery.review(); assert.equal(recovery.getSnapshot().phase, 'review', JSON.stringify(recovery.getSnapshot()));
    await recovery.confirm(recovery.getSnapshot().feeReview!.id);
    assert.equal(recovery.getSnapshot().phase, 'complete', JSON.stringify(recovery.getSnapshot()));
    if (delayedMetadata) {
      assert.equal(recovery.getSnapshot().metadataRefresh, 'failed');
      assert(f.runtime.getGuardianRecoveryIntent());
      assert.equal(f.owner.getSnapshot().phase, 'ready');
      f.recoveredOwner(replacement.address);
      await recovery.retryMetadata();
      assert.equal(f.submitted.length, 2);
    }
    assert.equal(recovery.getSnapshot().metadataRefresh, 'complete', JSON.stringify(recovery.getSnapshot()));
    assert.equal(f.runtime.getGuardianRecoveryIntent(), null);
    assert.equal(f.submitted.length, 2);
    const final = savedSmartAccount((await f.inspectRecovery()).record);
    assert.equal(final.smartAccount.auth.data.toLowerCase(), intent.target.auth.data.toLowerCase());
  } finally { recovery?.dispose(); await f.close(); }
});


async function startNativeRecovery() {
  const f = await fixture({}, true);
  const privateKey = '0x' + '03'.repeat(32);
  await f.owner.importAccount({ privateKey, label: 'Recovery replacement', expectedAddress: importedKeyIdentity(privateKey, 0).address },
    PASSWORD, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
  await f.change({ kind: 'create-smart', label: 'Recovery target', password: PASSWORD });
  const guardian = f.owner.getCatalogue()!.accounts.find(account => account.id === 'hd:60:0')!;
  const replacement = f.owner.getCatalogue()!.accounts.find(account => account.type === 'Imported')!;
  const policy = f.guardianStatus('installed'); policy.configure(guardian.address, 600);
  const controller = await f.runtime.openGuardianRecovery({ kind: 'start', guardianId: guardian.id, replacementId: replacement.id }, new AbortController().signal, () => undefined);
  return { f, guardian, replacement, policy, controller };
}

test('clearing a canceled pre-sign recovery preserves both keys and only removes local tracking', async () => {
  const { f, controller, guardian, replacement } = await startNativeRecovery();
  try {
    await controller.prepare();
    assert.equal(controller.getSnapshot().canAbandon, true);
    const phases: string[] = [];
    controller.subscribe(() => phases.push(controller.getSnapshot().phase));
    await controller.abandon();
    assert.equal(controller.getSnapshot().phase, 'cleared');
    assert(!phases.includes('complete'));
    assert.equal(f.runtime.getGuardianRecoveryIntent(), null);
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
    const accounts = f.owner.getCatalogue()!.accounts;
    assert(accounts.some(account => account.id === guardian.id));
    assert(accounts.some(account => account.id === replacement.id));
  } finally { controller.dispose(); await f.close(); }
});

test('an uncertain scheduled recovery survives restart without signing a second transaction', async () => {
  const { f, controller } = await startNativeRecovery();
  let resumed: typeof controller | undefined;
  try {
    f.holdReceipts();
    f.onBroadcast(() => { throw new Error('Connection lost after delivery'); });
    await controller.review();
    await controller.confirm(controller.getSnapshot().feeReview!.id);
    assert.equal(controller.getSnapshot().phase, 'unknown');
    const hash = controller.getSnapshot().transactionHash;
    assert(hash); assert.equal(f.submitted.length, 1); assert.equal(f.signatures.length, 2);
    controller.dispose(); await f.reopen(); await f.owner.unlock(PASSWORD);
    resumed = await f.runtime.openGuardianRecovery({ kind: 'resume' }, new AbortController().signal, () => undefined);
    await resumed.prepare(); await resumed.review();
    assert.equal(resumed.getSnapshot().phase, 'waiting');
    assert.equal(resumed.getSnapshot().transactionHash, hash);
    assert.equal(resumed.getSnapshot().canAbandon, false);
    assert.equal(f.submitted.length, 1); assert.equal(f.signatures.length, 2);
  } finally { resumed?.dispose(); controller.dispose(); await f.close(); }
});

test('locking during new recovery observation cannot persist an intent or sign', async () => {
  const f = await fixture({}, true);
  let held: ReturnType<typeof f.guardianStatus> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Held recovery', password: PASSWORD });
    held = f.guardianStatus('hold');
    const pending = f.runtime.openGuardianRecovery({ kind: 'start', guardianId: 'hd:60:0', replacementId: 'hd:60:0' }, new AbortController().signal, () => undefined);
    const rejected = assert.rejects(pending);
    for (let i = 0; !held.methods().length && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(held.methods().length); f.owner.lock(); held.release(); await rejected;
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
    await f.owner.unlock(PASSWORD); assert.equal(f.runtime.getGuardianRecoveryIntent(), null);
  } finally { held?.release(); await f.close(); }
});


test('a different active recovery prevents signing the saved intent until status changes', async () => {
  const { f, controller, policy } = await startNativeRecovery();
  try {
    const intent = f.runtime.getGuardianRecoveryIntent()!;
    policy.recover({ ...intent.operation, salt: '0x' + '88'.repeat(32) }, 'pending');
    await controller.prepare(); await controller.review();
    assert.equal(controller.getSnapshot().phase, 'waiting');
    assert.equal(controller.getSnapshot().action, null);
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally { controller.dispose(); await f.close(); }
});

test('executed recovery followed by a later owner change can retire tracking without adopting mismatched metadata', async () => {
  const { f, controller, guardian, replacement, policy } =
    await startNativeRecovery();
  let resumed: typeof controller | undefined;
  try {
    const intent = f.runtime.getGuardianRecoveryIntent()!;
    f.onBroadcast(() => policy.recover(intent.operation, 'pending'));
    await controller.review();
    await controller.confirm(controller.getSnapshot().feeReview!.id);
    assert.equal(f.submitted.length, 1);
    controller.dispose();
    await f.reopen();
    policy.recover(intent.operation, 'executed');
    f.recoveredOwner('0x' + '77'.repeat(20));
    await f.owner.unlock(PASSWORD);
    const before = (await f.inspectRecovery()).record as {
      groups: unknown;
      recovery: unknown;
    };
    resumed = await f.runtime.openGuardianRecovery(
      { kind: 'resume' },
      new AbortController().signal,
      () => undefined
    );
    await resumed.prepare();
    assert.equal(resumed.getSnapshot().phase, 'complete');
    assert.equal(resumed.getSnapshot().metadataRefresh, 'failed');
    assert.equal(resumed.getSnapshot().canAbandon, true);
    assert.equal(
      f.runtime.getGuardianRecoveryIntent()!.operation.hash,
      intent.operation.hash
    );
    assert.deepEqual(
      ((await f.inspectRecovery()).record as { groups: unknown }).groups,
      before.groups
    );
    await resumed.abandon();
    assert.equal(resumed.getSnapshot().phase, 'cleared');
    assert.equal(f.runtime.getGuardianRecoveryIntent(), null);
    const after = (await f.inspectRecovery()).record as {
      groups: unknown;
      recovery: unknown;
    };
    assert.deepEqual(after.groups, before.groups);
    assert.deepEqual(after.recovery, before.recovery);
    assert(
      f.owner
        .getCatalogue()!
        .accounts.some((account) => account.id === guardian.id)
    );
    assert(
      f.owner
        .getCatalogue()!
        .accounts.some((account) => account.id === replacement.id)
    );
    assert.equal(f.submitted.length, 1);
    assert.equal(f.signatures.length, 2);
    await f.reopen();
    await f.owner.unlock(PASSWORD);
    assert.equal(f.runtime.getGuardianRecoveryIntent(), null);
    await f.change({ kind: 'remove', id: replacement.id, password: PASSWORD });
    assert(
      !f.owner
        .getCatalogue()!
        .accounts.some((account) => account.id === replacement.id)
    );
  } finally {
    resumed?.dispose();
    controller.dispose();
    await f.close();
  }
});

test('revoking an executed recovery clear during its fresh observation preserves intent and keys', async () => {
  const { f, controller, policy } = await startNativeRecovery();
  let resumed: typeof controller | undefined;
  let current = true;
  try {
    const intent = f.runtime.getGuardianRecoveryIntent()!;
    controller.dispose();
    policy.recover(intent.operation, 'executed');
    f.recoveredOwner('0x' + '77'.repeat(20));
    resumed = await f.runtime.openGuardianRecovery(
      { kind: 'resume' },
      new AbortController().signal,
      () => {
        if (!current) throw new Error('CANCELLED');
      }
    );
    await resumed.prepare();
    assert.equal(resumed.getSnapshot().canAbandon, true);
    const before = (await f.inspectRecovery()).record;
    policy.select('hold', GUARDIAN_FIXTURE_RUNTIME);
    const clearing = resumed.abandon();
    for (let i = 0; !policy.methods().length && i < 200; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert(policy.methods().length);
    current = false;
    policy.release();
    await clearing;
    assert.notEqual(resumed.getSnapshot().phase, 'cleared');
    assert.deepEqual((await f.inspectRecovery()).record, before);
    assert.equal(
      f.runtime.getGuardianRecoveryIntent()!.operation.hash,
      intent.operation.hash
    );
    assert.equal(f.signatures.length, 0);
    assert.equal(f.submitted.length, 0);
  } finally {
    policy.release();
    resumed?.dispose();
    controller.dispose();
    await f.close();
  }
});
