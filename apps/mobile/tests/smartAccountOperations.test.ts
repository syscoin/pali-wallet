import { createSmartAccountPendingState } from '../../../source/utils/smartAccount/pendingState.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder, Interface } from 'ethers/abi';
import { Wallet } from 'ethers/wallet';
import { BigNumber } from '../../../source/utils/ethersV6Compat.ts';
import { encodeEcdsaValidatorInitData, getPaliSmartAccountDescriptor , getConfiguredAuthenticatorAddress, getSmartAccountUserOpRequiredPrefund, encodeERC7579Executions } from '../../../source/utils/smartAccount/account.ts';
import { derivePaliSmartAccountDeployment } from '../../../source/utils/smartAccount/counterfactual.ts';
import { getPaliSmartAccountFactoryAddress, PALI_SMART_ACCOUNT_VERSION, paliSmartAccountInterface } from '../../../source/utils/smartAccount/contracts.ts';
import { prepareSmartAccountOperation } from '../../../source/utils/smartAccount/prepareOperation.ts';
import { getSmartAccountGasPayerCandidates, ensureSmartAccountDeploymentPrefund } from '../../../source/utils/smartAccount/payerPolicy.ts';
import { signSmartAccountEcdsaOperation } from '../../../source/utils/smartAccount/signOperation.ts';
import { submitSmartAccountOperation } from '../../../source/utils/smartAccount/submitOperation.ts';
import { assertSmartAccountNativeSpendability } from '../../../source/utils/smartAccount/nativeSpendability.ts';
import type { IKeyringAccountState, KeyringAccountType } from '../../../source/types/network.ts';

const owner = '0x1111111111111111111111111111111111111111';
const payer = { id: 0, type: 'HDAccount' as KeyringAccountType, address: owner };
const chainId = 1;
function fixture() {
  const funds = { balance: BigInt(0), deposit: BigInt(0), failEstimate: false, balanceReads: 0, depositReads: 0 };
  const factoryAddress = getPaliSmartAccountFactoryAddress(chainId);
  const descriptor = getPaliSmartAccountDescriptor({ accountIndex: 0, chainId, factoryAddress, accountVersion: PALI_SMART_ACCOUNT_VERSION,
    anchor: `pali:eip155:${chainId}:${owner}:smart-account-v1` });
  const auth = { validator: getConfiguredAuthenticatorAddress(chainId, 'ecdsa'), data: encodeEcdsaValidatorInitData([owner], 1), module: 'ecdsa' as const };
  const deployment = derivePaliSmartAccountDeployment({ ...auth, deploySalt: descriptor.deploymentSalt, factoryAddress });
  const metadata = { chainId, contractVersion: PALI_SMART_ACCOUNT_VERSION, isDeployed: false, deploymentSalt: descriptor.deploymentSalt,
    descriptor, factoryAddress, deploymentAuth: { data: auth.data, validator: auth.validator }, auth };
  const account = { id: 0, address: deployment.address, xpub: deployment.address, xprv: '', label: 'Fixture', isSmartAccount: true,
    isImported: false, isLedgerWallet: false, isTrezorWallet: false, balances: { syscoin: 0, ethereum: 0 }, smartAccount: metadata } as IKeyringAccountState;
  const rawProvider = {
    async verifyConfiguredChainId() { assert.equal(await rawProvider.send('eth_chainId', []), '0x1'); },
    send: async (method: string, params: any[]) => {
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getCode') return '0x';
      if (method === 'eth_getBalance') { funds.balanceReads++; return '0x' + funds.balance.toString(16); }
      if (method === 'eth_estimateGas' && funds.failEstimate) throw new Error('execution reverted');
      if (method === 'eth_call') {
        const parsed = new Interface(['function getNonce(address,uint192) view returns(uint256)', 'function balanceOf(address) view returns(uint256)']).parseTransaction({ data: params[0].data });
        if (parsed?.name === 'balanceOf') { funds.depositReads++; return AbiCoder.defaultAbiCoder().encode(['uint256'], [funds.deposit]); }
        return AbiCoder.defaultAbiCoder().encode(['uint256'], [parsed ? BigInt(parsed.args[1]) << BigInt(64) : BigInt(0)]);
      }
      return '0x186a0';
    },
    getCode: async () => '0x',
    call: async () => AbiCoder.defaultAbiCoder().encode(['uint256'], [0]),
    getFeeData: async () => ({ maxFeePerGas: BigNumber.from(2), maxPriorityFeePerGas: BigNumber.from(1), gasPrice: BigNumber.from(2), lastBaseFeePerGas: BigNumber.from(1) }),
    getBalance: async () => BigNumber.from(0),
    estimateGas: async () => BigNumber.from(100000),
  };
  const pending = createSmartAccountPendingState(rawProvider, { profileId: '0x' + '11'.repeat(32), read: async () => [] }, chainId, account.address, () => undefined);
  return { account, metadata, deployment, provider: pending.provider, pending, funds };
}

