import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder } from 'ethers/abi';
import { BigNumber } from '../../../source/utils/ethersV6Compat.ts';
import { encodeEcdsaValidatorInitData, getPaliSmartAccountDescriptor , getConfiguredAuthenticatorAddress } from '../../../source/utils/smartAccount/account.ts';
import { derivePaliSmartAccountDeployment } from '../../../source/utils/smartAccount/counterfactual.ts';
import { getPaliSmartAccountFactoryAddress, PALI_SMART_ACCOUNT_VERSION } from '../../../source/utils/smartAccount/contracts.ts';
import { prepareSmartAccountOperation } from '../../../source/utils/smartAccount/prepareOperation.ts';
import { getSmartAccountGasPayerCandidates, ensureSmartAccountDeploymentPrefund } from '../../../source/utils/smartAccount/payerPolicy.ts';
import { signSmartAccountEcdsaOperation } from '../../../source/utils/smartAccount/signOperation.ts';
import { submitSmartAccountOperation } from '../../../source/utils/smartAccount/submitOperation.ts';
import type { IKeyringAccountState, KeyringAccountType } from '../../../source/types/network.ts';

const owner = '0x1111111111111111111111111111111111111111';
const payer = { id: 0, type: 'HDAccount' as KeyringAccountType, address: owner };
const chainId = 1;
function fixture() {
  const factoryAddress = getPaliSmartAccountFactoryAddress(chainId);
  const descriptor = getPaliSmartAccountDescriptor({ accountIndex: 0, chainId, factoryAddress, accountVersion: PALI_SMART_ACCOUNT_VERSION,
    anchor: `pali:eip155:${chainId}:${owner}:smart-account-v1` });
  const auth = { validator: getConfiguredAuthenticatorAddress(chainId, 'ecdsa'), data: encodeEcdsaValidatorInitData([owner], 1), module: 'ecdsa' as const };
  const deployment = derivePaliSmartAccountDeployment({ ...auth, deploySalt: descriptor.deploymentSalt, factoryAddress });
  const metadata = { chainId, contractVersion: PALI_SMART_ACCOUNT_VERSION, isDeployed: false, deploymentSalt: descriptor.deploymentSalt,
    descriptor, factoryAddress, deploymentAuth: { data: auth.data, validator: auth.validator }, auth };
  const account = { id: 0, address: deployment.address, xpub: deployment.address, xprv: '', label: 'Fixture', isSmartAccount: true,
    isImported: false, isLedgerWallet: false, isTrezorWallet: false, balances: { syscoin: 0, ethereum: 0 }, smartAccount: metadata } as IKeyringAccountState;
  const provider = {
    getCode: async () => '0x',
    call: async () => AbiCoder.defaultAbiCoder().encode(['uint256'], [0]),
    getFeeData: async () => ({ maxFeePerGas: BigNumber.from(2), maxPriorityFeePerGas: BigNumber.from(1), gasPrice: BigNumber.from(2), lastBaseFeePerGas: BigNumber.from(1) }),
    getBalance: async () => BigNumber.from(0),
    estimateGas: async () => BigNumber.from(100000),
  };
  return { account, metadata, deployment, provider };
}

test('portable shared preparation uses the canonical deployment and local UserOperation hash', async () => {
  const f = fixture();
  const prepared = await prepareSmartAccountOperation({ account: f.account as IKeyringAccountState & { smartAccount: typeof f.metadata }, chainId,
    executions: [{ target: f.account.address, value: '0x0', data: '0x' }], knownDeployed: false, provider: f.provider,
    async selectGasPayer() { return { gasPayer: payer, useGasTank: false }; }, assertCurrent() {} });
  assert.equal(prepared.userOperation.sender, f.account.address);
  assert.equal(prepared.userOperation.initCode.toLowerCase(), (f.deployment.factory + f.deployment.factoryData.slice(2)).toLowerCase());
  assert.equal(prepared.userOperation.nonce, '0');
  assert.equal(prepared.gasPayer.address, owner);
  assert.match(prepared.actionHash, /^0x[0-9a-f]{64}$/i);
  assert.equal(prepared.execution!.target, f.account.address);
});

test('shared ECDSA operation signing rejects an owner change before releasing the signature', async () => {
  const f = fixture(); let current = true;
  await assert.rejects(signSmartAccountEcdsaOperation({ metadata: f.metadata, actionHash: '0x' + 'ab'.repeat(32),
    findOwner: () => payer, async signOwner() { current = false; return '0x1234'; }, assertCurrent() { assert(current, 'owner changed'); } }), /owner changed/);
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
    executions: [{ target: f.account.address, value: '0x0', data: '0x' }], knownDeployed: false, provider: f.provider,
    async selectGasPayer() { return { gasPayer: payer, useGasTank: false }; }, assertCurrent() {} });
  const sends: unknown[] = [];
  const send = async (...args: any[]) => {
    sends.push(args[0]);
    if (sends.length > 1) throw Object.assign(new Error('handleOps refused'), { transactionNotBroadcast: true });
    await args[4]?.onBroadcast?.({ hash: '0x' + 'ab'.repeat(32) });
    return { hash: '0x' + 'ab'.repeat(32), async wait() {} };
  };
  await assert.rejects(submitSmartAccountOperation({ ...prepared, accountId: 0, executionContextId: 'fixture', signature: '0x1234' }, {
    chainId, provider: f.provider, assertExpectedExecutionContext() {}, assertSmartAccountExecutionContext() {},
    getExecutionContext: () => ({ accountId: 0, userOperation: prepared.userOperation }),
    getSmartAccountById: () => ({ account: f.account, metadata: f.metadata }), getActiveSmartAccount: () => ({ account: f.account, metadata: f.metadata }),
    getWalletGasPayerAccount: async () => payer, getLocalNativeExecutionRecipients: () => [], assertGasTankCoversTransaction: async () => BigNumber.from(100000),
    ensureDeploymentPrefund: (...args) => ensureSmartAccountDeploymentPrefund(f.provider, send, ...args),
    sendTransaction: send, invalidateMetadata() {},
  }, () => undefined), (error: any) => error.transactionNotBroadcast === false && error.transactionHash === undefined);
  assert.equal(sends.length, 2);
});