const nativeRecipient = '0x2222222222222222222222222222222222222222';
async function prepareNative(f: ReturnType<typeof fixture>, value: string, assertCurrent = () => {}) {
  return prepareSmartAccountOperation({ account: f.account as IKeyringAccountState & { smartAccount: typeof f.metadata }, chainId,
    executions: [{ target: nativeRecipient, value, data: '0x' }], knownDeployed: true, provider: f.provider, pending: f.pending,
    async selectGasPayer() { return { gasPayer: payer, useGasTank: false }; }, assertCurrent });
}

function nativeSubmitHost(f: ReturnType<typeof fixture>, prepared: Awaited<ReturnType<typeof prepareNative>>, send: (...args: any[]) => Promise<any>) {
  return {
    chainId, provider: f.provider, pending: f.pending, assertExpectedExecutionContext() {}, assertSmartAccountExecutionContext() {},
    getExecutionContext: () => ({ accountId: 0, userOperation: prepared.userOperation }),
    getSmartAccountById: () => ({ account: f.account, metadata: f.metadata }),
    getWalletGasPayerAccount: async () => payer, getLocalNativeExecutionRecipients: () => [], assertGasTankCoversTransaction: async () => BigNumber.from(100000),
    ensureDeploymentPrefund: async () => { throw new Error('Unexpected deployment prefund'); },
    sendTransaction: send, invalidateMetadata() {},
  };
}

test('shared preparation rejects excess native value despite a failed execution estimate, with exact units', async () => {
  const f = fixture();
  f.funds.balance = BigInt('9007199254740992');
  f.funds.deposit = BigInt('1000000000000000000');
  f.funds.failEstimate = true;
  await assert.rejects(prepareNative(f, '9007199254740993'), /Insufficient funds for smart account amount and fee/);
});

test('an EntryPoint deposit covers prefund but cannot be sent as native value', async () => {
  const f = fixture();
  f.funds.balance = BigInt(123);
  f.funds.deposit = BigInt(10000000);
  const prepared = await prepareNative(f, '123');
  assert.equal(prepared.execution!.value, '123');
  assert(getSmartAccountUserOpRequiredPrefund(prepared.userOperation).lte(f.funds.deposit));
  await assert.rejects(prepareNative(f, '124'), /Insufficient funds/);
});

test('shared preparation reserves only the prefund shortfall after the EntryPoint deposit', async () => {
  const f = fixture();
  f.funds.balance = BigInt(10000000);
  const first = await prepareNative(f, '123');
  const prefund = getSmartAccountUserOpRequiredPrefund(first.userOperation).toBigInt();
  f.funds.deposit = prefund - BigInt(10);
  f.funds.balance = BigInt(132);
  await assert.rejects(prepareNative(f, '123'), /Insufficient funds/);
  f.funds.balance = BigInt(133);
  await prepareNative(f, '123');
});

test('shared submission rechecks Smart balance after authenticator signing and ignores forged execution metadata', async () => {
  const f = fixture();
  f.funds.balance = BigInt(10000000);
  const prepared = await prepareNative(f, '123');
  f.funds.balance = BigInt(122);
  let sends = 0;
  await assert.rejects(submitSmartAccountOperation({ ...prepared, executions: [], accountId: 0, executionContextId: 'fixture', signature: '0x1234' },
    nativeSubmitHost(f, prepared, async () => { sends++; throw new Error('Unexpected send'); }), () => {}),
    (error: any) => error.transactionNotBroadcast === true);
  assert.equal(sends, 0);
});

test('ordinary native submission succeeds and rechecks balance at the payer authorization boundary', async () => {
  const f = fixture();
  f.funds.balance = BigInt(10000000);
  const prepared = await prepareNative(f, '123');
  assert.equal(f.funds.balanceReads, 1);
  assert.equal(f.funds.depositReads, 1);
  let sends = 0;
  const host = nativeSubmitHost(f, prepared, async (...args) => {
    await args[4].assertPendingState();
    sends++;
    return { hash: '0x' + 'ab'.repeat(32), async wait() {} };
  });
  const params = { ...prepared, accountId: 0, executionContextId: 'fixture', signature: '0x1234' };
  const response = await submitSmartAccountOperation(params, host, () => {});
  // One pair during preparation, one at submission entry, and one after the
  // separate payer authorization. Synchronous context guards do no RPC work.
  assert.equal(f.funds.balanceReads, 3);
  assert.equal(f.funds.depositReads, 3);
  assert.match(response.hash, /^0x[0-9a-f]{64}$/);
  assert.equal(sends, 1);
  host.sendTransaction = async (...args) => {
    f.funds.balance = BigInt(122);
    await args[4].assertPendingState();
    sends++;
    return response;
  };
  await assert.rejects(submitSmartAccountOperation(params, host, () => {}));
  assert.equal(sends, 1);
});

test('cancelled native authorization cannot submit', async () => {
  const f = fixture();
  f.funds.balance = BigInt(10000000);
  let current = true;
  const prepared = await prepareNative(f, '123');
  let sends = 0;
  current = false;
  await assert.rejects(submitSmartAccountOperation({ ...prepared, accountId: 0, executionContextId: 'fixture', signature: '0x1234' },
    nativeSubmitHost(f, prepared, async () => { sends++; throw new Error('Unexpected send'); }), () => { assert(current, 'cancelled'); }), /cancelled/);
  assert.equal(sends, 0);
});

test('cancellation while a balance read is outstanding cannot release a spendability approval', async () => {
  const f = fixture();
  f.funds.balance = BigInt(10000000);
  const prepared = await prepareNative(f, '123');
  let current = true;
  let release!: (value: bigint) => void;
  const balance = new Promise<bigint>((resolve) => { release = resolve; });
  const approval = assertSmartAccountNativeSpendability({ chainId, userOperation: { ...prepared.userOperation, gasFees: '0x' + '00'.repeat(32) },
    provider: { getBalance: () => balance }, assertCurrent() { assert(current, 'cancelled'); } });
  current = false;
  release(BigInt(10000000));
  await assert.rejects(approval, /cancelled/);
});

test('zero-fee gas-tank operations need only the transferred native amount', async () => {
  const f = fixture();
  f.funds.balance = BigInt(10000000);
  const prepared = await prepareNative(f, '123');
  await assertSmartAccountNativeSpendability({ chainId, userOperation: { ...prepared.userOperation, gasFees: '0x' + '00'.repeat(32) },
    provider: { getBalance: async () => BigInt(123) }, assertCurrent() {} });
});

for (const kind of ['self', 'contract-refund']) test(`ordered ${kind} batch retains execution-aware affordability preflight`, async () => {
  const f = fixture();
  f.funds.balance = BigInt(10000000);
  const prepared = await prepareNative(f, '123');
  // With balance 100 and no prefund, two self calls can reuse the same 100;
  // a contract may likewise return the first call's funds before the next call.
  const executions = encodeERC7579Executions([
    { target: kind === 'self' ? f.account.address : nativeRecipient, value: '100', data: kind === 'self' ? '0x' : '0x12345678' },
    { target: kind === 'self' ? f.account.address : owner, value: '100', data: '0x' },
  ]);
  const userOperation = { ...prepared.userOperation, gasFees: '0x' + '00'.repeat(32),
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [executions.mode, executions.executionCalldata]) };
  let reads = 0;
  await assertSmartAccountNativeSpendability({ chainId, userOperation,
    provider: { getBalance: async () => { reads++; return BigInt(100); } }, assertCurrent() {} });
  assert.equal(reads, 0, 'batch affordability remains with the existing execution preflight');
});

test('portable shared preparation uses the canonical deployment and local UserOperation hash', async () => {
  const f = fixture();
  const prepared = await prepareSmartAccountOperation({ account: f.account as IKeyringAccountState & { smartAccount: typeof f.metadata }, chainId,
    executions: [{ target: f.account.address, value: '0x0', data: '0x' }], knownDeployed: false, provider: f.provider, pending: f.pending,
    async selectGasPayer() { return { gasPayer: payer, useGasTank: false }; }, assertCurrent() {} });
  assert.equal(prepared.userOperation.sender, f.account.address);
  assert.equal(prepared.userOperation.initCode.toLowerCase(), (f.deployment.factory + f.deployment.factoryData.slice(2)).toLowerCase());
  assert.equal(BigInt(prepared.userOperation.nonce) & ((BigInt(1) << BigInt(64)) - BigInt(1)), BigInt(0));
  assert.equal(prepared.gasPayer.address, owner);
  assert.match(prepared.actionHash, /^0x[0-9a-f]{64}$/i);
  assert.equal(prepared.execution!.target, f.account.address);
});

test('shared ECDSA operation signing rejects an owner change before releasing the signature', async () => {
  const f = fixture(); let current = true;
  const signer = new Wallet('0x' + '01'.padStart(64, '0'));
  const metadata = { ...f.metadata, auth: { ...f.metadata.auth,
    data: encodeEcdsaValidatorInitData([signer.address], 1) } };
  let signCalls = 0;
  await assert.rejects(signSmartAccountEcdsaOperation({ metadata, actionHash: '0x' + 'ab'.repeat(32),
    findOwner: () => payer, async signOwner(address, digest) {
      assert.equal(address, signer.address);
      signCalls++;
      current = false;
      return signer.signingKey.sign(digest).serialized;
    }, assertCurrent() { assert(current, 'owner changed'); } }), /owner changed/);
  assert.equal(signCalls, 1);
});

test('shared payer policy keeps preferred and selected identities distinct from the smart account', () => {
  const hd = { ...fixture().account, address: owner, isSmartAccount: false };
  const imported = { ...hd, id: 4, address: '0x2222222222222222222222222222222222222222' };
  const candidates = getSmartAccountGasPayerCandidates({ accounts: { HDAccount: { 0: hd }, Imported: { 4: imported }, SmartAccount: { 0: fixture().account }, Ledger: {}, Trezor: {} },
    activeAccount: { id: 0, type: 'SmartAccount' as KeyringAccountType } }, { id: 4, type: 'Imported' as KeyringAccountType, address: imported.address });
  assert.deepEqual(candidates.map(({ id, type }) => [type, id]), [['Imported', 4], ['HDAccount', 0]]);
});

test('portable deployment preserves prefund acknowledgement if handleOps submission fails', async () => {
  const f = fixture();
  const prepared = await prepareSmartAccountOperation({ account: f.account as IKeyringAccountState & { smartAccount: typeof f.metadata }, chainId,
    executions: [{ target: f.account.address, value: '0x0', data: '0x' }], knownDeployed: false, provider: f.provider, pending: f.pending,
    async selectGasPayer() { return { gasPayer: payer, useGasTank: false }; }, assertCurrent() {} });
  const sends: unknown[] = [];
  const send = async (...args: any[]) => {
    sends.push(args[0]);
    if (sends.length > 1) throw Object.assign(new Error('handleOps refused'), { transactionNotBroadcast: true });
    await args[4]?.onBroadcast?.({ hash: '0x' + 'ab'.repeat(32) });
    return { hash: '0x' + 'ab'.repeat(32), async wait() {} };
  };
  await assert.rejects(submitSmartAccountOperation({ ...prepared, accountId: 0, executionContextId: 'fixture', signature: '0x1234' }, {
    chainId, provider: f.provider, pending: f.pending, assertExpectedExecutionContext() {}, assertSmartAccountExecutionContext() {},
    getExecutionContext: () => ({ accountId: 0, userOperation: prepared.userOperation }),
    getSmartAccountById: () => ({ account: f.account, metadata: f.metadata }),
    getWalletGasPayerAccount: async () => payer, getLocalNativeExecutionRecipients: () => [], assertGasTankCoversTransaction: async () => BigNumber.from(100000),
    ensureDeploymentPrefund: (...args) => ensureSmartAccountDeploymentPrefund(f.provider, send, ...args),
    sendTransaction: send, invalidateMetadata() {},
  }, () => undefined), (error: any) => error.transactionNotBroadcast === false && error.transactionHash === undefined);
  assert.equal(sends.length, 2);
});


test('shared submission refuses omitted or asynchronous approval guards before host access', async () => {
  let touched = false;
  const host = new Proxy({}, { get() { touched = true; throw new Error('host touched'); } });
  for (const guard of [undefined, async () => undefined]) {
    await assert.rejects(submitSmartAccountOperation({} as never, host as never, guard as never), (error: any) => error.transactionNotBroadcast === true);
    assert.equal(touched, false);
  }
});

test('shared submission requires the exact issued account and operation before any payer work', async () => {
  const f = fixture();
  const prepared = await prepareSmartAccountOperation({ account: f.account as IKeyringAccountState & { smartAccount: typeof f.metadata }, chainId,
    executions: [{ target: f.account.address, value: '0x0', data: '0x' }], knownDeployed: false, provider: f.provider, pending: f.pending,
    async selectGasPayer() { return { gasPayer: payer, useGasTank: false }; }, assertCurrent() {} });
  const params = { ...prepared, accountId: 0, executionContextId: 'issued', signature: '0x1234' };
  const contexts = [undefined, { accountId: 1, userOperation: prepared.userOperation },
    { accountId: 0, userOperation: { ...prepared.userOperation, nonce: '1' } }];
  for (const context of contexts) {
    let payerRead = false;
    const host = {
      pending: f.pending,
      assertSmartAccountExecutionContext(id: string) { assert.equal(id, 'issued'); },
      getExecutionContext() { return context; },
      getSmartAccountById() { payerRead = true; throw new Error('account accessed'); },
    };
    await assert.rejects(submitSmartAccountOperation(params, host as never, () => undefined),
      (error: any) => error.transactionNotBroadcast === true);
    assert.equal(payerRead, false);
  }
});
