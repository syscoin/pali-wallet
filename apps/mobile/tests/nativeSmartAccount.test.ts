import { Wallet } from 'ethers/wallet';
import { serializePreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { createTrezorSessions } from '../src/hardware/trezorSessions.ts';
import type { NativeTrezorClient } from '../src/hardware/trezorHost.ts';
import { bindNativePrivateAuthentication, createNativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { prepareRecoveryCredential } from './fixtures/recoveryCredential.ts';
import { createTestPrivateAuthentication } from './fixtures/privateAuthentication.ts';
import { createTestCredentialRecordKeyring, withTestCredentialOperation } from './fixtures/credentialOperation.ts';
import { createSlhDsaProfileStateCrypto } from '../../../source/wallet/slhDsaStateCrypto.ts';
import { qualifyNativeHdAccounts } from '../qualification/hd-accounts.ts';
import { createTestCredentialPort } from './fixtures/credential.ts';
import type { NativeCredentialPort } from '../src/custody/credentialVault.ts';
import { normalizeSmartAccountModuleRequest } from '../../../source/shared/smartAccountModuleRequest.ts';
import type { NativeSmartCreationAllocation } from '../src/smartAccount/preparation.ts';
import { nativeSmartTrezorDevice } from './nativeSmartTrezorDevice.ts';
import { nonSuiteSigningHandoff } from './nonSuiteSigningHandoff.ts';
import { NativeSigningHandoffs, retireNativeSigningHandoff, type NativeSigningHandoff, type SigningHandoffDescriptor, type SigningResumeScope } from '../src/connections/signingHandoff.ts';
import type { WalletConnectRequest } from '../src/connections/walletConnect.ts';
import { NativeLedgerAccounts } from '../src/custody/ledgerAccounts.ts';
import { nativeSmartLedgerDevice } from './nativeSmartLedgerDevice.ts';
import type { NativeSlhKey, NativeSlhTree } from '../src/crypto/slhDsaNativeExecution.ts';
import type { SlhDsaExecutionHost } from '../../../source/wallet/slhDsaExecution.ts';
import type { IKeyringAccountState, SmartAccountInstalledModule } from '../../../source/types/network.ts';
import type { NativeSlhPublicState, NativeSlhExecutionCapability } from '../src/smartAccount/slhDsaRuntime.ts';
import { getSLHDSAKeyId, getSLHDSAStateStorageKey, SLH_DSA_SIGNATURE_LIMIT } from '../../../source/utils/slhDsa/constants.ts';
import { prepareSmartAccountMessage, encodeSmartAccountMessageSignature } from '../../../source/utils/smartAccount/messageSigning.ts';
import { getPaliErc7739PersonalSignHash } from '../../../source/utils/smartAccount/erc7739.ts';
import { encodeSmartAccountAuthenticatorSignature } from '../../../source/utils/smartAccount/signature.ts';
import { readDappMessageRequest, type DappMessageRequest } from '../../../source/shared/dappMessageRequest.ts';
import type { NativeSmartAccountOperation } from '../src/smartAccount/operation.ts';
import { createDappSigningApproval } from '../../../source/wallet/dappSigningApproval.ts';
import { decodeNftSafeTransferData } from '../../../source/shared/nftTransfer.ts';
import { decodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { encodePasskeyWebAuthnProof } from '../../../source/utils/passkey/validation.ts';
import { getSmartAccountUserOpHash } from '../../../source/utils/smartAccount/userOperationHash.ts';
import { encodeEcdsaValidatorInitData, encodeSmartAccountValidatorNonceKey, getConfiguredAuthenticatorAddress } from '../../../source/utils/smartAccount/account.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AbiCoder, Interface } from 'ethers/abi';
import { Transaction, recoverAddress } from 'ethers/transaction';
import { EvmSignedRecords, inspectEvmSignedBundle } from '../../../source/wallet/evmSignedRecords.ts';
import type { NativeNetworkRegistration } from '../src/custody/networkContext.ts';
import { getCreate2Address } from 'ethers/address';
import { keccak256 } from 'ethers/crypto';
import { concat, getBytes, hexlify } from 'ethers/utils';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime, type KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { NativeRecoveryCoordinator } from '../src/custody/recovery.ts';
import { inspectRecoveryCatalogue, NativeWalletCatalogue, WALLET_CATALOGUE_KEY, type NativeInfrastructurePending } from '../src/custody/walletCatalogue.ts';
import { NativePortfolioController } from '../src/portfolio/nativePortfolio.ts';
import { digest, INSTALLATION, nodeConnection, type SqlHook } from './storageHelpers.ts';
import { createGuardianRecoveryFixture } from './native-watch-ui/guardianRecoveryFixture.ts';
import { GUARDIAN_FIXTURE_RUNTIME } from './guardianRecoveryRuntime.ts';
import { importedKeyIdentity } from '../src/custody/importedAccounts.ts';
import { getPaliEntryPointAddress, paliEntryPointInterface, paliEcdsaValidatorInterface, paliCompositeValidatorInterface, paliP256WebAuthnValidatorInterface, paliSlhDsaValidatorInterface, paliSmartAccountInterface, paliSmartAccountFactoryInterface, paliGuardianRecoveryModuleInterface } from '../../../source/utils/smartAccount/contracts.ts';
import { getZkSysGasTankAddress, PALI_ACCOUNT_PROXY_CREATION_CODE, PALI_CANONICAL_FACTORY_ADDRESS, PALI_INFRASTRUCTURE_METADATA_BY_ID, PALI_CREATE2_DEPLOYER_ADDRESS, type PaliInfrastructureContractId } from '../../../source/utils/smartAccount/deploymentMetadata.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES } from '../../../source/utils/smartAccount/infrastructureObservation.ts';

const credentialPort = createTestCredentialPort();

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const coder = AbiCoder.defaultAbiCoder();
const moduleTuple = 'tuple(address module,bytes data)';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;

async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}, recordSignatures = false, slhFactory: NativeSlhExecutionCapability | null = null, ledgerFactory?: KeyringRuntimeDependencies['createLedgerTransport'], trezorSessions?: KeyringRuntimeDependencies['trezorSessions'], passkeys: KeyringRuntimeDependencies['passkeys'] = null) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-smart-account-test-'));
  const file = path.join(directory, 'wallet.sqlite');
  let initialized = false, substituteAddress = false, hold: (() => Promise<void>) | undefined;
  let runtime!: KeyringRuntime;
  let storage!: SqliteWalletStorage;
  const calls: string[] = [];
  let credentialReads = 0, secretLeases = 0, completedSecretLeases = 0;
  let afterSecretLease: (() => void) | undefined;
  const signatures: { address: string; digest: string; signature: string; intentPersisted: boolean }[] = [];
  let onCredentialRequest: ((check: () => void) => void | Promise<void>) | undefined;
  const submitted: string[] = [];
  const payerSignatures: string[] = [];
  const infrastructureBroadcasts: { rawTransaction: string; pending: NativeInfrastructurePending }[] = [];
  const missingInfrastructure = new Set<string>();
  let failInfrastructureBroadcast = false;
  let initialEoaNonce = 0;
  let physicalStorageCloses = 0;
  const spendabilityReads = { native: 0, deposit: 0 };
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
  let smartCodeRead: (() => void | Promise<void>) | undefined;
  let beforeSignature: (() => void | Promise<void>) | undefined;
  let afterBroadcast: (() => void | Promise<void>) | undefined;
  let guardian: ReturnType<typeof createGuardianRecoveryFixture> | undefined;
  let externalOwner = false;
  let recoveredOwner: string | undefined;
  let observedOwners: string[] | undefined;
  let observedThreshold = 1;
  let smartGuardianMetadata: { address: string; owners: string[]; threshold: number; compositeThreshold?: number; deployed: boolean } | undefined;
  const estimatedSenders: string[] = [];
  let composite: { threshold: number; ecdsaFirst: boolean; children?: string[] } | undefined;
  const customValidators = new Map<string, { installed: boolean; compatible: boolean }>();
  let observedSlh: Pick<NativeSlhPublicState, 'pkRoot' | 'pkSeed'> | undefined;
  let observedPasskey = false;
  const slhDerivations: number[] = [];
  const sdkInstances: { isUnlocked(): boolean }[] = [];
  const sdkHostStores = new WeakMap<object, SqliteWalletStorage['keyringStorage']>();
  let sdkHost: InstanceType<Awaited<ReturnType<typeof loadNativeKeyringSdk>>['HostKeyring']> | undefined;
  let sdkHostStorage: SqliteWalletStorage['keyringStorage'] | undefined;
  let captureJournal: (() => ReturnType<EvmSignedRecords['captureSmartAccountPendingRecords']>) | undefined;
  let readPreparedRecord: ((chainId: string, from: string, hash: string) => Promise<string | null>) | undefined;
  let mutateSelectedSmart: ((mutate: (account: IKeyringAccountState) => void) => void) | undefined;
  let mutateLedgerOwner: ((index: number, mutate: (account: IKeyringAccountState) => void) => void) | undefined;
  let installSlh: (() => void) | undefined;
  let replaceSoftwareOwner: ((type: 'HDAccount' | 'Imported', id: number) => void) | undefined;
  const openStorage = async () => {
    const connection = nodeConnection(file, hooks).connection;
    const close = connection.closeAsync.bind(connection);
    connection.closeAsync = async () => { physicalStorageCloses++; await close(); };
    storage = await SqliteWalletStorage.open(connection, digest, INSTALLATION, !initialized);
    initialized = true;
    return storage;
  };
  const backend = async (network: NativeNetworkRegistration, init: RequestInit) => {
        const request = JSON.parse(String(init.body));
        calls.push(request.method);
        if (request.method === 'eth_getBalance' && request.params[0].toLowerCase() === runtime.catalogue.getSnapshot()?.accounts.find(account => account.type === 'SmartAccount')?.address.toLowerCase()) spendabilityReads.native++;
        if (request.method === 'eth_call' && request.params[0].to.toLowerCase() === getPaliEntryPointAddress(Number(network.chainId)).toLowerCase() && request.params[0].data.startsWith(paliEntryPointInterface.getFunction('balanceOf')!.selector)) spendabilityReads.deposit++;
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
          result = builtIn || customValidators.has(target) ? '0x01' : deployed && smartTarget && (!deployedByBroadcast || request.params[1] === 'pending' || readReceipts) ? deployedCode : '0x';
          if (missingInfrastructure.has(target)) result = '0x';
          if (smartGuardianMetadata && smartGuardianMetadata.address.toLowerCase() === target && !smartGuardianMetadata.deployed) result = '0x';
          if (smartTarget) {
            await smartCodeRead?.();
            if (deployed && interruptAfterReceipt) {
              interruptAfterReceipt = false;
              owner.lock();
            }
          }
        }
        else if (request.method === 'eth_getTransactionCount') result = nonceReset ? '0x0' : `0x${(initialEoaNonce + (request.params[1] === 'pending' || readReceipts ? submitted.length : 0)).toString(16)}`;
        else if (request.method === 'eth_getBalance') result = request.params[0].toLowerCase() === runtime.catalogue.getSnapshot()?.accounts.find(account => account.type === 'SmartAccount')?.address.toLowerCase() ? smartBalance : payerBalance;
        else if (request.method === 'eth_gasPrice') result = '0x2';
        else if (request.method === 'eth_maxPriorityFeePerGas') result = '0x1';
        else if (request.method === 'eth_estimateGas') {
          const call = request.params[0];
          if (call.from) estimatedSenders.push(call.from);
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
          if (Transaction.from(request.params[0]).to?.toLowerCase() === PALI_CREATE2_DEPLOYER_ADDRESS.toLowerCase()) {
            const signed = Transaction.from(request.params[0]);
            assert(readPreparedRecord);
            assert.equal(await readPreparedRecord(network.chainId, signed.from!, signed.hash!), request.params[0],
              'the actual SDK must retain these exact signed bytes before the broadcast transport runs');
            const record = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as { infrastructurePending?: readonly NativeInfrastructurePending[] };
            const pending = record.infrastructurePending?.find(entry => entry.chainId === network.chainId);
            assert(pending, 'infrastructure reservation must be durable before broadcasting');
            infrastructureBroadcasts.push({ rawTransaction: request.params[0], pending: structuredClone(pending) });
          }
          submitted.push(request.params[0]);
          if (Transaction.from(request.params[0]).to === getPaliEntryPointAddress(Number(network.chainId))) { if (!deployed) deployedByBroadcast = true; deployed = true; }
          result = Transaction.from(request.params[0]).hash;
          await afterBroadcast?.();
          if (failInfrastructureBroadcast && Transaction.from(request.params[0]).to?.toLowerCase() === PALI_CREATE2_DEPLOYER_ADDRESS.toLowerCase())
            throw Error('connection lost after infrastructure submission');
        }
        else if (request.method === 'eth_call') {
          const to = request.params[0].to.toLowerCase();
          const data = request.params[0].data;
          const smartTarget = runtime.catalogue.getSnapshot()?.accounts.some(account => account.type === 'SmartAccount' && account.address.toLowerCase() === to);
          const ownGuardian = smartGuardianMetadata?.address.toLowerCase() === to ? smartGuardianMetadata : undefined;
          const smartComposite = ownGuardian ? ownGuardian.compositeThreshold !== undefined : !!composite;
          if (to === getZkSysGasTankAddress(Number(network.chainId))?.toLowerCase()) {
            result = coder.encode(['uint256'], [gasCredit]);
          } else if (smartTarget && data.startsWith(paliSmartAccountInterface.getFunction('supportsExecutionMode')!.selector)) {
            result = paliSmartAccountInterface.encodeFunctionResult('supportsExecutionMode', [true]);
          } else if (smartTarget && data.startsWith(paliSmartAccountInterface.getFunction('isModuleInstalled')!.selector)) {
            const args = paliSmartAccountInterface.decodeFunctionData('isModuleInstalled', data);
            result = paliSmartAccountInterface.encodeFunctionResult('isModuleInstalled', [customValidators.get(args[1].toLowerCase())?.installed === true || args[1].toLowerCase() === getConfiguredAuthenticatorAddress(Number(network.chainId), 'ecdsa').toLowerCase() || !ownGuardian && observedPasskey && args[1].toLowerCase() === getConfiguredAuthenticatorAddress(Number(network.chainId), 'p256-webauthn').toLowerCase() || !ownGuardian && !!observedSlh && args[1].toLowerCase() === getConfiguredAuthenticatorAddress(Number(network.chainId), 'slh-dsa').toLowerCase() || smartComposite && (['composite', 'p256-webauthn'] as const).some(kind => args[1].toLowerCase() === getConfiguredAuthenticatorAddress(Number(network.chainId), kind).toLowerCase())]);
          } else if (smartTarget && data.startsWith(paliSmartAccountInterface.getFunction('activeValidator')!.selector)) {
            result = paliSmartAccountInterface.encodeFunctionResult('activeValidator', [getConfiguredAuthenticatorAddress(Number(network.chainId), smartComposite ? 'composite' : !ownGuardian && observedPasskey ? 'p256-webauthn' : !ownGuardian && observedSlh ? 'slh-dsa' : 'ecdsa')]);
          } else if (customValidators.has(to)) {
            const [type] = coder.decode(['uint256'], '0x' + data.slice(10));
            result = coder.encode(['bool'], [type === 1n || customValidators.get(to)!.compatible]);
          } else if (observedSlh && to === getConfiguredAuthenticatorAddress(Number(network.chainId), 'slh-dsa').toLowerCase()) {
            result = paliSlhDsaValidatorInterface.encodeFunctionResult('authData', [[observedSlh.pkSeed, observedSlh.pkRoot]]);
          } else if ((composite || smartGuardianMetadata?.compositeThreshold !== undefined) && to === getConfiguredAuthenticatorAddress(Number(network.chainId), 'composite').toLowerCase()) {
            const ecdsa = getConfiguredAuthenticatorAddress(Number(network.chainId), 'ecdsa'), passkey = getConfiguredAuthenticatorAddress(Number(network.chainId), 'p256-webauthn');
            const guardianConfig = paliCompositeValidatorInterface.parseTransaction({ data })?.args[0]?.toLowerCase() === smartGuardianMetadata?.address.toLowerCase() ? smartGuardianMetadata : undefined;
            result = data.startsWith(paliCompositeValidatorInterface.getFunction('childValidators')!.selector)
              ? paliCompositeValidatorInterface.encodeFunctionResult('childValidators', [guardianConfig ? [ecdsa, passkey] : composite?.children ?? (composite?.ecdsaFirst ? [ecdsa, passkey] : [passkey, ecdsa])])
              : paliCompositeValidatorInterface.encodeFunctionResult('threshold', [guardianConfig?.compositeThreshold ?? composite?.threshold ?? 1]);
          } else if ((observedPasskey || composite || smartGuardianMetadata?.compositeThreshold !== undefined) && to === getConfiguredAuthenticatorAddress(Number(network.chainId), 'p256-webauthn').toLowerCase()) {
            result = paliP256WebAuthnValidatorInterface.encodeFunctionResult('authData', [[`0x${'01'.repeat(32)}`, `0x${'02'.repeat(32)}`, `0x${'03'.repeat(32)}`, `0x${'04'.repeat(32)}`, 32]]);
          } else if (to === getConfiguredAuthenticatorAddress(Number(network.chainId), 'ecdsa').toLowerCase() && data.startsWith(paliEcdsaValidatorInterface.getFunction('owners')!.selector)) {
            const ownerAddress = runtime.catalogue.getSnapshot()!.accounts.find(account => account.id === 'hd:60:0')!.address;
            const guardianConfig = paliEcdsaValidatorInterface.decodeFunctionData('owners', data)[0].toLowerCase() === smartGuardianMetadata?.address.toLowerCase() ? smartGuardianMetadata : undefined;
            result = paliEcdsaValidatorInterface.encodeFunctionResult('owners', [guardianConfig?.owners ?? observedOwners ?? [recoveredOwner ?? (externalOwner ? '0x' + '66'.repeat(20) : ownerAddress)]]);
          } else if (to === getConfiguredAuthenticatorAddress(Number(network.chainId), 'ecdsa').toLowerCase() && data.startsWith(paliEcdsaValidatorInterface.getFunction('threshold')!.selector)) {
            const guardianConfig = paliEcdsaValidatorInterface.decodeFunctionData('threshold', data)[0].toLowerCase() === smartGuardianMetadata?.address.toLowerCase() ? smartGuardianMetadata : undefined;
            result = paliEcdsaValidatorInterface.encodeFunctionResult('threshold', [guardianConfig?.threshold ?? observedThreshold]);
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
  const protectedCredentials: NativeCredentialPort = { ...credentialPort,
    async withSecret(reference, owner, consume) {
      credentialReads++;
      await onCredentialRequest?.(owner.assertCurrent);
      return credentialPort.withSecret(reference, owner, consume);
    },
    async authorize(reference, owner) {
      await onCredentialRequest?.(owner.assertCurrent);
      return credentialPort.authorize(reference, owner);
    },
  };
  const factory = createKeyringRuntimeFactory({ isAuthenticationActive: () => false, credentialPort: protectedCredentials, privacyServiceSettings: null, passkeys, slhExecution: slhFactory, ...(trezorSessions ? {trezorSessions} : {}), ...(ledgerFactory ? {createLedgerTransport: ledgerFactory} : {}),
    ...(recordSignatures || slhFactory !== null ? { loadSdk: async () => {
      const sdk = await loadNativeKeyringSdk();
      const Base = sdk.HostKeyring;
      return { ...sdk, createKeyringHost(...args: Parameters<typeof sdk.createKeyringHost>) {
        const host = sdk.createKeyringHost(...args);
        sdkHostStores.set(host, args[0] as SqliteWalletStorage['keyringStorage']);
        return host;
      }, HostKeyring: class extends Base {
        override async withSecretOperation<T>(
          credential: Parameters<InstanceType<typeof Base>['withSecretOperation']>[0],
          options: Parameters<InstanceType<typeof Base>['withSecretOperation']>[1],
          work: (secret: string) => T | Promise<T>
        ): Promise<T> {
          assert.equal(this.isUnlocked(), false, 'a new SDK lease starts without a retained root');
          secretLeases++;
          try { return await super.withSecretOperation(credential, options, work); }
          finally { assert.equal(this.isUnlocked(), false, 'every SDK lease clears its root'); completedSecretLeases++; afterSecretLease?.(); }
        }
        constructor(...args: ConstructorParameters<typeof Base>) {
          super(...args);
          sdkHost = this; sdkHostStorage = sdkHostStores.get(args[0]);
          sdkInstances.push(this);
          const deriveSlh = this.deriveSLHDSASetupSecretForAccount.bind(this);
          this.deriveSLHDSASetupSecretForAccount = async (...input: Parameters<typeof deriveSlh>) => {
            slhDerivations.push(input[0].accountIndex);
            return deriveSlh(...input);
          };
          const setState = this.setVaultStateGetter.bind(this);
          this.setVaultStateGetter = getter => {
            setState(getter);
            captureJournal = () => {
              const selected = getter().accounts.SmartAccount[getter().activeAccount.id]; assert(selected?.smartAccount);
              return new EvmSignedRecords(storage.signedRecords).captureSmartAccountPendingRecords({keyring:createTestCredentialRecordKeyring(storage.credential, credentialPort, this, () => { assert(this.hasPublicSession()); }),assertCurrent:()=>{assert(this.hasPublicSession());}},'1',selected.address);
            };
            mutateLedgerOwner = (index, mutate) => {const account = getter().accounts.Ledger[index]; assert(account); mutate(account);};
            mutateSelectedSmart = mutate => {
              const current = getter(), account = current.accounts.SmartAccount[current.activeAccount.id];
              assert(account?.smartAccount); mutate(account);
            };
            installSlh = () => {
              const current = getter(), account = current.accounts.SmartAccount[current.activeAccount.id]; assert(account?.smartAccount);
              const pkSeed = `0x${'33'.repeat(16)}${'00'.repeat(16)}`, pkRoot = `0x${'44'.repeat(16)}${'00'.repeat(16)}`;
              account.smartAccount.installedModules = [...(account.smartAccount.installedModules ?? []), {
                type: 'validator', id: 'slh-dsa', address: getConfiguredAuthenticatorAddress(1, 'slh-dsa'),
                config: { keyId: getSLHDSAKeyId({pkSeed, pkRoot}), pkSeed, pkRoot, parameterSet: 'SLH-DSA-SHA2-128-24', signatureCount: 0, signatureLimit: SLH_DSA_SIGNATURE_LIMIT },
              }];
            };
            replaceSoftwareOwner = (type, id) => {
              const current = getter(); const owner = current.accounts[type][id]; assert(owner);
              current.accounts[type][id] = { ...owner };
            };
          };
          const original = this.ethereumTransaction.ethSign.bind(this.ethereumTransaction);
          this.ethereumTransaction.ethSign = async (...input: Parameters<typeof original>) => {
            const saved = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as { guardianRecoveryIntents?: unknown[] };
            await beforeSignature?.();
            const signature = await original(...input);
            signatures.push({ address: input[0][0]!, digest: input[0][1]!, signature, intentPersisted: !!saved.guardianRecoveryIntents?.length });
            return signature;
          };
          const signPrepared = this.signPreparedEvmTransaction.bind(this);
          readPreparedRecord = async (chainId, from, hash) => {
            const entry = await new EvmSignedRecords(storage.signedRecords).readExact(
              { keyring: createTestCredentialRecordKeyring(storage.credential, credentialPort, this, () => { assert(this.hasPublicSession()); }), assertCurrent: () => { assert(this.hasPublicSession()); } }, chainId, from, hash);
            return entry?.rawTransaction ?? null;
          };
          this.signPreparedEvmTransaction = (...input: Parameters<typeof signPrepared>) => {
            const signed = signPrepared(...input);
            payerSignatures.push(signed.rawTransaction);
            return signed;
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
  await owner.importPhrase(PHRASE);
  await runtime.backup.confirm(await runtime.backup.fingerprint());
  await owner.refreshAuthenticatedMetadata();
  return {
    slhDerivations,
    get credentialReads() { return credentialReads; },
    get secretLeases() { return secretLeases; },
    get completedSecretLeases() { return completedSecretLeases; },
    afterSecretLease(hook?: () => void) { afterSecretLease = hook; },
    assertNoSigningKeys() { for (const instance of sdkInstances) assert.equal(instance.isUnlocked(), false); },
    assertOneSigningOperation() { assert.equal(sdkInstances.filter(instance => instance.isUnlocked()).length, 1); },
    mutateLedgerOwner(index: number, mutate: (account: IKeyringAccountState) => void) {assert(mutateLedgerOwner); mutateLedgerOwner(index, mutate);},
    mutateSelectedSmart(mutate: (account: IKeyringAccountState) => void) { assert(mutateSelectedSmart); mutateSelectedSmart(mutate); },
    installSlh() { assert(installSlh); installSlh(); },
    get owner() { return owner; }, get runtime() { return runtime; }, get storage() { return storage; },
    get sdkHost() { assert(sdkHost); return sdkHost; }, get sdkHostStorage() { assert(sdkHostStorage); return sdkHostStorage; },
    get physicalStorageCloses() { return physicalStorageCloses; }, calls, submitted, signatures, payerSignatures, spendabilityReads, estimatedSenders, infrastructureBroadcasts,
    infrastructureCode(id: PaliInfrastructureContractId, present: boolean) {
      const address = PALI_INFRASTRUCTURE_METADATA_BY_ID[id].address.toLowerCase();
      if (present) missingInfrastructure.delete(address); else missingInfrastructure.add(address);
    },
    infrastructureResponseLost() { failInfrastructureBroadcast = true; },
    initialEoaNonce(value: number) { assert(Number.isSafeInteger(value) && value >= 0); initialEoaNonce = value; },
    smartGuardian(address: string, owners: string[], options: { compositeThreshold?: number; threshold?: number; deployed?: boolean } = {}) {
      smartGuardianMetadata = { address, owners: [...owners], threshold: options.threshold ?? 1, compositeThreshold: options.compositeThreshold, deployed: options.deployed ?? true };
    },
    guardianStatus(mode: Parameters<ReturnType<typeof createGuardianRecoveryFixture>['select']>[0] = 'healthy') {
      const snapshot = runtime.catalogue.getSnapshot()!;
      const address = snapshot.accounts.find(account => account.id === snapshot.active.accountId && account.type === 'SmartAccount')!.address;
      guardian = createGuardianRecoveryFixture(address);
      guardian.select(mode, GUARDIAN_FIXTURE_RUNTIME);
      deployed = true;
      return guardian;
    },
    externalOwner() { externalOwner = true; },
    recoveredOwner(address: string) { recoveredOwner = address; },
    observedEcdsaOwners(addresses: string[], threshold: number) { observedOwners = addresses; observedThreshold = threshold; },
    customValidator(address: string, installed = false, compatible = true) { customValidators.set(address.toLowerCase(), { installed, compatible }); },
    observedCompositeChildren(children: string[], threshold = 1) { composite = { threshold, ecdsaFirst: true, children }; },
    observedComposite(threshold = 1, ecdsaFirst = false) { composite = { threshold, ecdsaFirst }; },
    observedPasskey() { observedPasskey = true; composite = undefined; observedSlh = undefined; },
    observedSlh(key: Pick<NativeSlhPublicState, 'pkRoot' | 'pkSeed'>) { observedSlh = { pkRoot: key.pkRoot, pkSeed: key.pkSeed }; },
    clearObservedSlh() { observedSlh = undefined; composite = undefined; },
    replaceSoftwareOwner(type: 'HDAccount' | 'Imported', id: number) { assert(replaceSoftwareOwner); replaceSoftwareOwner(type, id); },
    gasSponsored() { payerBalance = '0x0'; gasCredit = 10n ** 20n; },
    loseGasCredit() { gasCredit = 0n; },
    wrongChain() { wrongChain = true; },
    advanceSmartNonce() { externalSmartNonce++; },
    fundedSmart() { smartBalance = '0x1000000000000000'; },
    smartBalance(value: bigint) { smartBalance = '0x' + value.toString(16); },
    holdReceipts() { readReceipts = false; },
    showReceipts(success = true) { readReceipts = true; userOperationSuccess = success; },
    reorg() { readReceipts = false; nonceReset = true; },
    blockRecipient() { blockedRecipient = true; },
    undeployed() { deployed = false; },
    deployed(code = '0x01') { deployed = true; deployedCode = code; guardian = undefined; },
    interruptAfterReceipt() { interruptAfterReceipt = true; },
    onSmartCodeRead(hook: () => void | Promise<void>) { smartCodeRead = hook; },
    onCredentialRequest(hook: (check: () => void) => void | Promise<void>) { onCredentialRequest = hook; },
    onSignature(hook: () => void | Promise<void>) { beforeSignature = hook; },
    onBroadcast(hook: () => void | Promise<void>) { afterBroadcast = hook; },
    substitute() { substituteAddress = true; }, hold(value: () => Promise<void>) { hold = value; },
    async change(request: Parameters<NativeCustodyAuthority['manageAccounts']>[0]) {
      await owner.manageAccounts(request, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    },
    async selectNetwork(id: string) {
      await owner.selectNetwork(id, owner.getSnapshot().revision, owner.getCatalogue()!.revision, () => {});
    },
    async inspectRecovery() {
      const binding = (await storage.recovery.readIdentity())!.walletBindingId;
      const record = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
      return { record, accounts: inspectRecoveryCatalogue(record, binding).accounts };
    },
    async restoreCredential() {
      owner.lock();
      const recovery = new NativeRecoveryCoordinator({ credentialPort, isAuthenticationActive: () => false, owner, async retireControllers() {},
        ensureCryptoReady: async () => undefined, openStorage });
      try {
        const proof = await prepareRecoveryCredential(recovery, PHRASE, () => undefined);
        assert.equal(await recovery.commit(proof), 'committed-locked');
      } finally { await recovery.dispose(); }
      owner = await open();
      await owner.unlock();
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
      owner = await open(); await owner.unlock();
    },
    async captureOriginalJournal() { assert(captureJournal); return captureJournal(); },
    async close() { await owner.dispose(); await rm(directory, { recursive: true, force: true }); },
  };
}

async function readyLedgerInfrastructure(hooks: {before?: SqlHook; after?: SqlHook} = {}) {
  const device = nativeSmartLedgerDevice(), deviceTransactions: string[] = [];
  let f!: Awaited<ReturnType<typeof fixture>>;
  let beforeDevice: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let failRetirement = false;
  const factory: NonNullable<KeyringRuntimeDependencies['createLedgerTransport']> = async scope => {
    const transport = await device.factory(scope);
    disconnect = () => transport.host.disconnect();
    return {...transport, async dispose() {
      await transport.dispose();
      if (failRetirement) {failRetirement = false; throw Object.assign(Error('Ledger retirement not proven'), {transactionNotBroadcast: true});}
    }, host: {...transport.host, evm: {...transport.host.evm,
      async signTransaction(request, authority) {
        assert(authority?.assertCurrent); authority.assertCurrent();
        const unsigned = Transaction.from(`0x${request.unsignedTxHex}`);
        const record = (await f.inspectRecovery()).record as {infrastructurePending?: readonly NativeInfrastructurePending[]};
        const pending = record.infrastructurePending?.[0];
        assert(pending, 'the exact reservation must be durable before any Ledger device signing');
        assert.equal(pending.payer.id, 'ledger:60:0'); assert.equal(pending.entry.nonce, unsigned.nonce);
        assert.equal(pending.entry.payerAddress, request.expectedAddress);
        assert.equal(pending.entry.transactionHash, undefined);
        assert.equal(f.runtime.ledger.isConnected(), true, 'pending-only catalogue publication must retain verified device ownership');
        deviceTransactions.push(unsigned.unsignedSerialized);
        await beforeDevice?.(); authority.assertCurrent();
        const signature = device.wallets[request.accountIndex]!.signingKey.sign(unsigned.unsignedHash);
        return {r: signature.r.slice(2), s: signature.s.slice(2), v: signature.v.toString(16)};
      },
    }}};
  };
  f = await fixture(hooks, true, null, factory);
  const picker = new NativeLedgerAccounts(f.owner, () => f.runtime.ledger, 'import');
  let connection: NativeLedgerAccounts<'connect'> | undefined;
  try {
    await picker.start(); await picker.select(picker.getSnapshot().devices[0]!.id); await picker.importAccount('Infrastructure Ledger');
    const catalogue = f.owner.getCatalogue()!;
    if (catalogue.active.accountId !== 'ledger:60:0') await f.change({kind: 'select', id: 'ledger:60:0'});
    return {f, device, deviceTransactions,
      beforeDevice(hook: () => Promise<void>) {beforeDevice = hook;},
      failRetirement() {failRetirement = true;},
      async disconnect() {assert(disconnect); await disconnect();},
      async connect() {
        await connection?.dispose();
        connection = new NativeLedgerAccounts(f.owner, () => f.runtime.ledger, 'connect');
        await connection.start(); await connection.select(connection.getSnapshot().devices[0]!.id); await connection.finishConnection();
      },
      async close() {await connection?.dispose(); await picker.dispose(); await f.close();},
    };
  } catch (error) {await connection?.dispose(); await picker.dispose(); await f.close(); throw error;}
}

for (const uncertain of [false, true]) test(`Ledger infrastructure private SDK preserves reservation, exact signed bytes and reopen reconciliation (${uncertain})`, async () => {
  const owned = await readyLedgerInfrastructure(), {f} = owned;
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  try {
    f.initialEoaNonce(7); f.infrastructureCode('ecdsaValidator', false); f.infrastructureCode('factory', false); f.holdReceipts();
    if (uncertain) f.infrastructureResponseLost();
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision); await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review, JSON.stringify(controller.getSnapshot()));
    assert.equal(Number(review.transaction.nonce), 7); assert.equal(owned.deviceTransactions.length, 0);
    const before = f.runtime.catalogue.getSnapshot()!, payer = before.accounts.find(account => account.id === before.active.accountId)!;
    await owned.connect();
    f.onBroadcast(() => {
      const current = f.runtime.catalogue.getSnapshot()!;
      assert.equal(current.accounts.find(account => account.id === current.active.accountId), payer);
      assert.equal(f.runtime.ledger.isConnected(), true);
    });
    await controller.confirm(review.id);
    assert.equal(controller.getSnapshot().phase, uncertain ? 'unknown' : 'pending', JSON.stringify(controller.getSnapshot()));
    assert.equal(owned.deviceTransactions.length, 1); assert.equal(f.payerSignatures.length, 0); assert.equal(f.submitted.length, 1);
    const transaction = Transaction.from(f.submitted[0]);
    assert.equal(transaction.from, owned.device.wallets[0]!.address); assert.equal(transaction.unsignedSerialized, owned.deviceTransactions[0]);
    assert.equal(transaction.nonce, 7); assert.equal(transaction.data, review.transaction.data);
    assert.equal(f.infrastructureBroadcasts[0]!.pending.entry.nonce, 7);
    assert.equal(f.infrastructureBroadcasts[0]!.pending.payer.xpub, owned.device.wallets[0]!.signingKey.publicKey.toLowerCase());
    assert.equal(f.runtime.ledger.isConnected(), true, 'hash acknowledgement must preserve only this owned Ledger proof');
    await controller.reviewNext(controller.getSnapshot().revision);
    assert.equal(owned.deviceTransactions.length, 1); assert.equal(f.submitted.length, 1);
    controller.dispose(); controller = undefined; f.onBroadcast(() => undefined);
    await f.reopen(); await f.owner.unlock();
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().phase, 'pending', JSON.stringify(controller.getSnapshot()));
    await controller.reviewNext(controller.getSnapshot().revision);
    assert.equal(owned.deviceTransactions.length, 1); assert.equal(f.submitted.length, 1);
    f.showReceipts(); await controller.refresh(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().phase, 'ready', JSON.stringify(controller.getSnapshot()));
    assert.deepEqual(((await f.inspectRecovery()).record as {infrastructurePending: unknown[]}).infrastructurePending, []);
    f.infrastructureCode('ecdsaValidator', true);
    await controller.reviewNext(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().feeReview!.contract.id, 'factory'); assert.equal(Number(controller.getSnapshot().feeReview!.transaction.nonce), 8);
    assert.equal(owned.deviceTransactions.length, 1);
  } finally {controller?.dispose(); await owned.close();}
});

for (const failure of ['disconnected', 'rejected', 'disconnect-during-device'] as const) test(`Ledger infrastructure private SDK ${failure} cannot broadcast and clears its exact unsent attempt`, async () => {
  const owned = await readyLedgerInfrastructure(), {f} = owned;
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  try {
    f.infrastructureCode('factory', false);
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision); await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review);
    if (failure !== 'disconnected') await owned.connect();
    if (failure === 'rejected') owned.beforeDevice(async () => {throw Error('Ledger user rejected');});
    if (failure === 'disconnect-during-device') owned.beforeDevice(() => owned.disconnect());
    await controller.confirm(review.id);
    assert.equal(controller.getSnapshot().phase, 'failed', JSON.stringify(controller.getSnapshot()));
    assert.equal(owned.deviceTransactions.length, failure === 'disconnected' ? 0 : 1);
    assert.equal(f.payerSignatures.length, 0); assert.equal(f.submitted.length, 0);
    assert.equal(f.runtime.ledger.isConnected(), false, 'a rejected or disconnected device must lose its verified proof');
    if (failure === 'disconnected') assert.equal(f.runtime.catalogue.getSnapshot(), null, 'unadmitted hardware still follows the generic locking policy');
    else assert(f.runtime.catalogue.getSnapshot(), 'an SDK-proven signing refusal must leave the current custody session available');
    assert.deepEqual(((await f.inspectRecovery()).record as {infrastructurePending: unknown[]}).infrastructurePending, []);
  } finally {controller?.dispose(); await owned.close();}
});

for (const failure of ['context-retired', 'unproven-retirement'] as const) test(`Ledger infrastructure private SDK ${failure} keeps an uncertain attempt and never trusts public failure flags`, async () => {
  const owned = await readyLedgerInfrastructure(), {f} = owned;
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  try {
    f.infrastructureCode('factory', false); f.holdReceipts();
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision); await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review); await owned.connect();
    owned.beforeDevice(async () => {
      if (failure === 'context-retired') f.owner.lock();
      else {owned.failRetirement(); throw Error('Ledger user rejected');}
    });
    await controller.confirm(review.id);
    assert.equal(controller.getSnapshot().phase, 'unknown', JSON.stringify(controller.getSnapshot()));
    assert.equal(f.runtime.catalogue.getSnapshot(), null); assert.equal(f.runtime.ledger.isConnected(), false);
    assert.equal(owned.deviceTransactions.length, 1); assert.equal(f.submitted.length, 0);
    controller.dispose(); controller = undefined;
    if (failure === 'unproven-retirement') await f.reopenQuarantined(); else await f.reopen();
    await f.owner.unlock();
    const stored = (await f.inspectRecovery()).record as {infrastructurePending: readonly NativeInfrastructurePending[]};
    assert.equal(stored.infrastructurePending.length, 1); assert.equal(stored.infrastructurePending[0]!.entry.transactionHash, undefined);
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision); await controller.reviewNext(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().phase, 'pending', JSON.stringify(controller.getSnapshot()));
    assert.equal(owned.deviceTransactions.length, 1); assert.equal(f.submitted.length, 0);
  } finally {controller?.dispose(); await owned.close();}
});

test('Ledger infrastructure private SDK drains retired pre-signer cleanup before physical storage closes', async () => {
  const lifetime = new AbortController(), cleanup = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let armed = false, retired = false, beforeRevision = -1;
  const owned = await readyLedgerInfrastructure({before: async (kind, sql) => {
    if (retired && kind === 'run' && sql.startsWith('UPDATE keyring_records')) {cleanup.resolve(); await release.promise;}
  }}), {f} = owned;
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  let confirmation: Promise<void> | undefined, closing: Promise<void> | undefined;
  try {
    f.infrastructureCode('factory', false);
    controller = await f.runtime.openSmartInfrastructure(lifetime.signal, () => {
      if (armed && (f.runtime.catalogue.getSnapshot()?.revision ?? -1) > beforeRevision) {armed = false; retired = true; lifetime.abort();}
    }, null);
    await controller.refresh(controller.getSnapshot().revision); await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review); await owned.connect();
    beforeRevision = f.runtime.catalogue.getSnapshot()!.revision;
    const closes = f.physicalStorageCloses; armed = true;
    confirmation = controller.confirm(review.id);
    await Promise.race([cleanup.promise, confirmation.then(() => {throw Error('confirmation settled without Ledger unsigned cleanup');})]);
    let closed = false; closing = f.owner.dispose().then(() => {closed = true;});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, false); assert.equal(f.physicalStorageCloses, closes);
    assert.equal(owned.deviceTransactions.length, 0); assert.equal(f.runtime.catalogue.getSnapshot(), null);
    release.resolve(); await confirmation; await closing;
    assert.equal(f.physicalStorageCloses, closes + 1);
    controller = undefined; await f.reopen(); await f.owner.unlock();
    assert.deepEqual(((await f.inspectRecovery()).record as {infrastructurePending: unknown[]}).infrastructurePending, []);
    assert.equal(f.submitted.length, 0);
  } finally {release.resolve(); await confirmation?.catch(() => undefined); await closing?.catch(() => undefined); controller?.dispose(); await owned.close();}
});

for (const uncertain of [false, true]) test(`native infrastructure private SDK reserves the reviewed nonce and reconciles after reopen without duplicate submission (${uncertain})`, async () => {
  const f = await fixture({}, true);
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  try {
    f.initialEoaNonce(7);
    f.infrastructureCode('ecdsaValidator', false); f.infrastructureCode('factory', false);
    f.holdReceipts();
    if (uncertain) f.infrastructureResponseLost();
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().phase, 'ready', JSON.stringify(controller.getSnapshot()));
    assert.deepEqual(controller.getSnapshot().status!.observation.missing, ['ecdsaValidator', 'factory']);
    await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!;
    assert(review, JSON.stringify(controller.getSnapshot()));
    assert.equal(review.contract.id, 'ecdsaValidator'); assert.equal(Number(review.transaction.nonce), 7);
    const contracts = await import('../../../source/utils/smartAccount/deployment.ts');
    const contract = contracts.getPaliInfrastructureContracts(1).find(contract => contract.id === 'ecdsaValidator')!;
    assert.equal(review.transaction.data, contract.deployCalldata);
    assert.equal(review.transaction.to!.toLowerCase(), PALI_CREATE2_DEPLOYER_ADDRESS.toLowerCase());
    assert.equal(BigInt(review.transaction.value), 0n);
    assert.equal(f.payerSignatures.length, 0); assert.equal(f.submitted.length, 0);
    const before = f.runtime.catalogue.getSnapshot()!;
    const payer = before.accounts.find(account => account.id === before.active.accountId)!;
    f.onBroadcast(() => {
      const current = f.runtime.catalogue.getSnapshot()!;
      assert.equal(current.accounts.find(account => account.id === current.active.accountId), payer,
        'a pending-only reservation must preserve the captured SDK selected-context object');
    });
    await controller.confirm(review.id);
    assert.equal(controller.getSnapshot().phase, uncertain ? 'unknown' : 'pending', JSON.stringify(controller.getSnapshot()));
    assert.equal(f.submitted.length, 1); assert.equal(f.payerSignatures.length, 1);
    assert.equal(f.infrastructureBroadcasts.length, 1);
    const raw = Transaction.from(f.submitted[0]);
    const captured = f.infrastructureBroadcasts[0]!;
    assert.equal(captured.rawTransaction, f.payerSignatures[0]);
    assert.equal(raw.from!.toLowerCase(), payer.address.toLowerCase()); assert.equal(raw.nonce, Number(review.transaction.nonce));
    assert.equal(raw.to!.toLowerCase(), PALI_CREATE2_DEPLOYER_ADDRESS.toLowerCase()); assert.equal(raw.data, review.transaction.data);
    assert.equal(captured.pending.entry.nonce, raw.nonce); assert.equal(captured.pending.entry.contractId, review.contract.id);
    assert.equal(captured.pending.entry.payerAddress.toLowerCase(), raw.from!.toLowerCase());
    assert.equal(captured.pending.entry.transactionHash, undefined, 'hash acknowledgement follows the existing submit boundary');
    const stored = (await f.inspectRecovery()).record as { infrastructurePending: readonly NativeInfrastructurePending[] };
    assert.equal(stored.infrastructurePending[0]!.entry.transactionHash, raw.hash);
    await controller.reviewNext(controller.getSnapshot().revision);
    assert.equal(f.payerSignatures.length, 1); assert.equal(f.submitted.length, 1);
    controller.dispose(); controller = undefined;
    f.onBroadcast(() => undefined);
    await f.reopen(); await f.owner.unlock();
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().phase, 'pending', JSON.stringify(controller.getSnapshot()));
    assert.equal(controller.getSnapshot().status!.pending!.transactionHash, raw.hash);
    await controller.reviewNext(controller.getSnapshot().revision);
    assert.equal(f.payerSignatures.length, 1); assert.equal(f.submitted.length, 1);
    const receiptReads = f.calls.filter(method => method === 'eth_getTransactionReceipt').length;
    f.showReceipts();
    await controller.refresh(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().phase, 'ready', JSON.stringify(controller.getSnapshot()));
    assert(f.calls.filter(method => method === 'eth_getTransactionReceipt').length > receiptReads);
    assert.deepEqual(((await f.inspectRecovery()).record as { infrastructurePending: unknown[] }).infrastructurePending, []);
    f.infrastructureCode('ecdsaValidator', true);
    await controller.reviewNext(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().feeReview!.contract.id, 'factory');
    assert.equal(Number(controller.getSnapshot().feeReview!.transaction.nonce), 8);
    assert.equal(f.payerSignatures.length, 1); assert.equal(f.submitted.length, 1);
    f.infrastructureCode('factory', true);
    await controller.refresh(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().phase, 'complete', JSON.stringify(controller.getSnapshot()));
  } finally { controller?.dispose(); await f.close(); }
});

test('native infrastructure private SDK retains a broadcast reservation when its route retires before acknowledgement', async () => {
  const f = await fixture({}, true), lifetime = new AbortController();
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  try {
    f.initialEoaNonce(9); f.infrastructureCode('factory', false); f.holdReceipts();
    controller = await f.runtime.openSmartInfrastructure(lifetime.signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision);
    await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review, JSON.stringify(controller.getSnapshot()));
    f.onBroadcast(() => lifetime.abort());
    await controller.confirm(review.id);
    assert.equal(f.submitted.length, 1); assert.equal(f.payerSignatures.length, 1);
    const reserved = ((await f.inspectRecovery()).record as { infrastructurePending: readonly NativeInfrastructurePending[] }).infrastructurePending[0]!;
    assert.equal(reserved.entry.nonce, 9); assert.equal(reserved.entry.transactionHash, undefined);
    controller.dispose(); controller = undefined; f.onBroadcast(() => undefined);
    await f.reopen(); await f.owner.unlock();
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().phase, 'pending', JSON.stringify(controller.getSnapshot()));
    await controller.reviewNext(controller.getSnapshot().revision);
    assert.equal(f.payerSignatures.length, 1); assert.equal(f.submitted.length, 1);
    f.showReceipts(); await controller.refresh(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().phase, 'ready', JSON.stringify(controller.getSnapshot()));
    assert.deepEqual(((await f.inspectRecovery()).record as { infrastructurePending: unknown[] }).infrastructurePending, []);
    assert.equal(f.payerSignatures.length, 1); assert.equal(f.submitted.length, 1);
  } finally { controller?.dispose(); await f.close(); }
});

test('native infrastructure private SDK clears a durable unsent reservation when shared fee refresh rejects before signing', async () => {
  let armed = false, journalWrites = 0;
  const f = await fixture({ after(kind, sql) {
    if (armed && kind === 'run' && sql.startsWith('UPDATE keyring_records')) journalWrites++;
  } }, true);
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  try {
    f.infrastructureCode('factory', false);
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision);
    await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review, JSON.stringify(controller.getSnapshot()));
    f.gasSponsored(); // An ordinary EOA has no Smart-account sponsorship route.
    armed = true;
    await controller.confirm(review.id);
    armed = false;
    assert.equal(controller.getSnapshot().phase, 'failed', 'successful private unsent cleanup must not publish phantom broadcast uncertainty');
    assert.equal(journalWrites, 4, 'reserve and exact unsent clear each atomically write the catalogue and its unchanged public checkpoint');
    assert.equal(f.payerSignatures.length, 0); assert.equal(f.submitted.length, 0);
    assert.deepEqual(((await f.inspectRecovery()).record as { infrastructurePending: unknown[] }).infrastructurePending, []);
    await controller.refresh(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().phase, 'ready', JSON.stringify(controller.getSnapshot()));
    assert.equal(controller.getSnapshot().status!.pending, null);
  } finally { controller?.dispose(); await f.close(); }
});

test('native infrastructure private SDK drains admitted unsigned cleanup after route retirement before physical storage close', async () => {
  const lifetime = new AbortController();
  let armed = false, retiredAfterReserve = false, beforeRevision = -1;
  const cleanup = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await fixture({ before: async (kind, sql) => {
    if (retiredAfterReserve && kind === 'run' && sql.startsWith('UPDATE keyring_records')) {
      cleanup.resolve(); await release.promise;
    }
  } }, true);
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  let confirmation: Promise<void> | undefined, closing: Promise<void> | undefined;
  try {
    f.infrastructureCode('factory', false);
    controller = await f.runtime.openSmartInfrastructure(lifetime.signal, () => {
      if (armed && (f.runtime.catalogue.getSnapshot()?.revision ?? -1) > beforeRevision) {
        armed = false; retiredAfterReserve = true; lifetime.abort();
      }
    }, null);
    await controller.refresh(controller.getSnapshot().revision); await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review, JSON.stringify(controller.getSnapshot()));
    beforeRevision = f.runtime.catalogue.getSnapshot()!.revision;
    const closes = f.physicalStorageCloses;
    armed = true;
    confirmation = controller.confirm(review.id);
    await Promise.race([cleanup.promise, confirmation.then(() => { throw Error('confirmation settled without exact unsigned cleanup'); })]);
    let closeSettled = false;
    closing = f.owner.dispose().then(() => { closeSettled = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closeSettled, false, 'physical close must join the entire admitted confirmation span');
    assert.equal(f.physicalStorageCloses, closes);
    assert.equal(f.runtime.catalogue.getSnapshot(), null, 'cleanup must not revive the locked source');
    assert.equal(f.payerSignatures.length, 0); assert.equal(f.submitted.length, 0);
    release.resolve(); await confirmation; await closing;
    assert.equal(f.physicalStorageCloses, closes + 1);
    controller = undefined;
    await f.reopen(); await f.owner.unlock();
    assert.deepEqual(((await f.inspectRecovery()).record as { infrastructurePending: unknown[] }).infrastructurePending, []);
    assert.equal(f.payerSignatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally {
    release.resolve(); await confirmation?.catch(() => undefined); await closing?.catch(() => undefined);
    controller?.dispose(); await f.close();
  }
});

test('a failed main-catalogue adoption after detached cleanup quarantines custody until reopen', async () => {
  let armed = false, writes = 0, committed = false, reads = 0, injected = false;
  const f = await fixture({
    after(kind, sql) {
      if (armed && kind === 'run' && sql.startsWith('UPDATE keyring_records')) writes++;
      if (armed && kind === 'exec' && sql === 'COMMIT' && writes === 4) committed = true;
    },
    before(kind, sql) {
      if (committed && kind === 'get' && sql.includes('FROM keyring_records WHERE key = ?') && ++reads === 2) {
        committed = false; injected = true; throw Error('Main catalogue adoption read failed');
      }
    },
  }, true);
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  try {
    f.infrastructureCode('factory', false);
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => {}, null);
    await controller.refresh(controller.getSnapshot().revision); await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review);
    f.gasSponsored(); armed = true;
    await controller.confirm(review.id); armed = false;
    assert(injected, 'the fault must occur after the detached mutation readback, during main adoption');
    assert.equal(controller.getSnapshot().phase, 'unknown');
    await assert.rejects(f.runtime.session.readSelectedAddress(), /CLEANUP_FAILED|CANCELLED|NOT_READY/);
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    assert.equal(f.payerSignatures.length, 0); assert.equal(f.submitted.length, 0);
    controller.dispose(); controller = undefined;
    await f.reopenQuarantined(); await f.owner.unlock();
    assert.deepEqual(((await f.inspectRecovery()).record as { infrastructurePending: unknown[] }).infrastructurePending, []);
  } finally { controller?.dispose(); await f.close(); }
});

test('creation allocation saves the canonical bootstrap before publication without a password or signing operation', async () => {
  const f = await fixture({}, true), lifetime = new AbortController();
  try {
    const host = await f.runtime.openConnectionHost(), management = host.context().accounts.find(account => account.id === 'hd:60:0')!;
    let committed: NativeSmartCreationAllocation | undefined;
    const allocation = await host.allocateSmartAccount({ networkId: 'ethereum', label: 'Dapp savings', target: { id: 'ecdsa', config: undefined }, externalOwnersAcknowledged: false }, lifetime.signal, () => undefined, receipt => {
      committed = receipt; receipt.assertCurrent();
      assert.equal(f.runtime.catalogue.getSnapshot()!.accounts.some(account => account.type === 'SmartAccount'), false, 'request adopts its receipt before catalogue publication');
    }, null);
    assert.equal(allocation, committed); allocation.assertCurrent();
    assert(Object.isFrozen(allocation)); assert(Object.isFrozen(allocation.account)); assert(Object.isFrozen(allocation.target));
    assert.equal(allocation.account.id, 'smart:60:0'); assert.equal(host.context().activeAccountId, allocation.account.id);
    const saved = savedSmartAccount((await f.inspectRecovery()).record);
    assert.equal(saved.address, allocation.account.address);
    assert.equal(saved.smartAccount.auth.data, encodeEcdsaValidatorInitData([management.address], 1));
    assert.equal(saved.smartAccount.isDeployed, false);
    await assert.rejects(host.prepareSmartAccountCreationOperation(allocation, nonSuiteSigningHandoff, () => undefined, null), { code: 'INVALID_INPUT' });
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
    lifetime.abort(); assert.throws(allocation.assertCurrent, { code: 'CANCELLED' });
    await f.reopen(); await f.owner.unlock();
    assert.equal(f.owner.getCatalogue()!.accounts.find(account => account.id === allocation.account.id)!.address, allocation.account.address);
  } finally { await f.close(); }
});

test('creation allocation snapshots its target and rejects forged receipts or an unacknowledged external owner before allocation', async () => {
  const f = await fixture({}, true), lifetime = new AbortController();
  try {
    const host = await f.runtime.openConnectionHost(), target = { id: 'ecdsa' as const, config: { owners: ['0x' + '66'.repeat(20)], threshold: 1 } };
    const request = { networkId: 'ethereum', label: 'External owner', target, externalOwnersAcknowledged: false };
    const calls = f.calls.length;
    await assert.rejects(host.allocateSmartAccount(request, lifetime.signal, () => undefined, () => undefined, null), { code: 'INVALID_INPUT' });
    assert.equal(f.calls.length, calls); assert.equal(f.runtime.catalogue.getSnapshot()!.accounts.length, 1);
    const allocation = await host.allocateSmartAccount({ ...request, externalOwnersAcknowledged: true }, lifetime.signal, () => undefined, () => undefined, null);
    target.config.owners[0] = '0x' + '77'.repeat(20);
    assert(allocation.target.id === 'ecdsa' && allocation.target.config);
    assert.deepEqual(allocation.target.config.owners, ['0x' + '66'.repeat(20)]);
    await assert.rejects(host.prepareSmartAccountCreationOperation({ ...allocation }, nonSuiteSigningHandoff, () => undefined, null), { code: 'INVALID_INPUT' });
    await assert.rejects(host.prepareSmartAccountCreationOperation({ ...allocation, target }, nonSuiteSigningHandoff, () => undefined, null), { code: 'INVALID_INPUT' });
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});

test('creation allocation retains a committed account when its request cancels during the commit callback', async () => {
  const f = await fixture({}, true), lifetime = new AbortController();
  let committed: NativeSmartCreationAllocation | undefined;
  try {
    const host = await f.runtime.openConnectionHost();
    await assert.rejects(host.allocateSmartAccount({ networkId: 'ethereum', label: 'Cancelled after save', target: { id: 'ecdsa', config: undefined }, externalOwnersAcknowledged: false }, lifetime.signal, () => undefined, receipt => {
      committed = receipt; lifetime.abort();
    }, null), { code: 'CANCELLED' });
    assert(committed); assert.throws(committed.assertCurrent, { code: 'CANCELLED' });
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).address, committed.account.address);
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});

test('creation allocation rejects an invalid label or unselected network before allocator reads', async () => {
  const f = await fixture();
  try {
    const host = await f.runtime.openConnectionHost(), calls = f.calls.length;
    for (const [networkId, label] of [['ethereum', ' padded '], ['ethereum', 'x'.repeat(65)], ['nevm', 'Wrong network']])
      await assert.rejects(host.allocateSmartAccount({ networkId: networkId!, label: label!, target: { id: 'ecdsa', config: undefined }, externalOwnersAcknowledged: false }, new AbortController().signal, () => undefined, () => undefined, null));
    assert.equal(f.calls.length, calls); assert.equal(f.runtime.catalogue.getSnapshot()!.accounts.length, 1);
  } finally { await f.close(); }
});

for (const target of [{ id: 'p256-webauthn' }, { id: 'slh-dsa' }] as const) test(`creation allocation rejects unavailable ${target.id} acquisition before allocating`, async () => {
  const f = await fixture();
  try {
    const host = await f.runtime.openConnectionHost(), calls = f.calls.length;
    await assert.rejects(host.allocateSmartAccount({ networkId: 'ethereum', label: 'Unavailable credential', target, externalOwnersAcknowledged: false }, new AbortController().signal, () => undefined, () => undefined, null));
    assert.equal(f.calls.length, calls); assert.equal(f.runtime.catalogue.getSnapshot()!.accounts.length, 1);
    assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});

test('creation allocation serializes the real allocator and cancellation before commit saves no account', async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), lifetime = new AbortController();
  try {
    const host = await f.runtime.openConnectionHost(), input = { networkId: 'ethereum', label: 'Held allocation', target: { id: 'ecdsa' as const, config: undefined }, externalOwnersAcknowledged: false };
    f.hold(async () => { entered.resolve(); await release.promise; });
    const allocating = host.allocateSmartAccount(input, lifetime.signal, () => undefined, () => assert.fail('Cancelled allocation committed'), null);
    const rejected = assert.rejects(allocating);
    await entered.promise;
    await assert.rejects(host.allocateSmartAccount(input, lifetime.signal, () => undefined, () => undefined, null), /BUSY/);
    lifetime.abort(); release.resolve(); await rejected;
    f.owner.lock(); await f.owner.unlock();
    assert.equal(f.owner.getCatalogue()!.accounts.length, 1); assert.equal(f.submitted.length, 0);
  } finally { release.resolve(); await f.close(); }
});

for (const change of ['owner', 'network', 'source-auth'] as const) test(`creation allocation refuses ${change} drift before preparing its captured target`, async () => {
  const f = await fixture({}, true);
  try {
    const host = await f.runtime.openConnectionHost(), owner = host.context().accounts.find(account => account.id === 'hd:60:0')!.address;
    let current = true;
    const allocation = await host.allocateSmartAccount({ networkId: 'ethereum', label: 'Bound creation', target: { id: 'ecdsa', config: { owners: [owner], threshold: 1 } }, externalOwnersAcknowledged: false }, new AbortController().signal, () => { if (!current) throw Error('REQUEST_RETIRED'); }, () => undefined, null);
    if (change === 'owner') current = false;
    else if (change === 'network') await f.selectNetwork('syscoin-nevm');
    else { f.guardianStatus('no-policy'); f.observedEcdsaOwners(['0x' + '77'.repeat(20)], 1); }
    await assert.rejects(host.prepareSmartAccountCreationOperation(allocation, nonSuiteSigningHandoff, () => undefined, null));
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});

test('creation allocation retries the same saved address after a later read failure and configures through existing operations', async () => {
  const f = await fixture({}, true);
  let deployment: NativeSmartAccountOperation | undefined, configuration: NativeSmartAccountOperation | undefined, noOp: NativeSmartAccountOperation | undefined;
  try {
    const host = await f.runtime.openConnectionHost(), requestedOwner = '0x' + '66'.repeat(20);
    const allocation = await host.allocateSmartAccount({ networkId: 'ethereum', label: 'Configured creation', target: { id: 'ecdsa', config: { owners: [requestedOwner], threshold: 1 } }, externalOwnersAcknowledged: true }, new AbortController().signal, () => undefined, () => undefined, null);
    f.guardianStatus('unavailable');
    await assert.rejects(host.prepareSmartAccountCreationOperation(allocation, nonSuiteSigningHandoff, () => undefined, null));
    allocation.assertCurrent(); assert.equal(f.runtime.catalogue.getSnapshot()!.accounts.filter(account => account.type === 'SmartAccount').length, 1);
    f.deployed(); f.undeployed();
    deployment = await host.prepareSmartAccountCreationOperation(allocation, nonSuiteSigningHandoff, () => undefined, null);
    assert.equal(deployment.getSnapshot().intent.kind, 'deploy'); await deployment.prepare();
    const deploying = deployment.authorize(deployment.getSnapshot().revision);
    for (let i = 0; i < 300 && !['complete', 'failed'].includes(deployment.getSnapshot().phase); i++) {
      const review = deployment.getSnapshot().payerReview; if (review) deployment.confirmPayer(review.id);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await deploying; assert.equal(deployment.getSnapshot().phase, 'complete', JSON.stringify(deployment.getSnapshot()));
    await deployment.dispose(); deployment = undefined;
    f.guardianStatus('no-policy'); f.fundedSmart();
    configuration = await host.prepareSmartAccountCreationOperation(allocation, nonSuiteSigningHandoff, () => undefined, null);
    await configuration.prepare(); const intent = configuration.getSnapshot().intent;
    assert(intent.kind === 'authenticator'); assert.equal(intent.command.executions.length, 1);
    const rotate = paliSmartAccountInterface.decodeFunctionData('rotateValidator', intent.command.executions[0]!.data);
    assert.equal(rotate[2], encodeEcdsaValidatorInitData([requestedOwner], 1));
    f.onBroadcast(() => f.observedEcdsaOwners([requestedOwner], 1));
    const configuring = configuration.authorize(configuration.getSnapshot().revision);
    for (let i = 0; i < 300 && !configuration.getSnapshot().payerReview && configuration.getSnapshot().phase !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(configuration.getSnapshot().payerReview, JSON.stringify(configuration.getSnapshot()));
    configuration.confirmPayer(configuration.getSnapshot().payerReview!.id); await configuring;
    assert.equal(configuration.getSnapshot().phase, 'complete'); assert.equal(configuration.getSnapshot().metadataRefresh, 'complete');
    await configuration.dispose(); configuration = undefined;
    const signed = f.signatures.length, submitted = f.submitted.length;
    noOp = await host.prepareSmartAccountCreationOperation(allocation, nonSuiteSigningHandoff, () => undefined, null); await noOp.prepare();
    assert.equal(noOp.getSnapshot().phase, 'complete'); assert.equal(noOp.getSnapshot().metadataRefresh, 'complete');
    assert.equal(f.signatures.length, signed); assert.equal(f.submitted.length, submitted);
    assert.equal(f.runtime.catalogue.getSnapshot()!.accounts.find(account => account.id === allocation.account.id)!.address, allocation.account.address);
    assert.equal(f.runtime.catalogue.getSnapshot()!.accounts.filter(account => account.type === 'SmartAccount').length, 1);
  } finally { await deployment?.dispose(); await configuration?.dispose(); await noOp?.dispose(); await f.close(); }
});

test('real SDK smart account creation, selection and cold unlock retain the original owner and receive address', async () => {
  const f = await fixture();
  try {
    const ownerAddress = f.owner.getSnapshot().account!.address;
    await f.change({ kind: 'create', label: 'Other selected account',});
    assert.notEqual(f.owner.getSnapshot().account!.address, ownerAddress);
    await f.change({ kind: 'create-smart', label: 'Smart savings',});
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
    await f.owner.unlock();
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
    await assert.rejects(f.change({ kind: 'remove', id: 'hd:60:0',}), { code: 'ACCOUNT_NOT_REMOVABLE' });
  } finally { await f.close(); }
});

test('wallet authenticator recognizes an already configured owner without signing or submission', async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Wallet authenticator',});
    f.guardianStatus('no-policy');
    operation = await f.runtime.openWalletAuthenticator(new AbortController().signal, () => undefined, null);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'complete');
    assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
    assert.equal(operation.getSnapshot().transactionHash, null);
    assert.equal(f.signatures.length, 0);
    assert.equal(f.submitted.length, 0);
  } finally { operation?.dispose(); await f.close(); }
});

test('native passkey setup survives owned inactive/blur prompts and cold reopen without decrypting the signing root', async () => {
  let f!: Awaited<ReturnType<typeof fixture>>, creates = 0, assertions = 0, prompt = false;
  let state = 'active';
  const scope = createNativePrivateAuthenticationScope(), lifetime = new AbortController();
  const viewGuard = () => assert(state === 'active' || allowsPrivateAuthenticationInterruption(scope, state), 'view retired');
  const registration = { backupStatus: 'deviceBound' as const, credentialId: 'AQ', credentialIdHash: '0x' + '01'.repeat(32),
    rawId: 'AQ', userHandle: 'Ag', x: '0x' + '02'.repeat(32), y: '0x' + '03'.repeat(32),
    rpIdHash: '0x' + '04'.repeat(32), originHash: '0x' + '05'.repeat(32), originLength: 22 };
  const passkeys: NonNullable<KeyringRuntimeDependencies['passkeys']> = {
    async create(request) { prompt = true; state = 'inactive'; try { f.assertNoSigningKeys(); request.assertCurrent(); assert(scope.isAuthenticating()); creates++; return registration; } finally { state = 'active'; prompt = false; } },
    async sign(request) { prompt = true; state = 'blur'; try { f.assertNoSigningKeys(); request.assertCurrent(); assert(scope.isAuthenticating()); assertions++; assert.equal(request.expectedCredentialIdHash, registration.credentialIdHash); return { signature: '0xab' }; } finally { state = 'active'; prompt = false; } },
    async recover() { throw Error('Unexpected credential recovery'); },
  };
  f = await fixture({}, true, null, undefined, undefined, passkeys);
  const binding = bindNativePrivateAuthentication(scope, { assertCurrent() {}, isPromptActive: () => prompt });
  let first: NativeSmartAccountOperation | undefined, second: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Passkey account' }); f.guardianStatus('no-policy'); f.fundedSmart();
    first = await f.runtime.openPasskeyAuthenticator(false, lifetime.signal, viewGuard, binding);
    assert.equal(creates, 1); assert.equal(assertions, 0); assert.equal(f.signatures.length, 0);
    await first.dispose(); first = undefined;
    await f.reopen(); await f.owner.unlock();
    second = await f.runtime.openPasskeyAuthenticator(false, lifetime.signal, viewGuard, binding);
    assert.equal(creates, 1); assert.equal(assertions, 1);
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0); f.assertNoSigningKeys();
  } finally { scope.retire(); lifetime.abort(); await first?.dispose(); await second?.dispose(); await f.close(); }
});

for (const delayedMetadata of [false, 'stale', 'unavailable'] as const) test(`wallet authenticator rotates the exact ECDSA owner and preserves confirmed state (delayed metadata ${delayedMetadata})`, async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    const target = f.owner.getSnapshot().account!.address;
    await f.change({ kind: 'create', label: 'Previous owner',});
    const previous = f.owner.getSnapshot().account!.address;
    await f.change({ kind: 'create-smart', label: 'Wallet authenticator',});
    f.guardianStatus('no-policy');
    f.observedEcdsaOwners([previous], 1);
    f.fundedSmart();
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    assert.equal(f.runtime.canUseWalletAuthenticator(), true);
    operation = await f.runtime.openWalletAuthenticator(new AbortController().signal, () => undefined, null);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize');
    const intent = operation.getSnapshot().intent;
    assert.equal(intent.kind, 'authenticator');
    if (intent.kind !== 'authenticator') throw Error('Wrong intent');
    assert.equal(intent.command.targetModule.id, 'ecdsa');
    if (intent.command.targetModule.id !== 'ecdsa') throw Error('Wrong target');
    assert.deepEqual(intent.command.targetModule.config.owners.map(owner => owner.toLowerCase()), [target.toLowerCase()]);
    assert.equal(intent.command.executions.length, 1);
    const rotation = paliSmartAccountInterface.decodeFunctionData('rotateValidator', intent.command.executions[0]!.data);
    assert.equal(rotation[0].toLowerCase(), getConfiguredAuthenticatorAddress(1, 'ecdsa').toLowerCase());
    assert.equal(rotation[1], '0x');
    assert.equal(rotation[2], encodeEcdsaValidatorInitData([target], 1));
    f.onBroadcast(() => {
      if (!delayedMetadata) f.observedEcdsaOwners([target], 1);
      if (delayedMetadata === 'unavailable') f.guardianStatus('unavailable');
    });
    const submitting = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id);
    await submitting;
    assert.equal(operation.getSnapshot().phase, 'complete');
    assert.equal(operation.getSnapshot().metadataRefresh, delayedMetadata ? 'failed' : 'complete');
    const hash = operation.getSnapshot().transactionHash;
    assert(hash);
    assert.equal(f.submitted.length, 1);
    assert.equal(f.signatures.length, 1);
    if (delayedMetadata) {
      if (delayedMetadata === 'unavailable') f.guardianStatus('no-policy');
      f.observedEcdsaOwners([target], 1);
      await operation.retryMetadata();
      assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
      assert.equal(operation.getSnapshot().transactionHash, hash);
      await operation.authorize(operation.getSnapshot().revision);
      assert.equal(f.submitted.length, 1);
      assert.equal(f.signatures.length, 1);
    }
    const stored = savedSmartAccount((await f.inspectRecovery()).record).smartAccount;
    assert.equal(stored.auth.data, encodeEcdsaValidatorInitData([target], 1));
    await f.reopen(); await f.owner.unlock();
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.auth.data, stored.auth.data);
  } finally { operation?.dispose(); await f.close(); }
});

for (const revoked of ['lifetime', 'selection', 'source-config'] as const) test(`wallet authenticator refuses ${revoked} change before dispatch`, async () => {
  const f = await fixture({}, true);
  const lifetime = new AbortController();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    const target = f.owner.getSnapshot().account!.address;
    await f.change({ kind: 'create', label: 'Previous owner',});
    const previous = f.owner.getSnapshot().account!.address;
    await f.change({ kind: 'create-smart', label: 'Wallet authenticator',});
    f.guardianStatus('no-policy'); f.observedEcdsaOwners([previous], 1); f.fundedSmart();
    operation = await f.runtime.openWalletAuthenticator(lifetime.signal, () => undefined, null);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize');
    if (revoked === 'lifetime') {
      lifetime.abort();
      await operation.authorize(operation.getSnapshot().revision);
      assert.equal(f.signatures.length, 0);
    } else {
      const submitting = operation.authorize(operation.getSnapshot().revision);
      for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
        await new Promise(resolve => setTimeout(resolve, 5));
      assert(operation.getSnapshot().payerReview);
      if (revoked === 'selection') await f.change({ kind: 'select', id: 'hd:60:0' });
      else f.observedEcdsaOwners([target], 1);
      operation.confirmPayer(operation.getSnapshot().payerReview!.id);
      await submitting;
      assert.equal(f.signatures.length, 1);
    }
    assert.equal(f.submitted.length, 0);
    assert.equal(operation.getSnapshot().phase, 'failed');
  } finally { operation?.dispose(); await f.close(); }
});

test('wallet authenticator disposal drains held owner signing before another wallet operation', async () => {
  const f = await fixture({}, true);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let operation: NativeSmartAccountOperation | undefined;
  let submitting: Promise<void> | undefined;
  try {
    await f.change({ kind: 'create', label: 'Previous owner',});
    const previous = f.owner.getSnapshot().account!.address;
    await f.change({ kind: 'create-smart', label: 'Wallet authenticator',});
    f.guardianStatus('no-policy'); f.observedEcdsaOwners([previous], 1); f.fundedSmart();
    operation = await f.runtime.openWalletAuthenticator(new AbortController().signal, () => undefined, null);
    await operation.prepare();
    f.onSignature(async () => { entered.resolve(); await release.promise; });
    submitting = operation.authorize(operation.getSnapshot().revision);
    await entered.promise;
    const disposing = Promise.resolve(operation.dispose());
    let disposed = false;
    void disposing.then(() => { disposed = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    await assert.rejects(f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined), /BUSY/);
    assert.equal(disposed, false);
    release.resolve();
    await Promise.all([submitting, disposing]);
    f.owner.lock();
    await f.owner.unlock();
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    assert.equal(f.submitted.length, 0);
  } finally { release.resolve(); await submitting; operation?.dispose(); await f.close(); }
});

test('a smart account remains selected on its chain and uses shared compatible-account fallback on another chain', async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'Chain account',});
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
    await assert.rejects(f.change({ kind: 'create-smart', label: 'Rejected account',}));
    await f.owner.unlock();
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
    const creating = f.change({ kind: 'create-smart', label: 'Cancelled account',});
    await reached;
    f.owner.lock(); finish();
    await assert.rejects(creating, { code: 'CANCELLED' });
    await f.owner.unlock();
    assert.equal(f.owner.getCatalogue()!.accounts.length, 1);
  } finally { finish(); await f.close(); }
});


test('recovery lists smart accounts on every saved chain and preserves their metadata through password reset', async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'Ethereum savings',});
    await f.selectNetwork('syscoin-nevm');
    await f.change({ kind: 'create-smart', label: 'NEVM savings',});
    const before = await f.inspectRecovery();
    const smart = before.accounts.filter(account => account.type === 'SmartAccount');
    assert.deepEqual(smart.map(account => account.smartAccount!.chainId).sort((a, b) => a - b), [1, 57]);
    const smartRecords = (before.record as any).groups[0].accounts.SmartAccount;
    await f.restoreCredential();
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


test('real smart deployment uses the owned payer, separate consent and durable SDK submission', { timeout: 45_000 }, async () => {
  const f = await fixture();
  let deployment: Awaited<ReturnType<KeyringRuntime['openSmartAccountDeployment']>> | undefined;
  try {
    const owner = f.owner.getSnapshot().account!.address;
    await f.change({ kind: 'create-smart', label: 'Deploy fixture',});
    const smart = f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!;
    deployment = await f.runtime.openSmartAccountDeployment(() => undefined, null);
    const submissionAtWire: boolean[] = [];
    f.onBroadcast(async () => {
      submissionAtWire.push(deployment!.getSnapshot().userOperationSubmissionStarted);
      if (f.submitted.length === 1) await new Promise(resolve => setTimeout(resolve, 1750));
    });
    await deployment.prepare();
    assert.equal(deployment.getSnapshot().phase, 'authorize');
    assert.equal(f.submitted.length, 0);
    const operation = deployment, started = performance.now();
    const payerReviews: { purpose: string; elapsed: number }[] = [];
    const unsubscribe = operation.subscribe(() => {
      const review = operation.getSnapshot().payerReview;
      if (review) {
        payerReviews.push({ purpose: review.purpose, elapsed: performance.now() - started });
        operation.confirmPayer(review.id);
      }
    });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; operation.cancel(); }, 30_000);
    try {
      await operation.authorize(operation.getSnapshot().revision);
      assert.equal(timedOut, false, JSON.stringify(operation.getSnapshot()));
    } finally {
      clearTimeout(timeout); unsubscribe();
    }
    assert.deepEqual(payerReviews.map(review => review.purpose), ['fund-account', 'submit-operation']);
    assert(payerReviews[1]!.elapsed > 1500, 'the second consent must arrive after the former polling window');
    assert.equal(deployment.getSnapshot().phase, 'complete', JSON.stringify(deployment.getSnapshot()));
    assert.equal(f.submitted.length, 2);
    assert.deepEqual(submissionAtWire, [false, true], 'funding must not retire the UserOperation review');
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
    await f.owner.unlock();
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
    await f.change({ kind: 'create-smart', label: 'Cancelled deployment',});
    deployment = await f.runtime.openSmartAccountDeployment(() => { assert(current, 'owner retired'); }, null);
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
      await f.change({ kind: 'create-smart', label: 'Existing deployment',});
      const before = f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!;
      f.deployed(failure === 'invalid-code' ? '0x0' : '0x6000');
      if (failure === 'owner-loss') f.onSmartCodeRead(() => { current = false; });
      const reads = f.calls.length;
      deployment = await f.runtime.openSmartAccountDeployment(() => { assert(current, 'Owner ended'); }, null);
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
        await f.reopen(); await f.owner.unlock();
        assert.deepEqual(f.owner.getCatalogue()!.accounts.find(account => account.id === before.id)!.smartAccount, after.smartAccount);
      }
    } finally { deployment?.dispose(); await f.close(); }
  });

test('restart after the deployment receipt refreshes metadata without another transaction', { timeout: 45_000 }, async () => {
  const f = await fixture();
  let deployment: Awaited<ReturnType<KeyringRuntime['openSmartAccountDeployment']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Interrupted deployment',});
    const smartId = f.owner.getCatalogue()!.active.accountId;
    deployment = await f.runtime.openSmartAccountDeployment(() => undefined, null);
    await deployment.prepare();
    f.interruptAfterReceipt();
    f.onBroadcast(async () => {
      if (f.submitted.length === 1) await new Promise(resolve => setTimeout(resolve, 1750));
    });
    const operation = deployment, started = performance.now();
    const payerReviews: { purpose: string; elapsed: number }[] = [];
    const unsubscribe = operation.subscribe(() => {
      const review = operation.getSnapshot().payerReview;
      if (review) {
        payerReviews.push({ purpose: review.purpose, elapsed: performance.now() - started });
        operation.confirmPayer(review.id);
      }
    });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; operation.cancel(); }, 30_000);
    try {
      await operation.authorize(operation.getSnapshot().revision);
      assert.equal(timedOut, false, JSON.stringify(operation.getSnapshot()));
    } finally {
      clearTimeout(timeout); unsubscribe();
    }
    assert.deepEqual(payerReviews.map(review => review.purpose), ['fund-account', 'submit-operation']);
    assert(payerReviews[1]!.elapsed > 1500, 'the second consent must arrive after the former polling window');
    assert.equal(deployment.getSnapshot().phase, 'failed');
    assert.equal(f.submitted.length, 2);
    deployment.dispose();
    await f.reopen(); await f.owner.unlock();
    assert.equal(f.owner.getCatalogue()!.accounts.find(account => account.id === smartId)!.smartAccount!.isDeployed, false);
    deployment = await f.runtime.openSmartAccountDeployment(() => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Smart sender',});
    const smart = f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!;
    f.fundedSmart(); f.holdReceipts();
    if (alreadyDeployed) f.deployed();
    const recipient = '0x2222222222222222222222222222222222222222';
    operation = await f.runtime.openSmartAccountSend(recipient, { kind: 'exact', amount: '0.000000000000000009' }, () => undefined, null);
    const initialReads = { ...f.spendabilityReads };
    await operation.prepare();
    const ready = operation.getSnapshot();
    assert.equal(ready.phase, 'authorize', JSON.stringify(ready));
    assert.equal(ready.userOperationSubmissionStarted, false);
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
    let submissionAtWire = false;
    f.onBroadcast(() => { submissionAtWire = operation!.getSnapshot().userOperationSubmissionStarted; });
    operation.confirmPayer(review.id);
    await pending;
    assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
    assert.equal(f.submitted.length, 1);
    assert.equal(submissionAtWire, true, 'the actual handleOps POST must publish its admission');
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
    // Four explicit spendability boundaries. Counterfactual sends also keep
    // the existing deployment-prefund check, even when no topup is needed.
    const expectedReads = alreadyDeployed ? 4 : 5;
    assert.equal(f.spendabilityReads.native - initialReads.native, expectedReads);
    assert.equal(f.spendabilityReads.deposit - initialReads.deposit, expectedReads);
  } finally { operation?.dispose(); await f.close(); }
});

for (const boundary of ['before-authentication', 'during-signing', 'payer-review']) test(`Smart native spendability rejects balance loss ${boundary}`, async () => {
  const f = await fixture({}, true);
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Spendability sender',});
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined, null);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize');
    if (boundary === 'before-authentication') f.smartBalance(8n);
    if (boundary === 'during-signing') f.onSignature(() => { f.smartBalance(8n); });
    const sending = operation.authorize(operation.getSnapshot().revision);
    if (boundary === 'payer-review') {
      for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
        await new Promise(resolve => setTimeout(resolve, 5));
      const review = operation.getSnapshot().payerReview;
      assert(review, JSON.stringify(operation.getSnapshot()));
      f.smartBalance(8n);
      operation.confirmPayer(review.id);
    }
    await sending;
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(f.signatures.length, boundary === 'before-authentication' ? 0 : 1);
    assert.equal(f.submitted.length, 0);
  } finally { operation?.dispose(); await f.close(); }
});

test('smart native sends reject invalid input and blocked recipients before authorizing', async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Smart sender',});
    for (const [recipient, amount] of [['bad', '1'], ['0x2222222222222222222222222222222222222222', '1e2'], ['0x2222222222222222222222222222222222222222', '0']])
      await assert.rejects(f.runtime.openSmartAccountSend(recipient!, { kind: 'exact', amount: amount! }, () => undefined, null), { code: 'INVALID_INPUT' });
    f.blockRecipient();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '1' }, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Smart sender',});
    f.fundedSmart();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.01' }, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Reorg fixture',});
    f.deployed();
    deployment = await f.runtime.openSmartAccountDeployment(() => undefined, null);
    await deployment.prepare();
    assert.equal(deployment.getSnapshot().phase, 'complete');
    assert.equal(f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!.smartAccount!.isDeployed, true);
    deployment.dispose(); deployment = undefined;
    f.undeployed(); f.fundedSmart();
    send = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.1' }, () => undefined, null);
    await send.prepare();
    assert.equal(send.getSnapshot().phase, 'authorize', JSON.stringify(send.getSnapshot()));
    assert.notEqual(send.getSnapshot().authorization!.initCode, '0x');
    assert.equal(f.submitted.length, 0);
  } finally { send?.dispose(); deployment?.dispose(); await f.close(); }
});

for (const change of ['deployed', 'malformed', 'account', 'network'] as const) test(`a deployment observed between preparation reads is handled without a self-call (${change})`, async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  let reads = 0;
  try {
    await f.change({ kind: 'create-smart', label: 'Deployment race',});
    f.fundedSmart();
    f.onSmartCodeRead(async () => {
      reads++;
      if (reads === 1) f.deployed(change === 'malformed' ? '0x0' : '0x6000');
      if (reads === 2 && change === 'account') await f.change({ kind: 'select', id: 'hd:60:0' });
      if (reads === 2 && change === 'network') await f.selectNetwork('zksys-testnet');
    });
    operation = await f.runtime.openSmartAccountDeployment(() => undefined, null);
    await operation.prepare();
    assert.equal(reads, 2);
    assert.equal(operation.getSnapshot().phase, change === 'deployed' ? 'complete' : 'failed');
    assert.equal(operation.getSnapshot().authorization, null);
    assert.equal(operation.getSnapshot().maximumPrefundUnits, null);
    assert.equal(f.signatures.length, 0);
    assert.equal(f.submitted.length, 0);
    if (change === 'deployed') {
      const smart = f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!;
      assert.equal(smart.smartAccount!.isDeployed, true);
      await f.reopen(); await f.owner.unlock();
      assert.equal(f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!.smartAccount!.isDeployed, true);
    }
  } finally { operation?.dispose(); await f.close(); }
});

for (const point of ['before-commit', 'lost-ack'] as const) test(`deployment race requires acknowledged owned persistence (${point})`, async () => {
  let armed = false;
  const fail: SqlHook = (kind, sql) => {
    if (armed && kind === 'exec' && sql === 'COMMIT') { armed = false; throw Error('interrupted deployment metadata'); }
  };
  const f = await fixture(point === 'before-commit' ? { before: fail } : { after: fail }, true);
  let operation: NativeSmartAccountOperation | undefined;
  let reads = 0;
  try {
    await f.change({ kind: 'create-smart', label: 'Deployment persistence',});
    f.fundedSmart();
    f.onSmartCodeRead(() => {
      if (++reads === 1) { f.deployed(); armed = true; }
    });
    operation = await f.runtime.openSmartAccountDeployment(() => undefined, null);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(operation.getSnapshot().authorization, null);
    assert.equal(f.signatures.length, 0);
    assert.equal(f.submitted.length, 0);
    assert.equal(f.owner.getCatalogue(), null);
    operation.dispose(); operation = undefined;
    await f.reopenQuarantined(); await f.owner.unlock();
    assert.equal(f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!.smartAccount!.isDeployed, point === 'lost-ack');
  } finally { armed = false; operation?.dispose(); await f.close(); }
});


for (const loseCredit of [false, true]) test(`gas-tank deployment with zero payer balance preserves fee coverage (${loseCredit ? 'credit-lost' : 'funded'})`, async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountDeployment']>> | undefined;
  try {
    await f.selectNetwork('zksys-testnet');
    await f.change({ kind: 'create-smart', label: 'Sponsored smart account',});
    f.gasSponsored();
    operation = await f.runtime.openSmartAccountDeployment(() => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Activity sender',});
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined, null);
    await operation.prepare();
    const sending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview; i++) await new Promise(resolve => setTimeout(resolve, 5));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id);
    await sending;
    assert.equal(operation.getSnapshot().phase, 'complete');
    operation.dispose();
    await f.reopen(); await f.owner.unlock();
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
    await f.reopen(); await f.owner.unlock();
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
    await f.change({ kind: 'create-smart', label: 'MAX sender',});
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    if (sponsored) f.gasSponsored();
    const recipient = '0x2222222222222222222222222222222222222222';
    operation = await f.runtime.openSmartAccountSend(recipient, { kind: 'maximum' }, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Token sender',});
    const metadata = { contractAddress: '0x5555555555555555555555555555555555555555', decimals: 255, name: 'Exact token', symbol: 'EXACT' };
    const registry = await f.runtime.tokens!.load(() => undefined);
    await f.runtime.tokens!.add(registry.revision, metadata, () => undefined);
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    const recipient = '0x2222222222222222222222222222222222222222';
    operation = await f.runtime.openSmartAccountSend(recipient, { kind: 'erc20', contractAddress: metadata.contractAddress,
      amount: '0.' + '0'.repeat(254) + '9' }, () => undefined, null);
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
    operation.dispose(); await f.reopen(); await f.owner.unlock();
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
    await f.change({ kind: 'create-smart', label: 'Token sender',});
    await assert.rejects(f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', {
      kind: 'erc20', contractAddress: '0x5555555555555555555555555555555555555555', amount: '1',
    }, () => undefined, null), { code: 'NOT_READY' });
    assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});


for (const standard of ['ERC-721', 'ERC-1155'] as const) test(`Smart ${standard} uses the shared safe transfer and retains inner failure after restart`, async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Collectible sender',});
    const smart = f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!;
    const contractAddress = '0x5555555555555555555555555555555555555555', tokenId = ((1n << 256n) - 1n).toString();
    const collectible = standard === 'ERC-721' ? { contractAddress, tokenStandard: standard } : { contractAddress, tokenStandard: standard, tokenId };
    const registry = await f.runtime.tokens!.load(() => undefined);
    await f.runtime.tokens!.addCollectible!(registry.revision, collectible, () => undefined);
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    const recipient = '0x2222222222222222222222222222222222222222';
    const amountUnits = standard === 'ERC-721' ? '1' : '900719925474099312345';
    operation = await f.runtime.openSmartAccountSend(recipient, { kind: 'nft', collectible, tokenId, amountUnits }, () => undefined, null);
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
    operation.dispose(); await f.reopen(); await f.owner.unlock();
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
    await f.change({ kind: 'create-smart', label: 'Collectible sender',});
    const collectible = { contractAddress: '0x5555555555555555555555555555555555555555', tokenStandard: 'ERC-1155' as const, tokenId: '7' };
    const registry = await f.runtime.tokens!.load(() => undefined);
    await f.runtime.tokens!.addCollectible!(registry.revision, collectible, () => undefined);
    const to = '0x2222222222222222222222222222222222222222';
    await assert.rejects(f.runtime.openSmartAccountSend(to, { kind: 'nft', collectible, tokenId: '8', amountUnits: '1' }, () => undefined, null));
    await assert.rejects(f.runtime.openSmartAccountSend(to, { kind: 'nft', collectible: { ...collectible, contractAddress: to }, tokenId: '7', amountUnits: '1' }, () => undefined, null), { code: 'NOT_READY' });
    await assert.rejects(f.runtime.openSmartAccountSend(to, { kind: 'nft', collectible: { contractAddress: collectible.contractAddress, tokenStandard: 'ERC-721' }, tokenId: '7', amountUnits: '1' }, () => undefined, null), { code: 'NOT_READY' });
    await f.selectNetwork('base');
    await assert.rejects(f.runtime.openSmartAccountSend(to, { kind: 'nft', collectible, tokenId: '7', amountUnits: '1' }, () => undefined, null));
    assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});

for (const [data, self] of [['0x', false], ['0x12345678', false], ['0x', true]] as const) test(`real Smart dapp zero-value call ${data} preserves exact execution and Activity after restart (self ${self})`, async () => {
  const f = await fixture();
  let operation: Awaited<ReturnType<KeyringRuntime['openSmartAccountSend']>> | undefined;
  let approval: ReturnType<typeof createDappSigningApproval> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Dapp account',});
    f.fundedSmart(); f.deployed();
    const host = await f.runtime.openConnectionHost();
    const selected = host.context().accounts.find(account => account.type === 'SmartAccount')!;
    const grant = { accountId: selected.index, accountType: selected.type as import('../../../source/types/network.ts').KeyringAccountType, chain: 'ethereum' as import('../../../source/types/network.ts').INetworkType,
      chainId: 1, host: 'https://fixture.example', date: 1 };
    approval = createDappSigningApproval({ readScope: () => ({
      account: { id: selected.index, type: selected.type, address: selected.address, xpub: selected.xpub },
      grant, network: host.context().network, isBitcoinBased: false, sessionGeneration: host.sessionGeneration(),
    }), subscribe: (changed) => f.owner.subscribe(() => { changed(); }) });
    const recipient = self ? selected.address : '0x2222222222222222222222222222222222222222';
    const request = { from: selected.address, to: recipient, value: '0x0', data, maxFeePerGas: '0x3', maxPriorityFeePerGas: '0x1' };
    const prepared = await host.prepareTransaction({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', transaction: request, approval }, () => undefined, null);
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
    assert.equal('0x' + execution.slice(2, 42), recipient.toLowerCase());
    assert.equal(BigInt('0x' + execution.slice(42, 106)), 0n);
    assert.equal('0x' + execution.slice(106), data);
    operation.dispose(); approval.dispose(); await f.reopen(); await f.owner.unlock();
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
    await f.change({ kind: 'create-smart', label: 'Queued Smart',});
    f.fundedSmart(); f.holdReceipts();
    if (existing) f.deployed();
    const nonces: bigint[] = [];
    for (let index = 0; index < 2; index++) {
      operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Fresh nonce',});
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Chain bound',});
    f.fundedSmart(); f.deployed(); f.holdReceipts();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Batch account',});
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
    const prepared = await host.prepareCalls({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', calls: { version: '2.0.0', from: selected.address, chainId: '0x1', atomicRequired: true, calls }, origin, bundleId, reservationId, approval }, () => undefined, null);
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
    operation.dispose(); approval.dispose(); await f.reopen(); await f.owner.unlock(); f.showReceipts(outcome !== 'revert');
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
      f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined));
    await f.change({ kind: 'create-smart', label: 'Guardian account',});
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
    await f.owner.unlock();
    assert.deepEqual(savedSmartAccount((await f.inspectRecovery()).record), accountAfter);
    f.guardianStatus('no-policy');
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.installedModules.some((module: any) => module.id === 'guardian-recovery'), false);
  } finally { await f.close(); }
});

for (const mode of ['unsupported', 'unavailable'] as const) test(`a ${mode} guardian read preserves metadata and the unlocked wallet`, async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'Read failure',});
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
    await f.change({ kind: 'create-smart', label: 'Revoked read',});
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
    if (change === 'lock') await f.owner.unlock();
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
    await f.change({ kind: 'create-smart', label: 'Interrupted metadata',});
    const before = savedSmartAccount((await f.inspectRecovery()).record);
    f.guardianStatus(); armed = true;
    await assert.rejects(f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined));
    assert.equal(f.owner.getCatalogue(), null);
    await f.reopenQuarantined(); await f.owner.unlock();
    const after = savedSmartAccount((await f.inspectRecovery()).record);
    assert.deepEqual({ ...after, smartAccount: undefined }, { ...before, smartAccount: undefined });
    assert.equal(after.smartAccount.installedModules?.some((module: any) => module.id === 'guardian-recovery') ?? false, point === 'lost-ack');
  } finally { await f.close(); }
});

test('metadata CAS refuses immutable edits and non-Smart or stale selections', async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'Immutable identity',});
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
    await f.change({ kind: 'create-smart', label: 'Cancelled metadata commit',});
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
    await f.reopenQuarantined(); await f.owner.unlock();
    assert.deepEqual(savedSmartAccount((await f.inspectRecovery()).record), before);
  } finally { release(); await f.close(); }
});

test('observing an external ECDSA owner cannot grant native signing authority', async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Externally controlled account',});
    f.guardianStatus(); f.externalOwner();
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    const metadata = savedSmartAccount((await f.inspectRecovery()).record).smartAccount;
    assert.deepEqual(metadata.installedModules.find((module: any) => module.id === 'ecdsa').config.owners, ['0x' + '66'.repeat(20)]);
    f.deployed();
    f.fundedSmart();
    operation = await f.runtime.openSmartAccountSend('0x' + '44'.repeat(20), { kind: 'exact', amount: '0.001' }, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Guardian policy',});
    f.fundedSmart(); f.guardianStatus(existing ? 'installed' : 'no-policy');
    const guardian = '0x' + '77'.repeat(20), delaySeconds = 259200;
    f.onBroadcast(() => {
      if (Transaction.from(f.submitted.at(-1)!).to !== getPaliEntryPointAddress(1)) return;
      f.guardianStatus('installed').configure(guardian, delaySeconds);
    });
    assert.equal(f.runtime.canManageGuardianPolicy(), true);
    operation = await f.runtime.openGuardianPolicy({ action: 'set', guardian, delaySeconds, acknowledgedPendingOperationId: null }, new AbortController().signal, () => undefined, null);
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
    await f.reopen(); await f.owner.unlock();
    assert.deepEqual(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.installedModules.find((module: any) => module.id === 'guardian-recovery'), policy);
  } finally { operation?.dispose(); await f.close(); }
});

async function guardianPolicySigningFixture(kind: 'p256' | 'composite', available = true) {
  let f!: Awaited<ReturnType<typeof fixture>>, prompt = false;
  let hold: (() => Promise<void>) | undefined;
  const hashes: string[] = [];
  const scope = createNativePrivateAuthenticationScope(), lifetime = new AbortController();
  const binding = bindNativePrivateAuthentication(scope, { assertCurrent() {}, isPromptActive: () => prompt });
  const passkeys: NonNullable<KeyringRuntimeDependencies['passkeys']> = {
    async create() { throw Error('Guardian policy must use the existing credential'); },
    async recover() { throw Error('Guardian policy must not discover another credential'); },
    async sign(request) {
      prompt = true;
      try {
        request.assertCurrent(); f.assertNoSigningKeys(); hashes.push(request.actionHash);
        await hold?.(); request.assertCurrent();
        return { signature: mixedPasskeyProof };
      } finally { prompt = false; }
    },
  };
  f = await fixture({}, true, null, undefined, undefined, available ? passkeys : null);
  try {
    await f.change({ kind: 'create-smart', label: 'Guardian signing policy' });
    f.fundedSmart(); f.guardianStatus('no-policy');
    if (kind === 'p256') f.observedPasskey(); else f.observedComposite(2);
    await f.runtime.refreshSmartAccountMetadata(lifetime.signal, () => undefined);
    return { f, hashes, binding, lifetime, hold(next: () => Promise<void>) { hold = next; },
      async close() { lifetime.abort(); scope.retire(); await f.close(); } };
  } catch (error) { lifetime.abort(); scope.retire(); await f.close(); throw error; }
}

for (const kind of ['p256', 'composite'] as const)
  for (const action of ['install', 'update', 'remove'] as const)
    test(`guardian policy ${action} uses the active ${kind} signer and separate payer consent`, async () => {
      const { f, hashes, binding, lifetime, close } = await guardianPolicySigningFixture(kind);
      let operation: NativeSmartAccountOperation | undefined;
      try {
        const guardian = '0x' + '77'.repeat(20), delaySeconds = 259200;
        f.guardianStatus(action === 'install' ? 'no-policy' : 'installed');
        f.onBroadcast(() => {
          if (Transaction.from(f.submitted.at(-1)!).to !== getPaliEntryPointAddress(1)) return;
          if (action === 'remove') f.guardianStatus('no-policy');
          else f.guardianStatus('installed').configure(guardian, delaySeconds);
        });
        assert.equal(f.runtime.canManageGuardianPolicy(), true);
        operation = await f.runtime.openGuardianPolicy(action === 'remove'
          ? { action: 'remove', recoveryLossAcknowledged: true, acknowledgedPendingOperationId: null }
          : { action: 'set', guardian, delaySeconds, acknowledgedPendingOperationId: null }, lifetime.signal, () => undefined, binding);
        await operation.prepare();
        assert.equal(operation.getSnapshot().phase, 'authorize', operation.getSnapshot().error ?? '');
        assert.equal(hashes.length, 0); assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
        const signing = operation.authorize(operation.getSnapshot().revision);
        for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
          await new Promise(resolve => setTimeout(resolve, 5));
        const payer = operation.getSnapshot().payerReview; assert(payer, JSON.stringify(operation.getSnapshot()));
        assert.equal(hashes.length, 1); assert.equal(f.signatures.length, kind === 'composite' ? 1 : 0);
        assert.equal(f.payerSignatures.length, 0); assert.equal(f.submitted.length, 0);
        operation.confirmPayer(payer.id); await signing;
        assert.equal(operation.getSnapshot().phase, 'complete', operation.getSnapshot().error ?? '');
        assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
        assert.equal(f.submitted.length, 1); assert.equal(f.payerSignatures.length, 1);
        const transaction = Transaction.from(f.submitted[0]!);
        const [operations] = paliEntryPointInterface.decodeFunctionData('handleOps', transaction.data);
        const expectedSignature = kind === 'p256' ? mixedPasskeyProof : coder.encode(['bytes[]'], [[mixedPasskeyProof, f.signatures[0]!.signature]]);
        assert.equal(operations[0].signature, expectedSignature);
        const op = operations[0];
        const digest = getSmartAccountUserOpHash({ sender: op.sender, nonce: op.nonce.toString(), initCode: op.initCode, callData: op.callData,
          accountGasLimits: op.accountGasLimits, preVerificationGas: op.preVerificationGas.toString(), gasFees: op.gasFees, paymasterAndData: op.paymasterAndData, signature: op.signature }, 1);
        assert.deepEqual(hashes, [digest]);
        if (kind === 'composite') assert.equal(f.signatures[0]!.digest, digest);
        const saved = savedSmartAccount((await f.inspectRecovery()).record).smartAccount;
        assert.equal(saved.auth.module, kind === 'p256' ? 'p256-webauthn' : 'composite');
        const policy = saved.installedModules.find((module: SmartAccountInstalledModule) => module.id === 'guardian-recovery');
        if (action === 'remove') assert.equal(policy, undefined);
        else { assert.deepEqual(policy.config.guardians, [guardian]); assert.equal(policy.config.delaySeconds, delaySeconds); }
      } finally { await operation?.dispose(); await close(); }
    });

for (const kind of ['p256', 'composite'] as const)
  test(`guardian policy rejects unavailable ${kind} signing before any prompt`, async () => {
    const { f, hashes, binding, lifetime, close } = await guardianPolicySigningFixture(kind, kind === 'composite');
    try {
      if (kind === 'composite') {
        f.externalOwner(); await f.runtime.refreshSmartAccountMetadata(lifetime.signal, () => undefined);
      }
      assert.equal(f.runtime.canManageGuardianPolicy(), false);
      await assert.rejects(f.runtime.openGuardianPolicy({ action: 'set', guardian: '0x' + '77'.repeat(20), delaySeconds: 259200,
        acknowledgedPendingOperationId: null }, lifetime.signal, () => undefined, binding));
      assert.equal(hashes.length, 0); assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
    } finally { await close(); }
  });

test('guardian policy cancellation during the P256 prompt cannot request payer consent or submit', async () => {
  const { f, hashes, binding, lifetime, hold, close } = await guardianPolicySigningFixture('p256');
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    hold(async () => { entered.resolve(); await release.promise; });
    operation = await f.runtime.openGuardianPolicy({ action: 'set', guardian: '0x' + '77'.repeat(20), delaySeconds: 259200,
      acknowledgedPendingOperationId: null }, lifetime.signal, () => undefined, binding);
    await operation.prepare(); const signing = operation.authorize(operation.getSnapshot().revision);
    await entered.promise; operation.cancel(); release.resolve(); await signing;
    assert.equal(hashes.length, 1); assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(operation.getSnapshot().payerReview, null);
    assert.equal(f.signatures.length, 0); assert.equal(f.payerSignatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally { release.resolve(); await operation?.dispose(); await close(); }
});

for (const mode of ['unavailable', 'stale'] as const) test(`guardian policy preserves the confirmed transaction when metadata is ${mode} and only re-reads on retry`, async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Guardian metadata retry',});
    f.fundedSmart(); f.guardianStatus('no-policy');
    const guardian = '0x' + '77'.repeat(20), delaySeconds = 259200;
    f.onBroadcast(() => { if (Transaction.from(f.submitted.at(-1)!).to === getPaliEntryPointAddress(1)) f.guardianStatus(mode === 'unavailable' ? 'unavailable' : 'installed'); });
    operation = await f.runtime.openGuardianPolicy({ action: 'set', guardian, delaySeconds, acknowledgedPendingOperationId: null }, new AbortController().signal, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Guardian pending change',});
    f.fundedSmart(); f.guardianStatus();
    const draft = { action: 'set' as const, guardian: '0x' + '77'.repeat(20), delaySeconds: 259200, acknowledgedPendingOperationId: null };
    await assert.rejects(f.runtime.openGuardianPolicy(draft, new AbortController().signal, () => undefined, null), /GUARDIAN_POLICY_CONFIRMATION_REQUIRED/);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
    f.guardianStatus('installed');
    operation = await f.runtime.openGuardianPolicy(draft, new AbortController().signal, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Bound guardian policy',});
    f.fundedSmart();
    const fixture = f.guardianStatus();
    const observation = await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    assert(observation?.pending);
    operation = await f.runtime.openGuardianPolicy({ action: 'set', guardian: '0x' + '77'.repeat(20), delaySeconds: 259200,
      acknowledgedPendingOperationId: observation.pending.operationId }, new AbortController().signal, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Reverted guardian policy',});
    f.fundedSmart(); f.guardianStatus('no-policy'); f.showReceipts(false);
    operation = await f.runtime.openGuardianPolicy({ action: 'set', guardian: '0x' + '77'.repeat(20), delaySeconds: 259200,
      acknowledgedPendingOperationId: null }, new AbortController().signal, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Immutable guardian draft',});
    f.guardianStatus();
    const observation = await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    assert(observation?.pending);
    held = f.guardianStatus('hold');
    const draft = { action: 'set' as const, guardian: '0x' + '77'.repeat(20), delaySeconds: 259200,
      acknowledgedPendingOperationId: acknowledged ? observation.pending.operationId : null };
    const pending = f.runtime.openGuardianPolicy(draft, new AbortController().signal, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Remove consent',});
    f.fundedSmart(); f.guardianStatus();
    await assert.rejects(f.runtime.openGuardianPolicy({ ...removalDraft, recoveryLossAcknowledged: false } as never,
      new AbortController().signal, () => undefined, null), /INVALID_INPUT/);
    await assert.rejects(f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined, null), /GUARDIAN_POLICY_CONFIRMATION_REQUIRED/);
    assert.equal(f.submitted.length, 0);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { await f.close(); }
});

for (const lag of [false, true]) test(`guardian removal commits canonical absence and preserves its receipt through metadata lag (${lag})`, async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Remove guardian',});
    f.fundedSmart(); f.guardianStatus('installed');
    if (!lag) f.onBroadcast(() => { f.guardianStatus('no-policy'); });
    operation = await f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined, null);
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
    await f.reopen(); await f.owner.unlock();
    assert.equal((await f.runtime.inspectGuardianRemoval(new AbortController().signal, () => undefined)).status, 'removed');
    assert.equal(f.submitted.length, 1);
  } finally { operation?.dispose(); await f.close(); }
});

test('unresolved guardian removal is recovered from the signed journal after restart and cannot be submitted twice', async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Pending guardian removal',});
    f.fundedSmart(); f.guardianStatus('installed'); f.holdReceipts();
    operation = await f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined, null);
    await operation.prepare();
    const pending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview);
    operation.confirmPayer(operation.getSnapshot().payerReview!.id);
    for (let i = 0; i < 300 && !f.submitted.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(f.submitted.length, 1);
    operation.dispose(); await pending; operation = undefined;
    await f.reopen(); await f.owner.unlock();
    const status = await f.runtime.inspectGuardianRemoval(new AbortController().signal, () => undefined);
    assert.equal(status.status, 'pending'); assert.equal(status.transactions.length, 1);
    await assert.rejects(f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined, null), /GUARDIAN_REMOVAL_PENDING/);
    f.showReceipts(false);
    assert.equal((await f.runtime.inspectGuardianRemoval(new AbortController().signal, () => undefined)).status, 'retry-ready');
    operation = await f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined, null);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize');
    assert.equal(f.submitted.length, 1);
  } finally { operation?.dispose(); await f.close(); }
});


test('guardian removal inner failure never reports removal from a successful outer receipt', async () => {
  const f = await fixture();
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Failed removal',});
    f.fundedSmart(); f.guardianStatus('installed'); f.showReceipts(false);
    operation = await f.runtime.openGuardianPolicy(removalDraft, new AbortController().signal, () => undefined, null);
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
    await f.change({ kind: 'create-smart', label: 'Bound removal read',});
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
    await f.change({ kind: 'create-smart', label: 'Policy race',});
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
      f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined));
    await f.change({ kind: 'create-smart', label: 'Recoverable account',});
    const accounts = f.owner.getCatalogue()!.accounts;
    const guardian = accounts.find(account => account.id === 'hd:60:0')!;
    const replacement = accounts.find(account => account.type === 'Imported')!;
    const status = f.guardianStatus('installed'); status.configure(guardian.address, 600);
    f.externalOwner();
    recovery = await f.runtime.openGuardianRecovery({ kind: 'start', guardianId: guardian.id, replacement: { kind: 'software' as const, accountId: replacement.id }, payerId: guardian.id }, new AbortController().signal, () => undefined, null);
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
    await f.reopen(); await f.owner.unlock();
    recovery = await f.runtime.openGuardianRecovery({ kind: 'resume' }, new AbortController().signal, () => undefined, null);
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
    f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined));
  await f.change({ kind: 'create-smart', label: 'Recovery target',});
  const guardian = f.owner.getCatalogue()!.accounts.find(account => account.id === 'hd:60:0')!;
  const replacement = f.owner.getCatalogue()!.accounts.find(account => account.type === 'Imported')!;
  const policy = f.guardianStatus('installed'); policy.configure(guardian.address, 600);
  const controller = await f.runtime.openGuardianRecovery({ kind: 'start', guardianId: guardian.id, replacement: { kind: 'software' as const, accountId: replacement.id }, payerId: guardian.id }, new AbortController().signal, () => undefined, null);
  return { f, guardian, replacement, policy, controller };
}

async function smartGuardianRecoveryFixture(composite = false, hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const f = await fixture(hooks, true);
  try {
    const privateKey = '0x' + '04'.repeat(32);
    await f.owner.importAccount({ privateKey, label: 'Smart guardian replacement', expectedAddress: importedKeyIdentity(privateKey, 0).address },
      f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined));
    await f.change({ kind: 'create-smart', label: 'Smart guardian',});
    const guardian = f.owner.getCatalogue()!.accounts.find(account => account.id === 'smart:60:0')!;
    await f.change({ kind: 'create', label: 'Separate recovery payer',});
    const payer = f.owner.getCatalogue()!.accounts.find(account => account.id === 'hd:60:1')!;
    await f.change({ kind: 'create-smart', label: 'Smart recovery target',});
    const accounts = f.owner.getCatalogue()!.accounts;
    const owner = accounts.find(account => account.id === 'hd:60:0')!;
    const replacement = accounts.find(account => account.type === 'Imported')!;
    const policy = f.guardianStatus('installed'); policy.configure(guardian.address, 600);
    f.smartGuardian(guardian.address, [owner.address], { compositeThreshold: composite ? 1 : undefined });
    f.externalOwner();
    const draft = { kind: 'start' as const, guardianId: guardian.id, replacement: { kind: 'software' as const, accountId: replacement.id }, payerId: payer.id };
    return { f, guardian, owner, replacement, payer, policy, draft,
      open: (signal = new AbortController().signal) => f.runtime.openGuardianRecovery(draft, signal, () => undefined, null) };
  } catch (error) { await f.close(); throw error; }
}

for (const composite of [false, true]) test(`native Smart guardian uses shared ERC1271 proof and a durable separate payer (${composite})`, async () => {
  const { f, guardian, owner, replacement, payer, policy, open } = await smartGuardianRecoveryFixture(composite);
  let controller: Awaited<ReturnType<typeof open>> | undefined;
  try {
    controller = await open();
    const intent = f.runtime.getGuardianRecoveryIntent()!;
    assert.equal(intent.guardian.id, guardian.id); assert.equal(intent.payer.id, payer.id);
    await controller.prepare(); await controller.review();
    const review = controller.getSnapshot();
    assert.equal(review.phase, 'review', JSON.stringify(review));
    assert.equal(review.feeReview!.transaction.from.toLowerCase(), payer.address.toLowerCase());
    assert(f.estimatedSenders.length > 0 && f.estimatedSenders.every(address => address.toLowerCase() === payer.address.toLowerCase()));
    assert.equal(f.signatures.length, 2);
    assert(f.signatures.every(proof => proof.intentPersisted));
    assert.equal(recoverAddress(intent.operation.hash, f.signatures[0]!.signature).toLowerCase(), replacement.address.toLowerCase());
    const actionHash = getPaliErc7739PersonalSignHash({ accountAddress: guardian.address, chainId: intent.operation.chainId, hash: intent.operation.hash });
    assert.equal(f.signatures[1]!.digest, actionHash);
    assert.equal(recoverAddress(actionHash, f.signatures[1]!.signature).toLowerCase(), owner.address.toLowerCase());
    f.holdReceipts();
    await controller.confirm(review.feeReview!.id);
    assert.equal(controller.getSnapshot().phase, 'waiting', JSON.stringify(controller.getSnapshot()));
    assert.equal(f.submitted.length, 1);
    const transaction = Transaction.from(f.submitted[0]);
    assert.equal(transaction.from!.toLowerCase(), payer.address.toLowerCase());
    const schedule = paliGuardianRecoveryModuleInterface.decodeFunctionData('scheduleRecovery', transaction.data);
    assert.equal(schedule[4][0].guardian.toLowerCase(), guardian.address.toLowerCase());
    assert.equal(schedule[4][0].signature, encodeSmartAccountAuthenticatorSignature({
      validator: getConfiguredAuthenticatorAddress(1, composite ? 'composite' : 'ecdsa'),
      signature: composite ? coder.encode(['bytes[]'], [[f.signatures[1]!.signature, '0x']]) : f.signatures[1]!.signature,
    }));
    controller.dispose(); controller = undefined;
    await f.reopen(); await f.owner.unlock();
    controller = await f.runtime.openGuardianRecovery({ kind: 'resume' }, new AbortController().signal, () => undefined, null);
    await controller.prepare(); await controller.review();
    assert.equal(controller.getSnapshot().phase, 'waiting', JSON.stringify(controller.getSnapshot()));
    assert.equal(controller.getSnapshot().transactionHash, transaction.hash);
    assert.equal(f.signatures.length, 2); assert.equal(f.submitted.length, 1);
    policy.recover(intent.operation, 'ready'); f.showReceipts();
    await controller.refresh(); await controller.review();
    assert.equal(controller.getSnapshot().feeReview!.transaction.from.toLowerCase(), payer.address.toLowerCase());
    f.onBroadcast(() => { policy.recover(intent.operation, 'executed'); f.recoveredOwner(replacement.address); });
    await controller.confirm(controller.getSnapshot().feeReview!.id);
    assert.equal(controller.getSnapshot().phase, 'complete', JSON.stringify(controller.getSnapshot()));
    assert.equal(f.runtime.getGuardianRecoveryIntent(), null);
    assert.equal(f.signatures.length, 2); assert.equal(f.submitted.length, 2);
    assert(f.submitted.every(raw => Transaction.from(raw).from!.toLowerCase() === payer.address.toLowerCase()));
  } finally { controller?.dispose(); await f.close(); }
});

for (const changed of ['metadata', 'undeployed', 'owner', 'payer', 'network', 'lock', 'cancel', 'recovery-policy'] as const)
  test(`native Smart guardian rejects stale ${changed} before additional owner or payer authority`, async () => {
    const { f, guardian, owner, policy, open } = await smartGuardianRecoveryFixture();
    const lifetime = new AbortController();
    let controller: Awaited<ReturnType<typeof open>> | undefined;
    try {
      controller = await open(lifetime.signal); await controller.prepare();
      if (changed === 'metadata') f.smartGuardian(guardian.address, ['0x' + '77'.repeat(20)]);
      else if (changed === 'undeployed') f.smartGuardian(guardian.address, [owner.address], { deployed: false });
      else if (changed === 'network') f.wrongChain();
      else if (changed === 'recovery-policy') policy.configure(guardian.address, 1200);
      else f.onSignature(() => {
        if (changed === 'owner') f.replaceSoftwareOwner('HDAccount', 0);
        if (changed === 'payer') f.replaceSoftwareOwner('HDAccount', 1);
        if (changed === 'lock') f.owner.lock();
        if (changed === 'cancel') lifetime.abort();
      });
      await controller.review();
      assert.notEqual(controller.getSnapshot().phase, 'review');
      assert.equal(f.signatures.filter(proof => proof.address.toLowerCase() === owner.address.toLowerCase()).length, 0);
      assert.equal(f.signatures.length, changed === 'owner' ? 1 : 0);
      assert.equal(f.submitted.length, 0);
    } finally { controller?.dispose(); await f.close(); }
  });

test('native Smart guardian refuses unsatisfied composite and undeployed policies before persisting an intent', async () => {
  const { f, guardian, owner, draft, open } = await smartGuardianRecoveryFixture();
  try {
    const missingPayer = { ...draft }; Reflect.deleteProperty(missingPayer, 'payerId');
    await assert.rejects(f.runtime.openGuardianRecovery(missingPayer, new AbortController().signal, () => undefined, null), /INVALID_INPUT/);
    await assert.rejects(f.runtime.openGuardianRecovery({ ...draft, payerId: guardian.id }, new AbortController().signal, () => undefined, null), /INVALID_INPUT/);
    await assert.rejects(f.runtime.openGuardianRecovery({ ...draft, replacement: { kind: 'software' as const, accountId: guardian.id  }}, new AbortController().signal, () => undefined, null), /INVALID_INPUT/);
    f.smartGuardian(guardian.address, [owner.address], { compositeThreshold: 2 });
    await assert.rejects(open(), /unavailable authenticator/);
    assert.equal(f.runtime.getGuardianRecoveryIntent(), null);
    f.smartGuardian(guardian.address, [owner.address], { deployed: false });
    await assert.rejects(open(), /unavailable authenticator/);
    assert.equal(f.runtime.getGuardianRecoveryIntent(), null);
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});

test('native recovery uses an explicitly selected imported payer for an EOA guardian', async () => {
  const { f, controller: initial, guardian, replacement } = await startNativeRecovery();
  let controller: typeof initial | undefined;
  try {
    await initial.prepare(); await initial.abandon(); initial.dispose();
    controller = await f.runtime.openGuardianRecovery({ kind: 'start', guardianId: guardian.id, replacement: { kind: 'software' as const, accountId: replacement.id }, payerId: replacement.id }, new AbortController().signal, () => undefined, null);
    await controller.prepare(); await controller.review();
    const review = controller.getSnapshot().feeReview!; assert(review);
    assert.equal(review.transaction.from.toLowerCase(), replacement.address.toLowerCase());
    f.holdReceipts(); await controller.confirm(review.id);
    assert.equal(f.submitted.length, 1);
    const transaction = Transaction.from(f.submitted[0]);
    assert.equal(transaction.from!.toLowerCase(), replacement.address.toLowerCase());
    const schedule = paliGuardianRecoveryModuleInterface.decodeFunctionData('scheduleRecovery', transaction.data);
    const intent = f.runtime.getGuardianRecoveryIntent()!;
    assert.equal(intent.payer.id, replacement.id);
    assert.equal(recoverAddress(intent.operation.hash, schedule[4][0].signature).toLowerCase(), guardian.address.toLowerCase());
  } finally { initial.dispose(); controller?.dispose(); await f.close(); }
});

for (const changed of ['metadata', 'owner', 'payer'] as const)
  test(`native Smart guardian rejects ${changed} changed after fee review before payer signing`, async () => {
    const { f, guardian, open } = await smartGuardianRecoveryFixture();
    const controller = await open();
    try {
      await controller.prepare(); await controller.review();
      const review = controller.getSnapshot().feeReview!; assert(review);
      assert.equal(f.signatures.length, 2); assert.equal(f.payerSignatures.length, 0);
      if (changed === 'metadata') f.smartGuardian(guardian.address, ['0x' + '77'.repeat(20)]);
      else f.replaceSoftwareOwner('HDAccount', changed === 'owner' ? 0 : 1);
      await controller.confirm(review.id);
      assert.equal(f.payerSignatures.length, 0); assert.equal(f.submitted.length, 0);
      assert(f.runtime.getGuardianRecoveryIntent());
    } finally { controller.dispose(); await f.close(); }
  });

for (const changed of ['Smart policy', 'recovery policy'] as const)
  test(`native Smart guardian rechecks ${changed} after durable payer signing before broadcast`, async () => {
    let armed = false;
    let revoke: () => void = () => undefined;
    const { f, guardian, policy, open } = await smartGuardianRecoveryFixture(false, { after(kind, sql) {
      if (armed && kind === 'run' && sql.startsWith('INSERT INTO evm_signed_records')) { armed = false; revoke(); }
    } });
    const controller = await open();
    try {
      await controller.prepare(); await controller.review();
      const review = controller.getSnapshot().feeReview!; assert(review);
      revoke = () => {
        if (changed === 'Smart policy') f.smartGuardian(guardian.address, ['0x' + '77'.repeat(20)]);
        else policy.configure(guardian.address, 1200);
      };
      armed = true;
      await controller.confirm(review.id);
      assert.equal(armed, false, 'the regression must revoke authority after the actual signed-record write');
      assert.equal(f.payerSignatures.length, 1); assert.equal(f.submitted.length, 0);
      assert(f.runtime.getGuardianRecoveryIntent());
    } finally { controller.dispose(); await f.close(); }
  });

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
    controller.dispose(); await f.reopen(); await f.owner.unlock();
    resumed = await f.runtime.openGuardianRecovery({ kind: 'resume' }, new AbortController().signal, () => undefined, null);
    await resumed.prepare(); await resumed.review();
    assert.equal(resumed.getSnapshot().phase, 'waiting');
    assert.equal(resumed.getSnapshot().transactionHash, hash);
    assert.equal(resumed.getSnapshot().canAbandon, false);
    assert.equal(f.submitted.length, 1); assert.equal(f.signatures.length, 2);
  } finally { resumed?.dispose(); controller.dispose(); await f.close(); }
});

test('P256 guardian replacement survives an unknown submission and restart without recreating or re-signing', async () => {
  let f!: Awaited<ReturnType<typeof fixture>>, creates = 0, assertions = 0, prompt = false;
  const registration = { backupStatus: 'deviceBound' as const, credentialId: 'AQ', credentialIdHash: '0x' + '01'.repeat(32), rawId: 'AQ', userHandle: 'Ag',
    x: '0x' + '02'.repeat(32), y: '0x' + '03'.repeat(32), rpIdHash: '0x' + '04'.repeat(32), originHash: '0x' + '05'.repeat(32), originLength: 22 };
  const hashes: string[] = [];
  const passkeys: NonNullable<KeyringRuntimeDependencies['passkeys']> = {
    async create(request) { prompt = true; try { request.assertCurrent(); f.assertNoSigningKeys(); creates++; return registration; } finally { prompt = false; } },
    async sign(request) { prompt = true; try { request.assertCurrent(); f.assertNoSigningKeys(); hashes.push(request.actionHash); assertions++; return {signature:'0xab'}; } finally { prompt = false; } },
    async recover() { throw Error('Unexpected discovery'); },
  };
  f = await fixture({}, true, null, undefined, undefined, passkeys);
  const scope = createNativePrivateAuthenticationScope(), lifetime = new AbortController();
  const binding = bindNativePrivateAuthentication(scope, { assertCurrent() {}, isPromptActive: () => prompt });
  let controller: Awaited<ReturnType<KeyringRuntime['openGuardianRecovery']>> | undefined;
  try {
    await f.change({kind:'create-smart',label:'Passkey recovery'});
    const guardian = f.owner.getCatalogue()!.accounts.find(account => account.id === 'hd:60:0')!;
    f.guardianStatus('installed').configure(guardian.address, 600); f.externalOwner();
    controller = await f.runtime.openGuardianRecovery({kind:'start',guardianId:guardian.id,payerId:guardian.id,replacement:{kind:'passkey',recreate:false}}, lifetime.signal, () => undefined, binding);
    const intent = f.runtime.getGuardianRecoveryIntent()!;
    assert.equal(intent.replacement.kind, 'passkey'); assert.equal(intent.target.auth.module, 'p256-webauthn'); assert.equal(creates, 1);
    f.holdReceipts(); f.onBroadcast(() => { throw Error('Reply lost after delivery'); });
    await controller.review(); assert.deepEqual(hashes, [intent.operation.hash]);
    assert.equal(f.signatures.length, 1, 'only the guardian uses a software proof');
    await controller.confirm(controller.getSnapshot().feeReview!.id);
    assert.equal(controller.getSnapshot().phase, 'unknown'); const hash = controller.getSnapshot().transactionHash;
    controller.dispose(); controller = undefined;
    await f.reopen(); await f.owner.unlock();
    assert.deepEqual(f.runtime.getGuardianRecoveryIntent()!.target, intent.target);
    controller = await f.runtime.openGuardianRecovery({kind:'resume'}, lifetime.signal, () => undefined, binding);
    await controller.prepare(); await controller.review();
    assert.equal(controller.getSnapshot().phase, 'waiting'); assert.equal(controller.getSnapshot().transactionHash, hash);
    assert.equal(creates, 1); assert.equal(assertions, 1); assert.equal(f.submitted.length, 1);
  } finally { lifetime.abort(); scope.retire(); controller?.dispose(); await f.close(); }
});

test('locking during new recovery observation cannot persist an intent or sign', async () => {
  const f = await fixture({}, true);
  let held: ReturnType<typeof f.guardianStatus> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Held recovery',});
    held = f.guardianStatus('hold');
    const pending = f.runtime.openGuardianRecovery({ kind: 'start', guardianId: 'hd:60:0', replacement: { kind: 'software' as const, accountId: 'hd:60:0' }, payerId: 'hd:60:0' }, new AbortController().signal, () => undefined, null);
    const rejected = assert.rejects(pending);
    for (let i = 0; !held.methods().length && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(held.methods().length); f.owner.lock(); held.release(); await rejected;
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
    await f.owner.unlock(); assert.equal(f.runtime.getGuardianRecoveryIntent(), null);
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


async function smartMessageApproval(f: Awaited<ReturnType<typeof fixture>>) {
  const host = await f.runtime.openConnectionHost();
  const selected = host.context().accounts.find(account => account.type === 'SmartAccount')!;
  let grant: import('../../../source/shared/dappTypes.ts').DappGrant | undefined = {
    accountId: selected.index,
    accountType: selected.type as import('../../../source/types/network.ts').KeyringAccountType,
    chain: 'ethereum' as import('../../../source/types/network.ts').INetworkType,
    chainId: 1, host: 'https://fixture.example', date: 1,
  };
  const approval = createDappSigningApproval({
    readScope: () => ({
      account: { id: selected.index, type: selected.type, address: selected.address, xpub: selected.xpub },
      grant, network: host.context().network, isBitcoinBased: false, sessionGeneration: host.sessionGeneration(),
    }),
    subscribe: changed => f.owner.subscribe(() => changed()),
  });
  return { host, selected, approval, revoke() { grant = undefined; } };
}

/** Actual continuation ownership for SDK-port tests; relay/UI qualification is separate. */
function ownedSmartSdkHandoff(connection: Awaited<ReturnType<typeof smartMessageApproval>>, id: string, expiresAt: number, method: string) {
  const wire: WalletConnectRequest = {id:1,method,params:[],chainId:'eip155:1',freshness:'fresh',expiresAt,
    verification:{validation:'VALID',isScam:false},session:{binding:{topic:'aa'.repeat(32),peerPublicKey:'bb'.repeat(32),origin:'https://fixture.example'},
      metadata:{name:'SDK fixture',description:'',url:'https://fixture.example',icons:[]},expiry:Math.ceil(expiresAt/1000),namespaces:{eip155:{accounts:[`eip155:1:${connection.selected.address}`],methods:[method],events:[]}}}};
  const canceled: object[] = [];
  const manager = new NativeSigningHandoffs({async cancel(job){canceled.push(job);await connection.host.cancelSigningHandoff(job);},changed(){}});
  let current: NativeSigningHandoff;
  const capture = (admitted: typeof connection, saved: SigningHandoffDescriptor | null) => {
    const context=admitted.host.context(),signing=admitted.host.signingContext(admitted.selected.id);
    const scope:SigningResumeScope={adapter:1,wallet:'disposable-sdk-fixture',unlockGeneration:admitted.host.sessionGeneration(),accountId:admitted.selected.id,
      address:admitted.selected.address,type:admitted.selected.type,xpub:admitted.selected.xpub,registration:JSON.stringify(context.network),grant:'fixture-origin-grant',signing:signing.binding,trezor:signing.trezor};
    let live=true,owned!:NativeSigningHandoff;
    const entry={id,wire,scope,expiresAt:saved?.expiresAt??expiresAt,order:1,assertCurrent(){if(!live)throw Error('CANCELLED');admitted.approval.assertCurrent();},
      eligible:()=>true,drain:async()=>undefined,retire(){live=false;retireNativeSigningHandoff(owned);}};
    owned=saved?manager.resume(entry,saved):manager.capture(entry);
    current=owned;
    if(saved)manager.discard(saved,false);
    return owned;
  };
  capture(connection,null);
  return {get handoff(){return current;},suspend(){assert(manager.background(current));},resume(next:typeof connection){const saved=manager.descriptor(id);assert(saved);return capture(next,saved);},
    terminal(){assert.throws(()=>current.beforeSuiteOpen(expiresAt,{}),/REQUEST_EXPIRED/);},
    retired:()=>manager.retired(),async dispose(){manager.cancelDapp();retireNativeSigningHandoff(current);await manager.retired();},canceled};
}

for (const deployed of [false, true]) test(`real SDK Smart personal and V4 messages share exact ERC-7739 envelopes (deployed ${deployed})`, async () => {
  const f = await fixture({}, true);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Message signer',});
    if (deployed) f.deployed();
    connection = await smartMessageApproval(f);
    const { host, selected, approval } = connection;
    const owner = f.owner.getCatalogue()!.accounts.find(account => account.id === 'hd:60:0')!.address;
    assert.equal(host.supportsSmartAccountMessages(selected.id), true);
    const requests: DappMessageRequest[] = [
      { method: 'personal_sign', address: selected.address, message: 'Hello Pali' },
      { method: 'personal_sign', address: selected.address, message: '0x48656c6c6f' },
      { method: 'eth_signTypedData_v4', address: selected.address, version: 'V4', typedData: {
        domain: { name: 'Dapp', version: '1', chainId: 10, verifyingContract: '0x' + '22'.repeat(20) },
        types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
          Mail: [{ name: 'contents', type: 'string' }] },
        primaryType: 'Mail', message: { contents: 'Bound to the Smart account' },
      } },
    ];
    for (const request of requests) {
      const prepared = prepareSmartAccountMessage({ accountAddress: selected.address, chainId: 1, request });
      const result = await host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', request, approval }, null);
      const signed = f.signatures.at(-1)!;
      assert.equal(signed.address.toLowerCase(), owner.toLowerCase());
      assert.equal(signed.digest, prepared.actionHash);
      assert.equal(recoverAddress(prepared.actionHash, signed.signature).toLowerCase(), owner.toLowerCase());
      assert.equal(result, encodeSmartAccountMessageSignature(prepared, {
        validator: getConfiguredAuthenticatorAddress(1, 'ecdsa'), signature: signed.signature,
      }));
      assert.equal(result.slice(2, 42).toLowerCase(), getConfiguredAuthenticatorAddress(1, 'ecdsa').slice(2).toLowerCase());
      if (prepared.method === 'eth_signTypedData_v4') assert.equal(prepared.proof.appDomainSeparator.length, 66);
    }
    assert.equal(f.signatures.length, 3);
    assert.equal(f.submitted.length, 0);
    assert(!f.calls.includes('eth_estimateGas'));
  } finally { connection?.approval.dispose(); await f.close(); }
});

test('Smart message signing refuses a freshly observed external validator owner', async () => {
  const f = await fixture({}, true);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Changed owner',});
    f.deployed(); f.externalOwner();
    connection = await smartMessageApproval(f);
    const { host, selected, approval } = connection;
    assert.equal(host.supportsSmartAccountMessages(selected.id), true, 'local capability is revalidated from the chain during signing');
    await assert.rejects(host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', approval,
      request: { method: 'personal_sign', address: selected.address, message: 'Stale owner' } }, null));
    assert.equal(f.signatures.length, 0);
    assert.equal(f.submitted.length, 0);
  } finally { connection?.approval.dispose(); await f.close(); }
});

for (const phase of ['metadata', 'signing'] as const) test(`Smart message signing discards approval revoked during ${phase}`, async () => {
  const f = await fixture({}, true);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  try {
    await f.change({ kind: 'create-smart', label: 'Revoked approval',});
    f.deployed(); connection = await smartMessageApproval(f);
    const { host, selected, approval } = connection;
    const stop = async () => { entered = true; await held; };
    if (phase === 'metadata') f.onSmartCodeRead(stop); else f.onSignature(stop);
    const signing = host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', approval,
      request: { method: 'personal_sign', address: selected.address, message: 'Requires live approval' } }, null);
    const rejected = assert.rejects(signing);
    for (let i = 0; !entered && i < 300; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(entered);
    connection.revoke(); release(); await rejected;
    assert.equal(f.signatures.length, 0);
    assert.equal(f.submitted.length, 0);
  } finally { release(); connection?.approval.dispose(); await f.close(); }
});

for (const method of ['eth_signTypedData', 'eth_signTypedData_v3'] as const) test(`Smart message signing rejects ${method} before SDK signing`, async () => {
  const f = await fixture({}, true);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'V4 only',});
    connection = await smartMessageApproval(f);
    const { host, selected, approval } = connection;
    const request: DappMessageRequest = method === 'eth_signTypedData'
      ? { method, address: selected.address, version: 'V1', typedData: [{ name: 'message', type: 'string', value: 'hello' }] }
      : { method, address: selected.address, version: 'V3', typedData: {
        domain: { name: 'Dapp' }, types: { EIP712Domain: [{ name: 'name', type: 'string' }], Mail: [{ name: 'contents', type: 'string' }] },
        primaryType: 'Mail', message: { contents: 'hello' },
      } };
    await assert.rejects(host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', approval, request }, null));
    assert.equal(f.signatures.length, 0);
    assert.equal(f.submitted.length, 0);
  } finally { connection?.approval.dispose(); await f.close(); }
});


test('one Smart owner consent shares its OS read across two SDK leases; payer and next action require fresh reads', async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create', label: 'Second transaction owner',});
    await f.change({ kind: 'create-smart', label: 'Two transaction owners',});
    const owners = f.owner.getCatalogue()!.accounts.filter(account => account.type === 'HDAccount' && account.slip44 === 60);
    assert.equal(owners.length, 2);
    f.deployed(); f.fundedSmart(); f.holdReceipts();
    f.observedEcdsaOwners(owners.map(owner => owner.address), 2);
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222',
      { kind: 'exact', amount: '0.000000000000000009' }, () => undefined, null);
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize', JSON.stringify(operation.getSnapshot()));
    const reads = f.credentialReads, leases = f.secretLeases;
    const pending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    const review = operation.getSnapshot().payerReview;
    assert(review, JSON.stringify(operation.getSnapshot()));
    assert.equal(f.credentialReads - reads, 1, 'one reviewed owner proof has one OS read');
    assert.equal(f.secretLeases - leases, 2);
    assert.equal(f.completedSecretLeases, f.secretLeases); f.assertNoSigningKeys();
    assert.equal(f.signatures.length, 2);
    assert.deepEqual(f.signatures.map(signed => signed.address.toLowerCase()), owners.map(owner => owner.address.toLowerCase()));
    assert.equal(f.submitted.length, 0);
    operation.confirmPayer(review.id);
    await pending;
    assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
    assert.equal(f.credentialReads - reads, 2, 'separate payer consent performs a fresh OS read');
    assert.equal(f.completedSecretLeases, f.secretLeases); f.assertNoSigningKeys();
    assert.equal(f.submitted.length, 1);
    const outer = Transaction.from(f.submitted[0]!);
    const [operations] = paliEntryPointInterface.decodeFunctionData('handleOps', outer.data);
    const signatures = f.signatures.map(signed => signed.signature);
    assert(operations[0].signature.endsWith(coder.encode(['bytes[]'], [signatures]).slice(2)));
    signatures.forEach((signature, index) => {
      assert.equal(recoverAddress(f.signatures[index]!.digest, signature).toLowerCase(), owners[index]!.address.toLowerCase());
    });
    const connection = await smartMessageApproval(f);
    try {
      await connection.host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: connection.selected.id, networkId: 'ethereum',
        request: { method: 'personal_sign', address: connection.selected.address, message: 'A fresh, separately reviewed action' }, approval: connection.approval }, null);
      assert.equal(f.credentialReads - reads, 3, 'a new action cannot reuse the previous owner or payer credential');
      assert.equal(f.completedSecretLeases, f.secretLeases); f.assertNoSigningKeys();
    } finally { connection.approval.dispose(); }

  } finally { operation?.dispose(); await f.close(); }
});

test('Smart message signing assembles the configured local ECDSA threshold using the existing SDK', async () => {
  const f = await fixture({}, true);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    await f.change({ kind: 'create', label: 'Second owner',});
    await f.change({ kind: 'create-smart', label: 'Two owners',});
    const owners = f.owner.getCatalogue()!.accounts.filter(account => account.type === 'HDAccount' && account.slip44 === 60);
    assert.equal(owners.length, 2);
    f.deployed(); f.observedEcdsaOwners(owners.map(owner => owner.address), 2);
    connection = await smartMessageApproval(f);
    const { host, selected, approval } = connection;
    const request: DappMessageRequest = { method: 'personal_sign', address: selected.address, message: 'Both local owners approve' };
    const prepared = prepareSmartAccountMessage({ accountAddress: selected.address, chainId: 1, request });
    const result = await host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', request, approval }, null);
    assert.equal(f.signatures.length, 2);
    const [signatures] = coder.decode(['bytes[]'], '0x' + result.slice(42));
    assert.equal(signatures.length, 2);
    signatures.forEach((signature: string, index: number) => {
      assert.equal(recoverAddress(prepared.actionHash, signature).toLowerCase(), owners[index]!.address.toLowerCase());
    });
    assert.equal(f.submitted.length, 0);
  } finally { connection?.approval.dispose(); await f.close(); }
});

test('Smart message signing refuses an RPC chain change before signing', async () => {
  const f = await fixture({}, true);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Chain-bound signer',});
    connection = await smartMessageApproval(f);
    f.wrongChain();
    const { host, selected, approval } = connection;
    await assert.rejects(host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', approval,
      request: { method: 'personal_sign', address: selected.address, message: 'Original chain' } }, null));
    assert.equal(f.signatures.length, 0);
  } finally { connection?.approval.dispose(); await f.close(); }
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
    await f.owner.unlock();
    const before = (await f.inspectRecovery()).record as {
      groups: unknown;
      recovery: unknown;
    };
    resumed = await f.runtime.openGuardianRecovery(
      { kind: 'resume' },
      new AbortController().signal,
      () => undefined
    , null);
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
    await f.owner.unlock();
    assert.equal(f.runtime.getGuardianRecoveryIntent(), null);
    await f.change({ kind: 'remove', id: replacement.id,});
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
    , null);
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


async function compositeMessageFixture(ownerThreshold = 2, childThreshold = 1, ecdsaFirst = false) {
  const f = await fixture({}, true);
  await f.change({ kind: 'create', label: 'Second message owner',});
  await f.change({ kind: 'create-smart', label: 'Composite message owner',});
  const owners = f.owner.getCatalogue()!.accounts.filter(account => account.type === 'HDAccount' && account.slip44 === 60);
  f.guardianStatus('no-policy'); f.observedEcdsaOwners(owners.map(owner => owner.address), ownerThreshold); f.observedComposite(childThreshold, ecdsaFirst);
  await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
  return { f, owners, connection: await smartMessageApproval(f) };
}
for (const ecdsaFirst of [false, true]) test(`composite Smart messages preserve shared child slots, inner owner threshold and ERC-7739 proof (ECDSA first ${ecdsaFirst})`, async () => {
  const { f, owners, connection } = await compositeMessageFixture(2, 1, ecdsaFirst);
  assert.equal(f.runtime.canSignSmartAccount(), true);
  const { host, selected, approval } = connection;
  const bound: string[] = [], bind = approval.bindSigner;
  approval.bindSigner = (key, current) => { bound.push(key); bind(key, current); };
  try {
    assert.equal(host.supportsSmartAccountMessages(selected.id), true);
    const requests: DappMessageRequest[] = [
      { method: 'personal_sign', address: selected.address, message: 'Shared composite owner proof' },
      { method: 'eth_signTypedData_v4', address: selected.address, version: 'V4', typedData: {
        domain: { name: 'Dapp', chainId: 10 }, types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }], Mail: [{ name: 'contents', type: 'string' }] },
        primaryType: 'Mail', message: { contents: 'Preserve the original dapp domain' },
      } },
    ];
    for (const request of requests) {
      const start = f.signatures.length, prepared = prepareSmartAccountMessage({ accountAddress: selected.address, chainId: 1, request });
      const result = await host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', request, approval }, null);
      const signatures = f.signatures.slice(start);
      assert.equal(signatures.length, 2);
      assert.deepEqual(signatures.map(signature => signature.address.toLowerCase()), owners.map(owner => owner.address.toLowerCase()));
      signatures.forEach(signature => { assert.equal(signature.digest, prepared.actionHash); assert.equal(recoverAddress(prepared.actionHash, signature.signature).toLowerCase(), signature.address.toLowerCase()); });
      const inner = coder.encode(['bytes[]'], [signatures.map(signature => signature.signature)]);
      const aggregate = coder.encode(['bytes[]'], [ecdsaFirst ? [inner, '0x'] : ['0x', inner]]);
      assert.equal(result, encodeSmartAccountMessageSignature(prepared, { validator: getConfiguredAuthenticatorAddress(1, 'composite'), signature: aggregate }));
    }
    assert.equal(bound.filter(key => key === 'native-smart-message:HDAccount:0').length, 2);
    assert.equal(bound.filter(key => key === 'native-smart-message:HDAccount:1').length, 2);
    assert.equal(f.submitted.length, 0);
  } finally { approval.dispose(); await f.close(); }
});

test('composite Smart message capability refuses missing owner keys and unavailable child ports', async () => {
  const { f, connection } = await compositeMessageFixture(1, 2);
  try {
    assert.equal(connection.host.supportsSmartAccountMessages(connection.selected.id), false);
    assert.equal(f.runtime.canSignSmartAccount(), false);
    f.observedComposite(1); f.observedEcdsaOwners(['0x' + '66'.repeat(20)], 1);
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    const next = await f.runtime.openConnectionHost();
    assert.equal(next.supportsSmartAccountMessages(connection.selected.id), false);
    assert.equal(f.signatures.length, 0);
  } finally { connection.approval.dispose(); await f.close(); }
});

for (const failure of ['reject', 'lock', 'owner-replaced'] as const) test(`composite Smart message ${failure} during the SDK boundary cannot fall through to another owner`, async () => {
  const { f, connection } = await compositeMessageFixture();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.onSignature(async () => { entered.resolve(); if (failure === 'reject') throw Error('USER_REJECTED'); await release.promise; });
  const { host, selected, approval } = connection;
  try {
    const work = host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', approval,
      request: { method: 'personal_sign', address: selected.address, message: 'Original owner only' } }, null);
    const rejected = assert.rejects(work); await entered.promise;
    const locking = failure === 'lock' ? f.owner.lock() : undefined;
    if (failure === 'owner-replaced') f.replaceSoftwareOwner('HDAccount', 0);
    release.resolve(); await rejected; await locking;
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally { release.resolve(); approval.dispose(); await f.close(); }
});

test('composite Smart messages bind only the actually-used owner until final delivery, and reject a later network selection', async () => {
  const { f, connection } = await compositeMessageFixture(1);
  const { host, selected, approval } = connection;
  const bound: string[] = [], bind = approval.bindSigner;
  approval.bindSigner = (key, current) => { bound.push(key); bind(key, current); };
  try {
    const request: DappMessageRequest = { method: 'personal_sign', address: selected.address, message: 'Retain the owner through delivery' };
    await host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', approval, request }, null);
    assert.deepEqual(bound.filter(key => key.startsWith('native-smart-message:')), ['native-smart-message:HDAccount:0']);
    f.replaceSoftwareOwner('HDAccount', 1); approval.assertCurrent();
    f.replaceSoftwareOwner('HDAccount', 0); assert.throws(approval.assertCurrent);
    const next = await smartMessageApproval(f);
    try {
      await next.host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: next.selected.id, networkId: 'ethereum', approval: next.approval, request }, null);
      await f.selectNetwork('syscoin-nevm');
      assert.throws(next.approval.assertCurrent);
      assert.equal(f.signatures.length, 2); assert.equal(f.submitted.length, 0);
    } finally { next.approval.dispose(); }
  } finally { approval.dispose(); await f.close(); }
});

for (const threshold of [1, 2]) test(`plain ECDSA Smart messages keep configured inverse owner order through actual SDK signing (threshold ${threshold})`, async () => {
  const f = await fixture({}, true);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    await f.change({ kind: 'create', label: 'Configured first owner',});
    await f.change({ kind: 'create-smart', label: 'Ordered message owners',});
    const owners = f.owner.getCatalogue()!.accounts.filter(account => account.type === 'HDAccount' && account.slip44 === 60).reverse();
    f.deployed(); f.observedEcdsaOwners(owners.map(owner => owner.address), threshold);
    connection = await smartMessageApproval(f);
    const { host, selected, approval } = connection;
    const bound: string[] = [], bind = approval.bindSigner;
    approval.bindSigner = (key, current) => { bound.push(key); bind(key, current); };
    const request: DappMessageRequest = { method: 'personal_sign', address: selected.address, message: 'Configured owner order is authoritative' };
    const prepared = prepareSmartAccountMessage({ accountAddress: selected.address, chainId: 1, request });
    const signature = await host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: selected.id, networkId: 'ethereum', approval, request }, null);
    const expected = owners.slice(0, threshold);
    assert.deepEqual(f.signatures.map(signed => signed.address.toLowerCase()), expected.map(owner => owner.address.toLowerCase()));
    assert.deepEqual(bound.filter(key => key.startsWith('native-smart-message:')), expected.map(owner => `native-smart-message:HDAccount:${owner.index}`));
    assert.equal(signature, encodeSmartAccountMessageSignature(prepared, { validator: getConfiguredAuthenticatorAddress(1, 'ecdsa'),
      signature: threshold === 1 ? f.signatures[0]!.signature : coder.encode(['bytes[]'], [f.signatures.map(signed => signed.signature)]) }));
    assert.equal(f.submitted.length, 0); approval.assertCurrent();
  } finally { connection?.approval.dispose(); await f.close(); }
});

test('plain ECDSA Smart transactions keep configured inverse owner order before payer review', async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create', label: 'Configured first transaction owner',});
    await f.change({ kind: 'create-smart', label: 'Ordered transaction owners',});
    const owners = f.owner.getCatalogue()!.accounts.filter(account => account.type === 'HDAccount' && account.slip44 === 60).reverse();
    f.deployed(); f.fundedSmart(); f.holdReceipts(); f.observedEcdsaOwners(owners.map(owner => owner.address), 2);
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined, null);
    await operation.prepare(); assert.equal(operation.getSnapshot().phase, 'authorize');
    const pending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
    assert.deepEqual(f.signatures.map(signed => signed.address.toLowerCase()), owners.map(owner => owner.address.toLowerCase()));
    assert.equal(f.signatures.length, 2); assert.equal(f.submitted.length, 0);
    operation.cancel(); await pending;
    assert.equal(f.submitted.length, 0);
  } finally { operation?.dispose(); await f.close(); }
});


test('native SLH stays explicitly unavailable until full primitive/cache qualification', async () => {
  const f = await fixture();
  try {
    await f.change({ kind: 'create-smart', label: 'SLH qualification gate',});
    await assert.rejects(f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null), { code: 'NOT_READY' });
  } finally { await f.close(); }
});

test('native SLH management and send availability remain closed without the qualified execution port', async () => {
  const f = await fixture({}, true);
  try {
    await f.change({ kind: 'create-smart', label: 'Capability-only admission',});
    assert.equal(f.runtime.canSignSmartAccount(), true); assert.equal(f.runtime.canManageSlhDsa(), false);
    f.guardianStatus('no-policy'); f.observedSlh({pkRoot:`0x${'44'.repeat(16)}${'00'.repeat(16)}`,pkSeed:`0x${'33'.repeat(16)}${'00'.repeat(16)}`});
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    assert.equal(f.runtime.canSignSmartAccount(), false); assert.equal(f.runtime.canManageSlhDsa(), false); assert.equal(f.runtime.canUseWalletAuthenticator(), false);
    assert.deepEqual(f.slhDerivations, []); assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});

test('real selected Smart metadata prevents fresh SLH setup over an installed key or missing state', async () => {
  let executionCalls = 0;
  const f = await fixture({}, false, { open() { executionCalls++; throw Error('native crypto must not start'); }, async purgePublicCache(_namespace, check) { check(); } });
  try {
    await f.change({ kind: 'create-smart', label: 'Installed SLH',});
    f.installSlh();
    const account = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    assert.equal(account.installedKeys.length, 1);
    assert.throws(() => account.prepareFresh(() => undefined), { code: 'NOT_READY' });
    await assert.rejects(account.hydrateInstalled(account.installedKeys[0]!.keyId), /INSTALLED_STATE_MISSING/);
    assert.equal(executionCalls, 0);
    f.owner.lock();
    assert.throws(() => account.hydrateInstalled(account.installedKeys[0]!.keyId), /CANCELLED|SESSION_RETIRED/);
  } finally { await f.close(); }
});


test('fresh SLH setup derives only the verified descriptor index, independently of the Smart display id', async () => {
  let executionCalls = 0;
  const f = await fixture({}, false, { open() { executionCalls++; throw Error('native crypto must not start'); }, async purgePublicCache(_namespace, check) { check(); } });
  try {
    await f.change({ kind: 'create-smart', label: 'Explicit SLH descriptor index',});
    f.mutateSelectedSmart(account => { assert.equal(account.smartAccount!.descriptor!.accountIndex, 0); account.id = 91; });
    const account = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    await assert.rejects(account.prepareFresh(() => undefined));
    assert.deepEqual(f.slhDerivations, [0]);
    assert.equal(executionCalls, 1);
  } finally { await f.close(); }
});

for (const mutation of ['missing', 'index', 'anchor'] as const) test(`fresh SLH setup refuses ${mutation} descriptor metadata after facade capture before SDK derivation`, async () => {
  let executionCalls = 0;
  const f = await fixture({}, false, { open() { executionCalls++; throw Error('native crypto must not start'); }, async purgePublicCache(_namespace, check) { check(); } });
  try {
    await f.change({ kind: 'create-smart', label: 'Captured SLH descriptor',});
    const account = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    f.mutateSelectedSmart(selected => {
      if (mutation === 'missing') delete selected.smartAccount!.descriptor;
      else if (mutation === 'index') selected.smartAccount!.descriptor!.accountIndex++;
      else selected.smartAccount!.descriptor!.anchorHash = `0x${'55'.repeat(32)}`;
    });
    await assert.rejects(async () => account.prepareFresh(() => undefined), { code: 'CANCELLED' });
    assert.deepEqual(f.slhDerivations, []);
    assert.equal(executionCalls, 0);
  } finally { await f.close(); }
});

test('fresh SLH setup refuses a missing descriptor at facade admission before SDK derivation', async () => {
  let executionCalls = 0;
  const f = await fixture({}, false, { open() { executionCalls++; throw Error('native crypto must not start'); }, async purgePublicCache(_namespace, check) { check(); } });
  try {
    await f.change({ kind: 'create-smart', label: 'No inferred SLH index',});
    f.mutateSelectedSmart(account => { delete account.smartAccount!.descriptor; });
    await assert.rejects(f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null), /Smart account address could not be verified/);
    assert.deepEqual(f.slhDerivations, []);
    assert.equal(executionCalls, 0);
  } finally { await f.close(); }
});


/** Public primitive double; the host, SDK profile encryption, signer and SQLite stay real. */
function slhSmartBackend(onRetire: () => Promise<void> = async () => undefined) {
  const roots = new WeakMap<NativeSlhTree, Uint8Array>(), cached = new Map<string, Uint8Array>();
  const actions: string[] = [];
  let opened = 0, closed = 0, setups = 0, cacheLoads = 0;
  let assertOperation: () => void = () => undefined;
  const capability: NativeSlhExecutionCapability = {
    open(owner) {
      assertOperation();
      owner.assertCurrent();
      opened++;
      let retired = false;
      const tree = () => { const value = { async release() {} }; roots.set(value, new Uint8Array(16).fill(0x44)); return value; };
      const host: SlhDsaExecutionHost<NativeSlhTree, NativeSlhKey> = {
        leafConcurrency: 1, forsConcurrency: 1,
        allocateTree: tree, releaseTree: (value, erase) => value.release(erase),
        readTree(value, offset, length) { assert.equal(offset, 134217696); assert.equal(length, 16); return roots.get(value)!.slice(); },
        writeTree() { throw Error('No parallel leaf lane'); },
        async loadTree(keyId) { if (!cached.has(keyId)) return null; cacheLoads++; const value = tree(); roots.set(value, cached.get(keyId)!.slice()); return { tree: value, keyId, bytes: 134217712 }; },
        async saveTree(keyId, value) { cached.set(keyId, roots.get(value)!.slice()); },
        openSetup() { assertOperation(); setups++; return { buildChunk: (_value, _level, _start, count) => { assertOperation(); return count; }, dispose() {} }; },
        createLeafLanes() { throw Error('No parallel leaf lane'); },
        importKey() { return { destroy() {} }; }, releaseKey: value => value.destroy(),
        signPrelude(_key, message) { assertOperation(); assert.deepEqual([...message.subarray(0, 2)], [0, 0]); actions.push(hexlify(message.subarray(2))); return new Uint8Array(46); },
        async signForsTree(_key, _prefix, treeIndex) { return { treeIndex, shard: new Uint8Array(416) }; },
        finishSignature() { return new Uint8Array(3856).fill(9); },
        signCached() { throw Error('No fallback expected'); },
        randomFill: bytes => { bytes.fill(7); }, yield: async () => undefined,
      };
      let retirement: Promise<void> | undefined;
      return { host, isRetired: () => retired, retire() { retired = true; return retirement ??= onRetire().finally(() => { closed++; }); }, async verify() { throw Error('Native crypto remains unqualified'); } };
    },
    async purgePublicCache(_namespace, check) { check(); cached.clear(); },
  };
  return { capability, actions, get opened() { return opened; }, get active() { return opened - closed; }, get setups() { return setups; }, get cacheLoads() { return cacheLoads; }, checkOperation(check: () => void) { assertOperation = check; }, forgetCache() { cached.clear(); } };
}
async function provisionSlhSmart(f: Awaited<ReturnType<typeof fixture>>) {
  await f.change({ kind: 'create-smart', label: 'Owned SLH signer',});
  const account = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
  const key = await account.prepareFresh(() => undefined);
  f.observedSlh(key); f.guardianStatus('no-policy');
  await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
  return key;
}

test('prepared uninstalled SLH status survives cold unlock without rederivation or native execution', async () => {
  const backend = slhSmartBackend(), f = await fixture({}, true, backend.capability);
  backend.checkOperation(() => f.assertOneSigningOperation());
  f.assertNoSigningKeys();
  try {
    await f.change({ kind: 'create-smart', label: 'Prepared signer',});
    let facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    const key = await facade.prepareFresh(() => undefined);
    assert.equal(backend.active, 0, 'setup releases its native context before returning');
    f.assertNoSigningKeys();
    const row = await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(key.keyId));
    assert.deepEqual(await facade.readPrepared(), [key]);
    assert.equal(f.runtime.canManageSlhDsa(), true); assert.equal(f.runtime.canSignSmartAccount(), true);
    await f.reopen(); await f.owner.unlock();
    const opened = backend.opened;
    facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    assert.deepEqual(await facade.readPrepared(), [key]);
    assert.equal(backend.opened, opened, 'status must not create a native context');
    f.assertNoSigningKeys();
    assert.deepEqual(f.slhDerivations, [0]);
    assert.deepEqual(await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(key.keyId)), row);
    f.mutateSelectedSmart(account => { account.smartAccount!.descriptor!.accountIndex++; });
    await assert.rejects(Promise.resolve().then(() => facade.readPrepared()), /CANCELLED/);
    assert.deepEqual(f.slhDerivations, [0]); assert.equal(backend.actions.length, 0);
  } finally { await f.close(); }
});

test('the fixed SDK host adapter checkpoints SLH writes before lock and HD journal qualification', async () => {
  const backend = slhSmartBackend(), f = await fixture({}, true, backend.capability);
  try {
    await f.change({ kind: 'create-smart', label: 'Checkpointed SLH fixture' });
    const facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    const key = await facade.prepareFresh(() => undefined);
    const ring = f.sdkHost, adapter = f.sdkHostStorage, storageKey = getSLHDSAStateStorageKey(key.keyId);
    const check = () => { assert.equal(f.sdkHost, ring); assert.equal(f.sdkHostStorage, adapter); assert(ring.hasPublicSession()); };
    await withTestCredentialOperation(f.storage.credential, credentialPort, ring, check, async () => {
      const previous = await adapter.get(storageKey) as { cipherText: string; updatedAt: number };
      const crypto = createSlhDsaProfileStateCrypto(ring, check);
      const state = JSON.parse(await crypto.decrypt(previous.cipherText, key.keyId));
      state.signatureCount++;
      const next = { ...previous, cipherText: await crypto.encrypt(JSON.stringify(state), key.keyId), updatedAt: previous.updatedAt + 1 };
      assert.equal(await adapter.compareAndSetMany([{ key: storageKey, expected: previous, value: next }], check), true);
    });
    f.assertNoSigningKeys();
    f.owner.lock(); await f.owner.unlock();
    const restored = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    assert.equal((await restored.readPrepared())[0]!.signatureCount, 1);
    await f.change({ kind: 'select', id: 'hd:60:0' });
    const evidence = await qualifyNativeHdAccounts({ phase: 'create', authority: f.owner, runtime: f.runtime, storage: f.storage,
      expectedSecondAddress: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0', check: async (_name, work) => work() });
    assert.equal(evidence.nativeHdAccountsVerified, true);
    assert.notEqual(evidence.transferHash, evidence.firstTransferHash);
    f.assertNoSigningKeys();
  } finally { await f.close(); }
});

test('SLH repeated signing and cold status retain only encrypted state and public metadata between actions', async () => {
  const backend = slhSmartBackend(), f = await fixture({}, true, backend.capability);
  backend.checkOperation(() => f.assertOneSigningOperation());
  f.assertNoSigningKeys();
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    const key = await provisionSlhSmart(f);
    assert.equal(backend.active, 0); f.assertNoSigningKeys();
    connection = await smartMessageApproval(f);
    for (const message of ['First bounded SLH action', 'Second bounded SLH action']) {
      await connection.host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: connection.selected.id, networkId: 'ethereum', approval: connection.approval,
        request: { method: 'personal_sign', address: connection.selected.address, message } }, null);
      assert.equal(backend.active, 0, 'no reusable native signer remains'); f.assertNoSigningKeys();
    }
    connection.approval.dispose(); connection = undefined;
    await f.reopen(); await f.owner.unlock();
    const opened = backend.opened;
    const facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    assert.equal((await facade.hydrateInstalled(key.keyId)).signatureCount, 2);
    assert.equal(backend.opened, opened); assert.equal(backend.active, 0); f.assertNoSigningKeys();
    assert.deepEqual(f.slhDerivations, [0]);
    assert.equal(backend.setups, 1, 'later signatures reuse the published tree without rebuilding it');
    assert.equal(backend.cacheLoads, 2, 'each new action opens the existing public tree');
  } finally { connection?.approval.dispose(); await f.close(); }
});

test('previously used uninstalled SLH key explicitly rebuilds missing cache without resetting usage', async () => {
  const backend = slhSmartBackend(), f = await fixture({}, true, backend.capability);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    const key = await provisionSlhSmart(f);
    connection = await smartMessageApproval(f);
    await connection.host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: connection.selected.id, networkId: 'ethereum', approval: connection.approval,
      request: { method: 'personal_sign', address: connection.selected.address, message: 'Retained prepared usage' } }, null);
    connection.approval.dispose(); connection = undefined;
    f.clearObservedSlh();
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    await f.reopen(); await f.owner.unlock(); backend.forgetCache();
    const facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null), opened = backend.opened;
    const [saved] = await facade.readPrepared(); assert(saved);
    assert.equal(saved.signatureCount, 1); assert.equal(backend.opened, opened);
    const rebuilt = await facade.rebuildPrepared(key.keyId, () => undefined);
    assert.equal(rebuilt.keyId, key.keyId); assert.equal(rebuilt.signatureCount, 1);
    assert.deepEqual(f.slhDerivations, [0, 0]); assert.equal(backend.actions.length, 1);
    assert.equal((await facade.readPrepared())[0]!.signatureCount, 1);
  } finally { connection?.approval.dispose(); await f.close(); }
});

for (const delayedMetadata of [false, true]) test(`SLH installation uses exact prepared target and preserves confirmed hash (${delayedMetadata})`, async () => {
  const backend = slhSmartBackend(), f = await fixture({}, true, backend.capability);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Install prepared signer',});
    const facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null), key = await facade.prepareFresh(() => undefined);
    f.guardianStatus('no-policy'); f.fundedSmart();
    operation = await f.runtime.openSlhDsaInstallation(key.keyId, new AbortController().signal, () => undefined, null);
    const intent = operation.getSnapshot().intent;
    assert.equal(intent.kind, 'authenticator');
    if (intent.kind !== 'authenticator') throw Error('Wrong intent');
    assert.equal(intent.command.targetModule.id, 'slh-dsa');
    if (intent.command.targetModule.id !== 'slh-dsa') throw Error('Wrong target');
    assert.equal(intent.command.targetModule.config.pkRoot, key.pkRoot);
    assert.equal(intent.command.targetModule.config.pkSeed, key.pkSeed);
    assert.equal(intent.command.targetModule.config.keyId, key.keyId);
    f.onBroadcast(() => { if (!delayedMetadata) f.observedSlh(key); });
    await confirmPolicyOperation(operation);
    assert.equal(operation.getSnapshot().phase, 'complete');
    assert.equal(operation.getSnapshot().metadataRefresh, delayedMetadata ? 'failed' : 'complete');
    const hash = operation.getSnapshot().transactionHash; assert(hash);
    assert.equal(f.submitted.length, 1); assert.equal(f.signatures.length, 1); assert.deepEqual(backend.actions, []);
    if (delayedMetadata) {
      f.observedSlh(key); await operation.retryMetadata();
      assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
      assert.equal(operation.getSnapshot().transactionHash, hash);
      await operation.authorize(operation.getSnapshot().revision);
      assert.equal(f.submitted.length, 1); assert.equal(f.signatures.length, 1);
    }
    assert.equal(f.runtime.canSignSmartAccount(), true); assert.equal(f.runtime.canUseWalletAuthenticator(), true);
    const installed = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    assert.equal((await installed.hydrateInstalled(key.keyId)).signatureCount, 0);
    await assert.rejects(Promise.resolve().then(() => installed.prepareFresh(() => undefined)), /NOT_READY/);
  } finally { await operation?.dispose(); await f.close(); }
});

test('SLH installation refuses a missing saved key and retains uncertain submission without a second transaction', async () => {
  const backend = slhSmartBackend(), f = await fixture({}, true, backend.capability);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Uncertain signer installation',});
    const facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null), key = await facade.prepareFresh(() => undefined);
    f.guardianStatus('no-policy'); f.fundedSmart();
    const missing = getSLHDSAKeyId({ pkSeed: key.pkSeed, pkRoot: `0x${'55'.repeat(16)}${'00'.repeat(16)}` });
    await assert.rejects(f.runtime.openSlhDsaInstallation(missing, new AbortController().signal, () => undefined, null), /NOT_READY/);
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
    operation = await f.runtime.openSlhDsaInstallation(key.keyId, new AbortController().signal, () => undefined, null);
    f.holdReceipts(); f.onBroadcast(() => { throw Error('Reply lost after dispatch'); });
    await confirmPolicyOperation(operation);
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.match(operation.getSnapshot().error!, /Check the account and Activity/);
    const hash = operation.getSnapshot().transactionHash; assert(hash);
    assert.equal(operation.getSnapshot().userOperationSubmissionStarted, true);
    await operation.authorize(operation.getSnapshot().revision);
    assert.equal(operation.getSnapshot().transactionHash, hash); assert.equal(f.submitted.length, 1); assert.equal(f.signatures.length, 1);
  } finally { await operation?.dispose(); await f.close(); }
});

test('healthy wallet lock waits for the captured SLH execution to drain', async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let armed = false;
  const backend = slhSmartBackend(async () => { if (armed) { entered.resolve(); await release.promise; } });
  const f = await fixture({}, true, backend.capability);
  try {
    const key = await provisionSlhSmart(f);
    const facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    armed = true;
    const signing = facade.signActionHash({ ...key, actionHash: `0x${'42'.repeat(32)}` }, null, () => undefined);
    const rejected = assert.rejects(signing);
    await entered.promise;
    f.assertNoSigningKeys();
    let settled = false;
    const locked = f.runtime.session.lock().finally(() => { settled = true; });
    await entered.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'healthy lock must retain the native drain barrier');
    f.assertNoSigningKeys();
    await assert.rejects(f.runtime.session.readSelectedAddress(), /NOT_READY/);
    release.resolve(); await locked; await rejected;
    assert.equal(settled, true);
  } finally { release.resolve(); await f.close(); }
});

test('lost storage acknowledgement quarantines before held SLH drainage and still drains before close', async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), fault = Promise.withResolvers<void>();
  let holdRetirement = false;
  const backend = slhSmartBackend(async () => { if (holdRetirement) { entered.resolve(); await release.promise; } });
  let armed = false;
  const f = await fixture({ after: (kind, sql) => {
    if (armed && kind === 'exec' && sql === 'COMMIT') {
      armed = false; fault.resolve(); throw Error('lost catalogue acknowledgement');
    }
  } }, true, backend.capability);
  try {
    const key = await provisionSlhSmart(f);
    const facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    holdRetirement = true;
    const signing = facade.signActionHash({ ...key, actionHash: `0x${'42'.repeat(32)}` }, null, () => undefined);
    const signingRejected = assert.rejects(signing);
    await entered.promise;
    const retained = await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(key.keyId));
    armed = true;
    const change = f.change({ kind: 'select', id: 'hd:60:0' });
    const rejected = assert.rejects(change, /UNAVAILABLE/);
    await entered.promise; await fault.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.owner.getSnapshot().phase, 'unavailable', 'quarantine must not await native drainage');
    await assert.rejects(f.owner.unlock(), /NOT_READY/);
    await assert.rejects(f.runtime.backup.readPhrase({ method: 'device' }), /CANCELLED/);
    await rejected;
    let closed = false;
    const close = f.owner.dispose().finally(() => { closed = true; });
    const closeRejected = assert.rejects(close, /CLEANUP_FAILED/);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, false, 'quarantined close must still join the native drain');
    release.resolve(); await closeRejected; await signingRejected;
    await f.reopenQuarantined(); await f.owner.unlock();
    assert.deepEqual(await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(key.keyId)), retained);
    assert.deepEqual(f.slhDerivations, [0]);
  } finally { armed = false; release.resolve(); await f.close().catch(() => undefined); }
});

for (const method of ['personal_sign', 'eth_signTypedData_v4'] as const) test(`actual Smart ${method} withholds the SLH envelope until encrypted usage COMMIT`, async () => {
  const backend = slhSmartBackend();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let armed = false, signerWrite = false;
  const f = await fixture({ before: async (kind, sql) => {
    if (armed && kind === 'run' && /^(?:INSERT INTO|UPDATE) keyring_records /.test(sql)) signerWrite = true;
    if (armed && signerWrite && kind === 'exec' && sql === 'COMMIT') { armed = false; entered.resolve(); await release.promise; }
  } }, true, backend.capability);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    const key = await provisionSlhSmart(f);
    connection = await smartMessageApproval(f);
    assert.equal(connection.host.supportsSmartAccountMessages(connection.selected.id), true);
    const request: DappMessageRequest = method === 'personal_sign'
      ? { method, address: connection.selected.address, message: 'Original connected request' }
      : { method, address: connection.selected.address, version: 'V4', typedData: { domain: { name: 'Original dapp', chainId: 10 }, types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }], Mail: [{ name: 'body', type: 'string' }] }, primaryType: 'Mail', message: { body: 'Original typed message' } } };
    const prepared = prepareSmartAccountMessage({ accountAddress: connection.selected.address, chainId: 1, request });
    armed = true; let settled = false;
    const work = connection.host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: connection.selected.id, networkId: 'ethereum', approval: connection.approval, request }, null).then(value => { settled = true; return value; });
    await entered.promise;
    assert.equal(settled, false); assert.deepEqual(backend.actions, [prepared.actionHash]);
    assert.equal(f.submitted.length, 0); assert.equal(f.signatures.length, 0);
    release.resolve();
    assert.equal(await work, encodeSmartAccountMessageSignature(prepared, { validator: getConfiguredAuthenticatorAddress(1, 'slh-dsa'), signature: hexlify(new Uint8Array(3856).fill(9)) }));
    const facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    assert.equal((await facade.hydrateInstalled(key.keyId)).signatureCount, 1);
    assert.equal(f.submitted.length, 0);
  } finally { release.resolve(); connection?.approval.dispose(); await f.close(); }
});

for (const retire of [false, true]) test(`actual Smart UserOperation releases no payer approval before SLH usage COMMIT (retire ${retire})`, async () => {
  const backend = slhSmartBackend();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let armed = false, signerWrite = false;
  const f = await fixture({ before: async (kind, sql) => {
    if (armed && kind === 'run' && /^(?:INSERT INTO|UPDATE) keyring_records /.test(sql)) signerWrite = true;
    if (armed && signerWrite && kind === 'exec' && sql === 'COMMIT') { armed = false; entered.resolve(); await release.promise; }
  } }, true, backend.capability);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    const key = await provisionSlhSmart(f); f.fundedSmart();
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined, null);
    await operation.prepare(); assert.equal(operation.getSnapshot().phase, 'authorize');
    armed = true;
    const work = operation.authorize(operation.getSnapshot().revision);
    await entered.promise;
    assert.equal(operation.getSnapshot().payerReview, null);
    assert.equal(f.submitted.length, 0); assert.equal(backend.actions.length, 1);
    if (retire) operation.cancel();
    release.resolve();
    if (!retire) {
      for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
      assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
      operation.cancel();
    }
    await work;
    const facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    assert.equal((await facade.hydrateInstalled(key.keyId)).signatureCount, 1);
    assert.equal(f.submitted.length, 0); assert.equal(f.signatures.length, 0);
  } finally { release.resolve(); operation?.dispose(); await f.close(); }
});

for (const method of ['message', 'operation'] as const) test(`actual Smart ${method} refuses missing installed SLH state before signing or payment`, async () => {
  const backend = slhSmartBackend(), f = await fixture({}, true, backend.capability);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Missing SLH private state',});
    f.observedSlh({ pkSeed: `0x${'33'.repeat(16)}${'00'.repeat(16)}`, pkRoot: `0x${'44'.repeat(16)}${'00'.repeat(16)}` });
    f.guardianStatus('no-policy'); f.fundedSmart();
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    if (method === 'message') {
      connection = await smartMessageApproval(f);
      await assert.rejects(connection.host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: connection.selected.id, networkId: 'ethereum', approval: connection.approval, request: { method: 'personal_sign', address: connection.selected.address, message: 'Missing key' } }, null), { code: 'OPERATION_FAILED' });
    } else {
      operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined, null);
      await operation.prepare(); await operation.authorize(operation.getSnapshot().revision);
      assert.equal(operation.getSnapshot().phase, 'failed'); assert.equal(operation.getSnapshot().payerReview, null);
    }
    assert.deepEqual(backend.actions, []); assert.equal(f.submitted.length, 0); assert.equal(f.signatures.length, 0);
  } finally { connection?.approval.dispose(); operation?.dispose(); await f.close(); }
});


for (const retirement of ['revoke-before', 'network-before', 'lock-before', 'revoke-after-dispatch'] as const) test(`actual SLH Smart message preserves original approval lifetime (${retirement})`, async () => {
  const backend = slhSmartBackend();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let armed = false, signerWrite = false;
  const f = await fixture({ before: async (kind, sql) => {
    if (armed && kind === 'run' && /^(?:INSERT INTO|UPDATE) keyring_records /.test(sql)) signerWrite = true;
    if (armed && signerWrite && kind === 'exec' && sql === 'COMMIT') { armed = false; entered.resolve(); await release.promise; }
  } }, true, backend.capability);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    const key = await provisionSlhSmart(f);
    connection = await smartMessageApproval(f);
    const request: DappMessageRequest = { method: 'personal_sign', address: connection.selected.address, message: 'Original SLH consent' };
    if (retirement === 'revoke-before') connection.revoke();
    if (retirement === 'network-before') await f.selectNetwork('syscoin-nevm');
    if (retirement === 'lock-before') f.owner.lock();
    if (retirement === 'revoke-after-dispatch') armed = true;
    const work = Promise.resolve().then(() => connection!.host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: connection!.selected.id, networkId: 'ethereum', approval: connection!.approval, request }, null));
    const rejected = assert.rejects(work);
    if (retirement === 'revoke-after-dispatch') {
      await entered.promise; connection.revoke(); release.resolve();
    }
    await rejected;
    assert.equal(backend.actions.length, retirement === 'revoke-after-dispatch' ? 1 : 0);
    assert.equal(f.submitted.length, 0); assert.equal(f.signatures.length, 0);
    if (retirement === 'revoke-after-dispatch') {
      await f.reopen();
      await f.owner.unlock();
      const account = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
      assert.equal((await account.hydrateInstalled(key.keyId)).signatureCount, 1);
    }
  } finally { release.resolve(); connection?.approval.dispose(); await f.close(); }
});


test('actual Smart credential recovery preserves SLH encrypted high-water state and signing without rederivation', async () => {
  const backend = slhSmartBackend(), f = await fixture({}, true, backend.capability);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    const key = await provisionSlhSmart(f);
    connection = await smartMessageApproval(f);
    await connection.host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: connection.selected.id, networkId: 'ethereum', approval: connection.approval,
      request: { method: 'personal_sign', address: connection.selected.address, message: 'Before password reset' } }, null);
    const before = await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(key.keyId));
    await f.restoreCredential();
    assert.deepEqual(await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(key.keyId)), before);
    const facade = await f.runtime.openSlhDsaAccount(() => undefined, new AbortController().signal, null);
    assert.equal((await facade.hydrateInstalled(key.keyId)).signatureCount, 1);
    assert.deepEqual(f.slhDerivations, [0]);
    connection.approval.dispose(); connection = await smartMessageApproval(f);
    await connection.host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: connection.selected.id, networkId: 'ethereum', approval: connection.approval,
      request: { method: 'personal_sign', address: connection.selected.address, message: 'After password reset' } }, null);
    assert.equal((await facade.hydrateInstalled(key.keyId)).signatureCount, 2);
    assert.equal(backend.actions.length, 2); assert.equal(f.submitted.length, 0);
  } finally { connection?.approval.dispose(); await f.close(); }
});

test('actual Smart password reset authenticates retained SLH ciphertext before any replacement', async () => {
  const backend = slhSmartBackend(), f = await fixture({}, true, backend.capability);
  try {
    const key = await provisionSlhSmart(f), storageKey = getSLHDSAStateStorageKey(key.keyId);
    const saved = await f.storage.keyringStorage.get(storageKey) as { version: number; keyId: string; updatedAt: number; cipherText: string };
    const inner = JSON.parse(saved.cipherText) as { ciphertext: string };
    inner.ciphertext = (inner.ciphertext[0] === 'A' ? 'B' : 'A') + inner.ciphertext.slice(1);
    await f.storage.keyringStorage.set(storageKey, { ...saved, cipherText: JSON.stringify(inner) });
    const before = await f.storage.recovery.readSnapshot();
    await assert.rejects(f.restoreCredential(), { code: 'INVALID_SAVED_DATA' });
    await f.reopen();
    assert.deepEqual(await f.storage.recovery.readSnapshot(), before);
    assert.deepEqual(f.slhDerivations, [0]); assert.deepEqual(backend.actions, []); assert.equal(f.submitted.length, 0);
  } finally { await f.close(); }
});

async function readyLedgerSmartOwner(count = 1) {
  const device = nativeSmartLedgerDevice();
  const f = await fixture({}, true, null, device.factory);
  const picker = new NativeLedgerAccounts(f.owner, () => f.runtime.ledger, 'import');
  try {
    for (let index = 0; index < count; index++) {
      await picker.start(); await picker.select(picker.getSnapshot().devices[0]!.id); await picker.importAccount(`Ledger owner ${index}`);
    }
    await f.change({kind: 'create-smart', label: 'Ledger Smart account',});
    f.guardianStatus('no-policy'); f.fundedSmart(); f.observedEcdsaOwners(device.wallets.slice(0, count).map(wallet => wallet.address), count);
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    const connection = new NativeLedgerAccounts(f.owner, () => f.runtime.ledger, 'connect');
    return {f, device, connection, async close() {await connection.dispose(); await picker.dispose(); await f.close();}};
  } catch(error) {await picker.dispose(); await f.close(); throw error;}
}
async function connectLedgerSmart(f: Awaited<ReturnType<typeof readyLedgerSmartOwner>>) {
  await f.connection.start(); await f.connection.select(f.connection.getSnapshot().devices[0]!.id); await f.connection.finishConnection();
}

test('Ledger Smart owner connection verifies every planned key while preserving selected Smart account and consent', async () => {
  const owned = await readyLedgerSmartOwner(2), {f, device} = owned;
  try {
    const catalogue = f.owner.getCatalogue(), active = catalogue!.active.accountId;
    assert.equal(f.runtime.canSignSmartAccount(), true, 'disconnected capability permits entering its connection review');
    assert.deepEqual(f.runtime.ledger.getConnectionTargets(), ['ledger:60:0', 'ledger:60:1']);
    assert.equal(owned.connection.isConnected(), false);
    const before = device.addressReads.length;
    await connectLedgerSmart(owned);
    assert.deepEqual(device.addressReads.slice(before), [0, 1]);
    assert.equal(f.owner.getCatalogue(), catalogue);
    assert.equal(f.owner.getCatalogue()!.active.accountId, active);
    assert.equal(device.signatures.length, 0, 'connecting never authorizes or signs');
    const operation = await f.runtime.openSmartAccountSend('0x' + '55'.repeat(20), {kind: 'exact', amount: '0.000001'}, () => undefined, null);
    try {
      await operation.prepare(); assert.equal(operation.getSnapshot().phase, 'authorize');
      const pending = operation.authorize(operation.getSnapshot().revision);
      for (let i=0; i<300 && !['complete', 'failed'].includes(operation.getSnapshot().phase); i++) {
        const review = operation.getSnapshot().payerReview; if (review) operation.confirmPayer(review.id);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      await pending;
      assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
      assert.deepEqual(device.signatures.map(entry => entry.index), [0, 1]);
      assert(device.signatures.every(entry => entry.digest === operation.getSnapshot().userOperationHash));
      assert.equal(f.owner.getCatalogue()!.active.accountId, active);
      assert(f.submitted.length > 0);
    } finally {await operation.dispose();}
  } finally {await owned.close();}
});

test('Ledger Smart owner connection rejects a mismatched later owner before any signing or funding', async () => {
  const owned = await readyLedgerSmartOwner(2), {f, device} = owned;
  try {
    const active = f.owner.getCatalogue()!.active.accountId;
    device.wrongKey(1);
    await owned.connection.start();
    await assert.rejects(owned.connection.select(owned.connection.getSnapshot().devices[0]!.id));
    assert.equal(owned.connection.isConnected(), false);
    assert.match(owned.connection.getSnapshot().error!, /every required owner/);
    assert.equal(device.signatures.length, 0); assert.equal(f.submitted.length, 0);
    assert.equal(f.owner.getCatalogue()!.active.accountId, active);
  } finally {await owned.close();}
});

test('Ledger Smart owner cannot sign before verified connection and an incompatible proof cannot prefund', async () => {
  const owned = await readyLedgerSmartOwner(), {f, device} = owned;
  try {
    const blocked = await f.runtime.openSmartAccountSend('0x' + '55'.repeat(20), {kind: 'exact', amount: '0.000001'}, () => undefined, null);
    try {await blocked.prepare(); await blocked.authorize(blocked.getSnapshot().revision); assert.equal(blocked.getSnapshot().phase, 'failed');}
    finally {await blocked.dispose();}
    assert.equal(device.signatures.length, 0); assert.equal(f.submitted.length, 0);
    await connectLedgerSmart(owned); device.wrongProof(); f.smartBalance(10n ** 12n);
    const operation = await f.runtime.openSmartAccountSend('0x' + '55'.repeat(20), {kind: 'exact', amount: '0.000001'}, () => undefined, null);
    try {await operation.prepare(); await operation.authorize(operation.getSnapshot().revision); assert.equal(operation.getSnapshot().phase, 'failed');}
    finally {await operation.dispose();}
    assert.equal(f.submitted.length, 0, 'wrong owner digest is rejected before prefunding or any wire POST');
  } finally {await owned.close();}
});

test('Ledger Smart owner dapp personal and V4 signing uses exact typed intents without selecting the owner account', async () => {
  const owned = await readyLedgerSmartOwner(), {f, device} = owned;
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    await connectLedgerSmart(owned); connection = await smartMessageApproval(f);
    const selected = connection.selected;
    const requests = [readDappMessageRequest('personal_sign', ['Ledger Smart message', selected.address], selected.address)!,
      readDappMessageRequest('eth_signTypedData_v4', [selected.address, {types: {EIP712Domain: [], Message: [{name:'text',type:'string'}]}, primaryType:'Message', domain:{}, message:{text:'Ledger Smart typed'}}], selected.address)!];
    for(const request of requests) {
      const prepared = prepareSmartAccountMessage({accountAddress:selected.address,chainId:1,request});
      const signature = await connection.host.signMessage({ handoff: nonSuiteSigningHandoff,accountId:selected.id, networkId:connection.host.context().networkId, request, approval:connection.approval}, null);
      assert.match(signature, /^0x[0-9a-f]+$/i);
      assert.equal(device.signatures.at(-1)!.digest, prepared.actionHash);
      assert.equal(f.owner.getCatalogue()!.active.accountId, selected.id);
    }
    assert.equal(f.submitted.length, 0);
  } finally {connection?.approval.dispose(); await owned.close();}
});

for (const boundary of ['Back', 'lock', 'account', 'network'] as const) test(`Ledger Smart owner held connection retires on ${boundary} without adopting a device or changing consent`, async () => {
  const owned = await readyLedgerSmartOwner(), {f, device} = owned;
  let release!: () => void, enter!: () => void;
  const entered = new Promise<void>(resolve => {enter = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  try {
    device.holdAddress(async () => {enter(); await held;});
    await owned.connection.start();
    const selecting = owned.connection.select(owned.connection.getSnapshot().devices[0]!.id);
    const refused = assert.rejects(selecting);
    await entered;
    if (boundary === 'Back') await owned.connection.close();
    if (boundary === 'lock') f.owner.lock();
    if (boundary === 'account') await f.change({kind: 'select', id: 'hd:60:0'});
    if (boundary === 'network') await f.selectNetwork('syscoin-nevm');
    release(); await refused;
    assert.equal(owned.connection.isConnected(), false);
    assert.equal(device.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally {release(); await owned.close();}
});

for (const boundary of ['grant revocation', 'wallet lock'] as const) test(`Ledger Smart owner held dapp proof is withheld after ${boundary}`, async () => {
  const owned = await readyLedgerSmartOwner(), {f, device} = owned;
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  let release!: () => void, enter!: () => void;
  const entered = new Promise<void>(resolve => {enter = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  try {
    await connectLedgerSmart(owned); connection = await smartMessageApproval(f);
    device.holdSignature(async () => {enter(); await held;});
    const request = readDappMessageRequest('personal_sign', ['Held Ledger proof', connection.selected.address], connection.selected.address)!;
    const signing = connection.host.signMessage({ handoff: nonSuiteSigningHandoff,accountId:connection.selected.id, networkId:connection.host.context().networkId, request, approval:connection.approval}, null);
    const rejected = assert.rejects(signing);
    await entered;
    if (boundary === 'wallet lock') f.owner.lock(); else connection.revoke();
    release(); await rejected;
    assert.equal(device.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally {release(); connection?.approval.dispose(); await owned.close();}
});

for (const mutation of ['Ledger public key', 'Smart policy'] as const) test(`Ledger Smart owner connection loses readiness after in-place ${mutation} changes`, async () => {
  const owned = await readyLedgerSmartOwner(), {f} = owned;
  try {
    await connectLedgerSmart(owned); assert(owned.connection.isConnected());
    if (mutation === 'Ledger public key') f.mutateLedgerOwner(0, account => {account.xpub = '0x' + '99'.repeat(65);});
    else f.mutateSelectedSmart(account => {account.smartAccount!.auth!.data = encodeEcdsaValidatorInitData([owned.device.wallets[0]!.address], 2);});
    assert.equal(owned.connection.isConnected(), false);
    assert.equal(owned.device.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally {await owned.close();}
});


async function readyTrezorSmartOwner(slhFactory: NativeSlhExecutionCapability | null = null, count: 1 | 2 = 1, passkeys: KeyringRuntimeDependencies['passkeys'] = null) {
  const device = nativeSmartTrezorDevice(), f = await fixture({}, true, slhFactory, undefined, device.sessions, passkeys);
  try {
    for(let index=0;index<count;index++){
      await f.runtime.trezor.startImport(`Trezor owner ${index+1}`);
      await f.change({kind:'import-trezor',label:`Trezor owner ${index+1}`});
    }
    await f.change({kind:'create-smart',label:'Trezor Smart account',});
    f.guardianStatus('no-policy'); f.fundedSmart(); f.observedEcdsaOwners(device.wallets.slice(0,count).map(wallet=>wallet.address).reverse(),count);
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal,()=>undefined);
    return {f,device,async close(){await f.close();await device.dispose();}};
  } catch(error) {await f.close();await device.dispose();throw error;}
}

async function readyLedgerTrezorSmartOwners(ledgerFirst: boolean) {
  const ledger=nativeSmartLedgerDevice(),trezor=nativeSmartTrezorDevice();
  // Give the semantic Ledger a different seed at logical account 0; the
  // stock fixtures otherwise return the same keys and correctly refuse import.
  const ledgerFactory: NonNullable<KeyringRuntimeDependencies['createLedgerTransport']> = async owner => {
    const transport=await ledger.factory(owner), evm=transport.host.evm;
    return {...transport,host:{...transport.host,evm:{...evm,
      getAddress: request=>evm.getAddress({...request,accountIndex:request.accountIndex+1}),
      signTypedData: (request,authority)=>evm.signTypedData({...request,accountIndex:request.accountIndex+1},authority),
    }}};
  };
  const f=await fixture({},true,null,ledgerFactory,trezor.sessions);
  const picker=new NativeLedgerAccounts(f.owner,()=>f.runtime.ledger,'import');
  let connection: NativeLedgerAccounts<'connect'> | undefined;
  const close=async()=>{await connection?.dispose();await picker.dispose();await f.close();await trezor.dispose();};
  try{
    await picker.start();await picker.select(picker.getSnapshot().devices[0]!.id);await picker.importAccount('Ledger owner');
    await picker.dispose();
    const saved = (await f.inspectRecovery()).record as { groups: { accounts: { Ledger: Record<string, { xpub: string }> } }[] };
    assert.equal(saved.groups.flatMap(group => Object.values(group.accounts.Ledger))[0]!.xpub, ledger.wallets[1]!.signingKey.publicKey.slice(2), 'exercise the actual SDK bare-SEC storage form');
    await f.runtime.trezor.startImport('Trezor owner');
    await f.change({kind:'import-trezor',label:'Trezor owner'});
    await f.change({kind:'create-smart',label:'Mixed hardware Smart account'});f.guardianStatus('no-policy');f.fundedSmart();
    // Both catalogue indices are zero, but the two physical-device fixtures
    // now have distinct public keys.
    const owners=ledgerFirst?[ledger.wallets[1]!.address,trezor.wallets[0]!.address]:[trezor.wallets[0]!.address,ledger.wallets[1]!.address];
    f.observedEcdsaOwners(owners,2);await f.runtime.refreshSmartAccountMetadata(new AbortController().signal,()=>undefined);
    const connect=async()=>{
      await connection?.dispose();connection=new NativeLedgerAccounts(f.owner,()=>f.runtime.ledger,'connect');
      await connection.start();await connection.select(connection.getSnapshot().devices[0]!.id);await connection.finishConnection();
    };
    await connect();return {f,ledger,trezor,owners,connect,close};
  }catch(error){await close();throw error;}
}
for(const ledgerFirst of [false,true]) test(`Ledger and Trezor Smart owners follow the shared order (Ledger first ${ledgerFirst})`,async()=>{
  const {f,ledger,trezor,owners,close}=await readyLedgerTrezorSmartOwners(ledgerFirst);
  let connection:Awaited<ReturnType<typeof smartMessageApproval>>|undefined,continuation:ReturnType<typeof ownedSmartSdkHandoff>|undefined;
  try{
    connection=await smartMessageApproval(f);continuation=ownedSmartSdkHandoff(connection,'mixed-hardware-order',Date.now()+120000,'personal_sign');
    const request:DappMessageRequest={method:'personal_sign',address:connection.selected.address,message:'Two hardware owners'};
    const prepared=prepareSmartAccountMessage({accountAddress:connection.selected.address,chainId:1,request});
    const result=await connection.host.signMessage({handoff:continuation.handoff,accountId:connection.selected.id,networkId:'ethereum',request,approval:connection.approval},null);
    const proofs=owners.map(owner=>owner===ledger.wallets[1]!.address?ledger.wallets[1]!.signingKey.sign(prepared.actionHash).serialized:trezor.signatures[0]!.signature);
    assert.equal(result,encodeSmartAccountMessageSignature(prepared,{validator:getConfiguredAuthenticatorAddress(1,'ecdsa'),signature:coder.encode(['bytes[]'],[proofs])}));
    assert.equal(ledger.signatures.length,1);assert.equal(ledger.signatures[0]!.digest,prepared.actionHash);
    assert.equal(trezor.signatures.length,1);assert.equal(trezor.signatures[0]!.index,0);assert.equal(f.submitted.length,0);
    continuation.terminal();
  }finally{await continuation?.dispose();connection?.approval.dispose();await close();}
});
for(const ledgerFirst of [false,true]) test(`Ledger and Trezor Smart owners resume after unlock and Ledger reconnect (Ledger first ${ledgerFirst})`,async()=>{
  const {f,ledger,trezor,connect,close}=await readyLedgerTrezorSmartOwners(ledgerFirst),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  let connection:Awaited<ReturnType<typeof smartMessageApproval>>|undefined,continuation:ReturnType<typeof ownedSmartSdkHandoff>|undefined;
  try{
    connection=await smartMessageApproval(f);continuation=ownedSmartSdkHandoff(connection,'mixed-hardware-resume',Date.now()+120000,'personal_sign');
    const request:DappMessageRequest={method:'personal_sign',address:connection.selected.address,message:'Resume two hardware owners'};
    trezor.onBeforeCallback(async request=>{if(request.method==='ethereumSignTypedData'){entered.resolve();await release.promise;}});
    const signing=connection.host.signMessage({handoff:continuation.handoff,accountId:connection.selected.id,networkId:'ethereum',request,approval:connection.approval},null);
    const rejected=assert.rejects(signing);await Promise.race([entered.promise,signing.then(()=>{throw Error('Expected Suite departure');})]);
    assert.equal(ledger.signatures.length,ledgerFirst?1:0);
    continuation.suspend();f.owner.lock();await rejected;release.resolve();await new Promise(resolve=>setImmediate(resolve));
    connection.approval.dispose();await f.owner.unlock();await connect();connection=await smartMessageApproval(f);
    await f.runtime.trezor.resumeSend();const handoff=continuation.resume(connection);
    await connection.host.signMessage({handoff,accountId:connection.selected.id,networkId:'ethereum',request,approval:connection.approval},null);
    assert.equal(ledger.signatures.length,1,'an admitted Ledger proof is reused instead of signing twice');
    assert.equal(trezor.signatures.length,1);assert.equal(trezor.signatures[0]!.index,0);assert.equal(f.submitted.length,0);
    continuation.terminal();
  }finally{release.resolve();await continuation?.dispose();connection?.approval.dispose();await close();}
});

const mixedPasskeyProof = encodePasskeyWebAuthnProof({authenticatorData:'0x'+'01'.repeat(37),clientDataJSON:'0x'+'02'.repeat(128),
  typeOffset:1,challengeOffset:2,originOffset:3,r:'0x'+'03'.repeat(32),s:'0x'+'04'.repeat(32)});
async function mixedTrezorPasskeyFixture(ecdsaFirst: boolean) {
  let f!: Awaited<ReturnType<typeof fixture>>, calls=0, prompt=false;
  const scope=createNativePrivateAuthenticationScope();
  const binding=bindNativePrivateAuthentication(scope,{assertCurrent(){},isPromptActive:()=>prompt});
  const capability: NonNullable<KeyringRuntimeDependencies['passkeys']>={
    async create(){throw Error('No new credential during signing');},async recover(){throw Error('No discovery during signing');},
    async sign(request){prompt=true;try{request.assertCurrent();f.assertNoSigningKeys();calls++;return {signature:mixedPasskeyProof};}finally{prompt=false;}},
  };
  const owned=await readyTrezorSmartOwner(null,2,capability);f=owned.f;
  f.observedComposite(2,ecdsaFirst);await f.runtime.refreshSmartAccountMetadata(new AbortController().signal,()=>undefined);
  return {...owned,binding,scope,calls:()=>calls};
}
for(const ecdsaFirst of [false,true]) test(`native P256 and Trezor Smart message shares the exact ordered plan (ECDSA first ${ecdsaFirst})`,async()=>{
  const {f,device,close,binding,scope,calls}=await mixedTrezorPasskeyFixture(ecdsaFirst);
  let connection:Awaited<ReturnType<typeof smartMessageApproval>>|undefined,continuation:ReturnType<typeof ownedSmartSdkHandoff>|undefined;
  try{
    connection=await smartMessageApproval(f);continuation=ownedSmartSdkHandoff(connection,'mixed-message',Date.now()+120000,'personal_sign');
    const request:DappMessageRequest={method:'personal_sign',address:connection.selected.address,message:'Mixed passkey and Trezor'};
    const result=await connection.host.signMessage({handoff:continuation.handoff,accountId:connection.selected.id,networkId:'ethereum',request,approval:connection.approval},binding);
    const prepared=prepareSmartAccountMessage({accountAddress:connection.selected.address,chainId:1,request});
    const ecdsa=coder.encode(['bytes[]'],[device.signatures.map(entry=>entry.signature)]);
    assert.equal(result,encodeSmartAccountMessageSignature(prepared,{validator:getConfiguredAuthenticatorAddress(1,'composite'),signature:coder.encode(['bytes[]'],[ecdsaFirst?[ecdsa,mixedPasskeyProof]:[mixedPasskeyProof,ecdsa]])}));
    assert.equal(calls(),1);assert.deepEqual(device.signatures.map(entry=>entry.index),[0,1]);f.assertNoSigningKeys();continuation.terminal();
  }finally{scope.retire();await continuation?.dispose();connection?.approval.dispose();await close();}
});
for(const ecdsaFirst of [false,true]) test(`mixed P256 Trezor continuation survives Suite departure without repeating passkey (ECDSA first ${ecdsaFirst})`,async()=>{
  const {f,device,close,binding,scope,calls}=await mixedTrezorPasskeyFixture(ecdsaFirst),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  let connection:Awaited<ReturnType<typeof smartMessageApproval>>|undefined,continuation:ReturnType<typeof ownedSmartSdkHandoff>|undefined;
  try{
    connection=await smartMessageApproval(f);continuation=ownedSmartSdkHandoff(connection,'mixed-resume',Date.now()+120000,'personal_sign');
    device.onBeforeCallback(async request=>{if(request.method==='ethereumSignTypedData'&&device.signatures.length===2){entered.resolve();await release.promise;}});
    const request:DappMessageRequest={method:'personal_sign',address:connection.selected.address,message:'Resume mixed proof'};
    const signing=connection.host.signMessage({handoff:continuation.handoff,accountId:connection.selected.id,networkId:'ethereum',request,approval:connection.approval},binding);
    const rejected=assert.rejects(signing);await Promise.race([entered.promise,signing.then(()=>{throw Error('Expected Suite departure');})]);
    continuation.suspend();f.owner.lock();await rejected;release.resolve();await new Promise(resolve=>setImmediate(resolve));
    connection.approval.dispose();await f.owner.unlock();connection=await smartMessageApproval(f);
    await f.runtime.trezor.resumeSend();const handoff=continuation.resume(connection);
    await connection.host.signMessage({handoff,accountId:connection.selected.id,networkId:'ethereum',request,approval:connection.approval},binding);
    assert.equal(calls(),1);assert.equal(device.signatures.length,2);f.assertNoSigningKeys();continuation.terminal();
  }finally{release.resolve();scope.retire();await continuation?.dispose();connection?.approval.dispose();await close();}
});
for(const ecdsaFirst of [false,true]) test(`mixed P256 Trezor UserOperation reaches separate payer consent (ECDSA first ${ecdsaFirst})`,async()=>{
  const {f,device,close,binding,scope,calls}=await mixedTrezorPasskeyFixture(ecdsaFirst);let operation:NativeSmartAccountOperation|undefined;
  try{
    operation=await f.runtime.openSmartAccountSend('0x'+'55'.repeat(20),{kind:'exact',amount:'0.000001'},()=>undefined,binding);
    await operation.prepare();assert.equal(operation.getSnapshot().phase,'authorize');const signing=operation.authorize(operation.getSnapshot().revision);
    for(let i=0;i<3000&&!operation.getSnapshot().payerReview&&!['failed','complete'].includes(operation.getSnapshot().phase);i++)await new Promise(resolve=>setTimeout(resolve,5));
    const review=operation.getSnapshot().payerReview;assert(review,JSON.stringify(operation.getSnapshot()));
    assert.equal(calls(),1);assert.equal(device.signatures.length,2);assert.equal(f.submitted.length,0);
    operation.cancel();await signing;f.assertNoSigningKeys();
  }finally{scope.retire();await operation?.dispose();await close();}
});

test('multiple native Trezor owners sign in the exact shared threshold order through separate terminal jobs',async()=>{
  const {f,device,close}=await readyTrezorSmartOwner(null,2);
  let connection:Awaited<ReturnType<typeof smartMessageApproval>>|undefined,continuation:ReturnType<typeof ownedSmartSdkHandoff>|undefined;
  try{
    connection=await smartMessageApproval(f);
    continuation=ownedSmartSdkHandoff(connection,'two-smart-owners',Date.now()+120000,'personal_sign');
    const selected=f.owner.getCatalogue()!.active.accountId;
    const request:DappMessageRequest={method:'personal_sign',address:connection.selected.address,message:'Both reviewed Trezor owners'};
    const prepared=prepareSmartAccountMessage({accountAddress:connection.selected.address,chainId:1,request});
    const result=await connection.host.signMessage({handoff:continuation.handoff,accountId:selected,networkId:'ethereum',request,approval:connection.approval}, null);
    assert.deepEqual(device.signatures.map(value=>value.index),[1,0]);
    for(const entry of device.signatures)assert.equal(recoverAddress(prepared.actionHash,entry.signature).toLowerCase(),device.wallets[entry.index]!.address.toLowerCase());
    assert.equal(result,encodeSmartAccountMessageSignature(prepared,{validator:getConfiguredAuthenticatorAddress(1,'ecdsa'),signature:coder.encode(['bytes[]'],[device.signatures.map(entry=>entry.signature)])}));
    continuation.terminal();assert.equal(device.sessions.getSnapshot(),null);
    assert.equal(f.owner.getCatalogue()!.active.accountId,selected);assert.equal(f.submitted.length,0);
    assert(device.counts().disposals>=2);
  }finally{await continuation?.dispose();connection?.approval.dispose();await close();}
});

test('two native Trezor owner proofs complete before the existing local UserOperation payer review',async()=>{
  const {f,device,close}=await readyTrezorSmartOwner(null,2);let operation:NativeSmartAccountOperation|undefined;
  try{
    const selected=f.owner.getCatalogue()!.active.accountId;
    operation=await f.runtime.openSmartAccountSend('0x'+'55'.repeat(20),{kind:'exact',amount:'0.000001'},()=>undefined, null);
    await operation.prepare();assert.equal(operation.getSnapshot().phase,'authorize');
    assert.equal(device.signatures.length,0);assert.equal(operation.getSnapshot().payerReview,null);
    const signing=operation.authorize(operation.getSnapshot().revision);
    for(let attempt=0;attempt<3000&&!operation.getSnapshot().payerReview&&!['failed','complete'].includes(operation.getSnapshot().phase);attempt++)await new Promise(resolve=>setTimeout(resolve,5));
    const review=operation.getSnapshot().payerReview;assert(review,JSON.stringify(operation.getSnapshot()));
    assert.deepEqual(device.signatures.map(value=>value.index),[1,0]);
    for(const entry of device.signatures)assert.equal(recoverAddress(operation.getSnapshot().userOperationHash!,entry.signature).toLowerCase(),device.wallets[entry.index]!.address.toLowerCase());
    assert.equal(f.submitted.length,0);assert.equal(device.sessions.getSnapshot(),null);
    operation.confirmPayer(review.id);await signing;
    assert.equal(operation.getSnapshot().phase,'complete',JSON.stringify(operation.getSnapshot()));
    assert.equal(f.submitted.length,1);assert.equal(f.owner.getCatalogue()!.active.accountId,selected);
  }finally{await operation?.dispose();await close();}
});

for(const change of ['none','message','policy'] as const)test(`partial native Trezor owner proofs resume only their exact approved operation (${change})`,async()=>{
  const {f,device,close}=await readyTrezorSmartOwner(null,2),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  let connection:Awaited<ReturnType<typeof smartMessageApproval>>|undefined,continuation:ReturnType<typeof ownedSmartSdkHandoff>|undefined;
  try{
    connection=await smartMessageApproval(f);
    continuation=ownedSmartSdkHandoff(connection,'partial-two-owners',Date.now()+120000,'personal_sign');
    device.onBeforeCallback(async request=>{if(request.method==='ethereumSignTypedData'&&device.signatures.length===2){entered.resolve();await release.promise;}});
    const request:DappMessageRequest={method:'personal_sign',address:connection.selected.address,message:'Approved by each device'};
    const signing=connection.host.signMessage({handoff:continuation.handoff,accountId:connection.selected.id,networkId:'ethereum',request,approval:connection.approval}, null);
    const rejected=assert.rejects(signing);
    await Promise.race([entered.promise,signing.then(()=>{throw Error('Expected the second owner callback');})]);
    assert.deepEqual(device.signatures.map(value=>value.index),[1,0]);
    const signer=f.runtime.trezor.getSnapshot().signer;
    assert(signer);assert.equal(signer.step,2);assert.equal(signer.total,2);assert.equal(signer.address,device.wallets[0]!.address);
    continuation.suspend();f.owner.lock();await rejected;
    release.resolve();await new Promise(resolve=>setImmediate(resolve));
    connection.approval.dispose();await f.owner.unlock();connection=await smartMessageApproval(f);
    const resume=await f.runtime.trezor.resumeSend();assert.equal(resume.kind,'external-signing');
    const handoff=continuation.resume(connection),opened=device.urls.length;
    if(change==='policy')f.observedEcdsaOwners(device.wallets.map(wallet=>wallet.address),2);
    const work=connection.host.signMessage({handoff,accountId:connection.selected.id,networkId:'ethereum',approval:connection.approval,
      request:change==='message'?{...request,message:'Different unapproved operation'}:request}, null);
    if(change==='none'){
      const result=await work,prepared=prepareSmartAccountMessage({accountAddress:connection.selected.address,chainId:1,request});
      assert.equal(result,encodeSmartAccountMessageSignature(prepared,{validator:getConfiguredAuthenticatorAddress(1,'ecdsa'),signature:coder.encode(['bytes[]'],[device.signatures.map(value=>value.signature)])}));
      continuation.terminal();
    }else{await assert.rejects(work);await continuation.retired();assert(continuation.canceled.length>0);}
    assert.equal(device.signatures.length,2,'completed proofs and the retained callback cannot cause another device signature');
    assert.equal(device.urls.length,opened);assert.equal(f.submitted.length,0);assert.equal(device.sessions.getSnapshot(),null);
    assert.equal(f.runtime.trezor.getSnapshot().signer,null);
  }finally{release.resolve();await continuation?.dispose();connection?.approval.dispose();await close();}
});


for (const ownerKind of ['software', 'external'] as const)
  test(`an unrelated saved Trezor account does not own the ${ownerKind} Smart operation lifecycle`, async () => {
    const { f, device, close } = await readyTrezorSmartOwner();
    let operation: NativeSmartAccountOperation | undefined;
    try {
      const owner = ownerKind === 'software'
        ? f.owner.getCatalogue()!.accounts.find(account => account.type === 'HDAccount')!.address
        : '0x' + '66'.repeat(20);
      f.observedEcdsaOwners([owner], 1);
      await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
      f.deployed(); f.fundedSmart();
      operation = await f.runtime.openSmartAccountSend('0x' + '44'.repeat(20), { kind: 'exact', amount: '0.001' }, () => undefined, null);
      await operation.prepare();
      assert.equal(operation.getSnapshot().phase, 'authorize');
      const signing = operation.authorize(operation.getSnapshot().revision);
      if (ownerKind === 'software') {
        for (let attempt = 0; attempt < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; attempt++)
          await new Promise(resolve => setTimeout(resolve, 5));
        const review = operation.getSnapshot().payerReview;
        assert(review);
        f.owner.lock();
        operation.confirmPayer(review.id);
      }
      await signing;
      assert.equal(operation.getSnapshot().phase, 'failed');
      assert.equal(device.signatures.length, 0);
      assert.equal(f.submitted.length, 0);
      await assert.rejects(f.runtime.trezor.resumeSend());
    } finally { await operation?.dispose(); await close(); }
  });

test('native Smart Trezor dapp typed signing preserves selected Smart and the original journal capability', async () => {
  const {f,device,close} = await readyTrezorSmartOwner();
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  let continuation: ReturnType<typeof ownedSmartSdkHandoff> | undefined;
  try {
    connection = await smartMessageApproval(f);
    const selected = f.owner.getCatalogue()!.active.accountId, journal = await f.captureOriginalJournal();
    const host = connection.host, signing = host.signingContext(selected);
    assert.equal(signing.trezor,true); assert.equal(host.supportsSmartAccountMessages(selected),true);
    continuation=ownedSmartSdkHandoff(connection,'fresh-smart-dapp',Date.now()+60000,'personal_sign');
    const handoff=continuation.handoff;
    const request = readDappMessageRequest('personal_sign',['0x6162',connection.selected.address],connection.selected.address)!;
    const signature=await host.signMessage({handoff,accountId:selected,networkId:'ethereum',request,approval:connection.approval}, null);
    assert.match(signature,/^0x[0-9a-f]+$/i); continuation.terminal(); assert.equal(device.signatures.length,1);
    assert.equal(f.owner.getCatalogue()!.active.accountId,selected); assert.equal(host.context().activeAccountId,selected);
    assert.deepEqual(await journal.read(true),[]); assert.equal(f.submitted.length,0);
    assert.equal(device.sessions.getSnapshot(),null); assert(device.counts().disposals>0);
  } finally {await continuation?.dispose();connection?.approval.dispose();await close();}
});

test('native Smart Trezor UserOperation keeps original expiry and requires payer consent after verified proof', async () => {
  const {f,device,close} = await readyTrezorSmartOwner();
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined, operation: NativeSmartAccountOperation | undefined;
  let continuation: ReturnType<typeof ownedSmartSdkHandoff> | undefined;
  try {
    connection=await smartMessageApproval(f); const selected=f.owner.getCatalogue()!.active.accountId, journal=await f.captureOriginalJournal();
    const deadline=Date.now()+60000;
    continuation=ownedSmartSdkHandoff(connection,'fresh-smart-uo',deadline,'eth_sendTransaction');
    const handoff=continuation.handoff;
    const result=await connection.host.prepareTransaction({handoff,accountId:selected,networkId:'ethereum',transaction:{from:connection.selected.address,to:'0x'+'55'.repeat(20),value:'0x1',data:'0x'},approval:connection.approval},connection.approval.assertCurrent, null);
    assert('operation' in result); operation=result.operation;
    await operation.prepare(); assert.equal(operation.getSnapshot().phase,'authorize'); assert(operation.authorizationExpiresAt<=deadline);
    const signing=operation.authorize(operation.getSnapshot().revision);
    for(let i=0;i<1000&&operation.getSnapshot().phase!=='review-fee'&&!['failed','complete'].includes(operation.getSnapshot().phase);i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(operation.getSnapshot().phase,'review-fee'); continuation.terminal(); assert.equal(device.signatures.length,1); assert.equal(f.submitted.length,0);
    assert.equal(f.owner.getCatalogue()!.active.accountId,selected); assert.deepEqual(await journal.read(true),[]);
    operation.confirmPayer(operation.getSnapshot().payerReview!.id); await signing;
    assert.equal(operation.getSnapshot().phase,'complete'); assert.equal(f.submitted.length,1); assert((await journal.read(true)).length>0);
    assert.equal(device.sessions.getSnapshot(),null);
  } finally {await operation?.dispose();await continuation?.dispose();connection?.approval.dispose();await close();}
});

for(const failure of ['wrong key','changed policy','cancelled raw callback'] as const) test(`native Smart Trezor ${failure} cannot release a proof or prefund`,async()=>{
  const {f,device,close}=await readyTrezorSmartOwner(),entered=Promise.withResolvers<void>(),released=Promise.withResolvers<void>();
  let connection:Awaited<ReturnType<typeof smartMessageApproval>>|undefined;
  let continuation: ReturnType<typeof ownedSmartSdkHandoff> | undefined;
  try{
    connection=await smartMessageApproval(f);
    continuation=ownedSmartSdkHandoff(connection,'fresh-refusal',Date.now()+60000,'personal_sign');
    const handoff=continuation.handoff;
    if(failure==='wrong key')device.wrongKey(0);
    if(failure==='changed policy')device.onBeforeCallback(request=>{
      if(request.method==='ethereumGetPublicKey')f.mutateSelectedSmart(account=>{account.smartAccount!.auth={...account.smartAccount!.auth!,data:encodeEcdsaValidatorInitData([device.wallets[1]!.address],1)};});
    });
    if(failure==='cancelled raw callback')device.onBeforeCallback(async request=>{
      if(request.method==='ethereumSignTypedData'){entered.resolve();await released.promise;}
    });
    const request=readDappMessageRequest('personal_sign',['0x6162',connection.selected.address],connection.selected.address)!;
    const signing=connection.host.signMessage({handoff,accountId:connection.selected.id,networkId:'ethereum',request,approval:connection.approval}, null),rejected=assert.rejects(signing);
    if(failure==='cancelled raw callback'){
      await entered.promise;f.owner.lock();await new Promise(resolve=>setImmediate(resolve));
      released.resolve();
    }
    await rejected;
    assert.equal(f.submitted.length,0);assert.equal(device.sessions.getSnapshot(),null);
    assert(device.counts().disposals>0);
  }finally{released.resolve();await continuation?.dispose();connection?.approval.dispose();await close();}
});

test('native Smart Trezor return creates a fresh private message approval after unlock and replays only after separate Confirm',async()=>{
  const {f,device,close}=await readyTrezorSmartOwner(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  let connection:Awaited<ReturnType<typeof smartMessageApproval>>|undefined;
  let continuation:ReturnType<typeof ownedSmartSdkHandoff>|undefined;
  const deadline=Date.now()+120000;
  try{
    connection=await smartMessageApproval(f);const selected=connection.selected.id;
    continuation=ownedSmartSdkHandoff(connection,'original-smart-message',deadline,'personal_sign');let handoff=continuation.handoff;
    device.onBeforeCallback(async request=>{if(request.method==='ethereumSignTypedData'){entered.resolve();await release.promise;}});
    const request=readDappMessageRequest('personal_sign',['0x6162',connection.selected.address],connection.selected.address)!;
    const signing=connection.host.signMessage({handoff,accountId:selected,networkId:'ethereum',request,approval:connection.approval}, null),rejected=assert.rejects(signing);
    await entered.promise;continuation.suspend();f.owner.lock();await rejected;
    release.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(device.sessions.getSnapshot()?.phase,'response-ready');
    connection.approval.dispose();await f.owner.unlock();connection=await smartMessageApproval(f);
    const resume=await f.runtime.trezor.resumeSend();assert.equal(resume.kind,'external-signing');assert.equal(resume.accountId,selected);assert.equal(resume.id,handoff.id);
    const opened=device.urls.length;handoff=continuation.resume(connection);
    const result=await connection.host.signMessage({handoff,accountId:selected,networkId:'ethereum',request,approval:connection.approval}, null);
    assert.match(result,/^0x[0-9a-f]+$/i);continuation.terminal();assert.equal(device.urls.length,opened);assert.equal(f.owner.getCatalogue()!.active.accountId,selected);
    assert.equal(device.sessions.getSnapshot(),null);assert.equal(f.submitted.length,0);
  }finally{release.resolve();await continuation?.dispose();connection?.approval.dispose();await close();}
});


test('native Smart Trezor return after network change discards the old public transcript',async()=>{
  const {f,device,close}=await readyTrezorSmartOwner(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  let connection:Awaited<ReturnType<typeof smartMessageApproval>>|undefined;
  let continuation:ReturnType<typeof ownedSmartSdkHandoff>|undefined;
  try{
    connection=await smartMessageApproval(f);
    continuation=ownedSmartSdkHandoff(connection,'network-bound-smart-message',Date.now()+120000,'personal_sign');const handoff=continuation.handoff;
    device.onBeforeCallback(async request=>{if(request.method==='ethereumSignTypedData'){entered.resolve();await release.promise;}});
    const request=readDappMessageRequest('personal_sign',['0x6162',connection.selected.address],connection.selected.address)!;
    const signing=connection.host.signMessage({handoff,accountId:connection.selected.id,networkId:'ethereum',request,approval:connection.approval}, null),rejected=assert.rejects(signing);
    await entered.promise;continuation.suspend();f.owner.lock();await rejected;release.resolve();await new Promise(resolve=>setImmediate(resolve));
    connection.approval.dispose();await f.owner.unlock();await f.selectNetwork('base');
    await assert.rejects(f.runtime.trezor.resumeSend());assert.equal(f.submitted.length,0);assert.equal(device.sessions.getSnapshot(),null);
  }finally{release.resolve();await continuation?.dispose();connection?.approval.dispose();await close();}
});

test('local Smart Trezor wallet send resumes through a fresh operation and separate signing/payer reviews',async()=>{
  const {f,device,close}=await readyTrezorSmartOwner(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  let original:NativeSmartAccountOperation|undefined,resumed:NativeSmartAccountOperation|undefined;
  try{
    assert.equal(f.runtime.canSignSmartAccount(),true);const selected=f.owner.getCatalogue()!.active.accountId;
    device.onBeforeCallback(async request=>{if(request.method==='ethereumSignTypedData'){entered.resolve();await release.promise;}});
    original=await f.runtime.openSmartAccountSend('0x'+'55'.repeat(20),{kind:'exact',amount:'0.000001'},()=>undefined, null);
    await original.prepare();assert.equal(original.getSnapshot().phase,'authorize');
    const signing=original.authorize(original.getSnapshot().revision);await entered.promise;const suiteDeadline=device.sessions.getSnapshot()!.expiresAt;
    original.background();f.runtime.trezor.background();f.owner.lock();await signing;
    release.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(device.sessions.getSnapshot()?.phase,'response-ready');
    await f.owner.unlock();const draft=await f.runtime.trezor.resumeSend();assert.equal(draft.kind,'smart-operation');assert.equal(draft.accountId,selected);
    resumed=await f.runtime.resumeSmartAccountOperation(draft.id,new AbortController().signal,()=>undefined, null);assert.notEqual(resumed,original);
    await resumed.prepare();assert.equal(resumed.getSnapshot().phase,'authorize');assert(resumed.authorizationExpiresAt<=suiteDeadline);
    assert.equal(device.signatures.length,1);assert.equal(f.submitted.length,0);assert.equal(f.owner.getCatalogue()!.active.accountId,selected);
    const confirmed=resumed.authorize(resumed.getSnapshot().revision);
    for(let i=0;i<1000&&resumed.getSnapshot().phase!=='review-fee'&&!['complete','failed'].includes(resumed.getSnapshot().phase);i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(resumed.getSnapshot().phase,'review-fee');assert.equal(f.submitted.length,0);
    resumed.confirmPayer(resumed.getSnapshot().payerReview!.id);await confirmed;assert.equal(resumed.getSnapshot().phase,'complete');assert.equal(f.submitted.length,1);
  }finally{release.resolve();await original?.dispose();await resumed?.dispose();await close();}
});


async function suspendedLocalTrezorSend(bundle:Awaited<ReturnType<typeof readyTrezorSmartOwner>>){
  const {f,device}=bundle,entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  let operation:NativeSmartAccountOperation|undefined;
  try{
    device.onBeforeCallback(async request=>{if(request.method==='ethereumSignTypedData'){entered.resolve();await release.promise;}});
    operation=await f.runtime.openSmartAccountSend('0x'+'55'.repeat(20),{kind:'exact',amount:'0.000001'},()=>undefined, null);
    await operation.prepare();const hash=operation.getSnapshot().userOperationHash;
    const signing=operation.authorize(operation.getSnapshot().revision);
    await Promise.race([entered.promise,signing.then(()=>{throw Error('Expected Suite signing launch');})]);
    operation.background();f.runtime.trezor.background();f.owner.lock();await signing;release.resolve();await new Promise(resolve=>setImmediate(resolve));
    await f.owner.unlock();const resume=await f.runtime.trezor.resumeSend();assert.equal(resume.kind,'smart-operation');
    return {operation,resume,hash};
  }catch(error){await operation?.dispose();throw error;}finally{release.resolve();}
}

for(const change of ['nonce','owner policy','cancel'] as const)test(`local Smart Trezor ${change} after unlock cannot reuse the old approval or signed callback`,async()=>{
  const bundle=await readyTrezorSmartOwner(),{f,device}=bundle;let suspended:Awaited<ReturnType<typeof suspendedLocalTrezorSend>>|undefined,resumed:NativeSmartAccountOperation|undefined;
  try{
    suspended=await suspendedLocalTrezorSend(bundle);const before=device.signatures.length;
    if(change==='owner policy')f.mutateSelectedSmart(account=>{account.smartAccount!.auth={...account.smartAccount!.auth!,data:encodeEcdsaValidatorInitData([device.wallets[1]!.address],1)};});
    if(change==='cancel')await f.runtime.trezor.cancel();
    if(change!=='nonce')await assert.rejects(f.runtime.resumeSmartAccountOperation(suspended.resume.id,new AbortController().signal,()=>undefined, null));
    else{
      f.advanceSmartNonce();resumed=await f.runtime.resumeSmartAccountOperation(suspended.resume.id,new AbortController().signal,()=>undefined, null);
      await resumed.prepare();assert.equal(resumed.getSnapshot().phase,'authorize');assert.notEqual(resumed.getSnapshot().userOperationHash,suspended.hash);
      await resumed.authorize(resumed.getSnapshot().revision);assert.equal(resumed.getSnapshot().phase,'failed');
    }
    for(let i=0;i<10&&device.sessions.getSnapshot();i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(device.signatures.length,before);assert.equal(f.submitted.length,0);assert.equal(device.sessions.getSnapshot(),null);
  }finally{await suspended?.operation.dispose();await resumed?.dispose();await bundle.close();}
});

test('an accepted local Smart Trezor signature cannot become resumable during payer consent',async()=>{
  const {f,device,close}=await readyTrezorSmartOwner();let operation:NativeSmartAccountOperation|undefined;
  try{
    operation=await f.runtime.openSmartAccountSend('0x'+'55'.repeat(20),{kind:'exact',amount:'0.000001'},()=>undefined, null);await operation.prepare();
    const signing=operation.authorize(operation.getSnapshot().revision);
    for(let i=0;i<1000&&operation.getSnapshot().phase!=='review-fee'&&!['complete','failed'].includes(operation.getSnapshot().phase);i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(operation.getSnapshot().phase,'review-fee');assert.equal(device.signatures.length,1);
    operation.background();f.owner.lock();await signing;await f.owner.unlock();
    await assert.rejects(f.runtime.trezor.resumeSend());assert.equal(device.sessions.getSnapshot(),null);assert.equal(f.submitted.length,0);
  }finally{await operation?.dispose();await close();}
});


for(const action of ['guardian-policy','wallet-authenticator','slh-installation','modules'] as const)test(`local Smart Trezor ${action} rebuilds with the original validated builder and durable records`,async()=>{
  const backend=action==='slh-installation'?slhSmartBackend():null;
  const {f,device,close}=await readyTrezorSmartOwner(backend?.capability??null),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  let original:NativeSmartAccountOperation|undefined,resumed:NativeSmartAccountOperation|undefined;
  try{
    const selected=f.owner.getCatalogue()!.active.accountId;
    device.onBeforeCallback(async request=>{if(request.method==='ethereumSignTypedData'){entered.resolve();await release.promise;}});
    if(action==='guardian-policy')original=await f.runtime.openGuardianPolicy({action:'set',guardian:'0x'+'77'.repeat(20),delaySeconds:259200,acknowledgedPendingOperationId:null},new AbortController().signal,()=>undefined, null);
    else if(action==='wallet-authenticator')original=await f.runtime.openWalletAuthenticator(new AbortController().signal,()=>undefined, null);
    else if(action==='modules'){
      f.customValidator(CUSTOM_MODULE); const draft=customModuleDraft();
      f.onSmartCodeRead(()=>{draft.address='0x9999999999999999999999999999999999999999';draft.initData='0x5678';});
      original=await f.runtime.openSmartAccountModuleChange(draft,new AbortController().signal,()=>undefined, null);
      f.onSmartCodeRead(()=>undefined);
    }
    else{
      const signer=await f.runtime.openSlhDsaAccount(()=>undefined,new AbortController().signal, null),key=await signer.prepareFresh(()=>undefined);
      original=await f.runtime.openSlhDsaInstallation(key.keyId,new AbortController().signal,()=>undefined, null);
    }
    await original.prepare();assert.equal(original.getSnapshot().phase,'authorize');
    const signing=original.getSnapshot().intent.kind==='modules'?authorizeReviewedModule(original):original.authorize(original.getSnapshot().revision);await Promise.race([entered.promise,signing.then(()=>{throw Error('Expected Suite authorization');})]);
    const deadline=device.sessions.getSnapshot()!.expiresAt;original.background();f.owner.lock();await signing;release.resolve();await new Promise(resolve=>setImmediate(resolve));
    await f.owner.unlock();const draft=await f.runtime.trezor.resumeSend();assert.equal(draft.kind,'smart-operation');
    resumed=await f.runtime.resumeSmartAccountOperation(draft.id,new AbortController().signal,()=>undefined, null);await resumed.prepare();
    assert.equal(resumed.getSnapshot().phase,'authorize');assert(resumed.authorizationExpiresAt<=deadline);assert.equal(f.owner.getCatalogue()!.active.accountId,selected);
    assert.equal(device.signatures.length,1);assert.equal(f.submitted.length,0);
    assert.equal(resumed.getSnapshot().intent.kind,action==='guardian-policy'?'guardian-policy':action==='modules'?'modules':'authenticator');
    if(action==='modules'){const intent=resumed.getSnapshot().intent;assert.equal(intent.kind,'modules');if(intent.kind!=='modules')throw Error('Wrong intent');assert.equal(intent.command.targetAddress,CUSTOM_MODULE);assert.equal(intent.command.draft.kind,'install-custom');if(intent.command.draft.kind==='install-custom')assert.equal(intent.command.draft.initData,'0x1234');}
    if(action==='slh-installation')assert.equal(backend!.actions.length,0,'restoring review does not use a private SLH signing capability');
  }finally{release.resolve();await original?.dispose();await resumed?.dispose();await close();}
});

const CUSTOM_MODULE = '0x7777777777777777777777777777777777777777';
const customModuleDraft = () => ({ kind: 'install-custom' as const, address: CUSTOM_MODULE, name: 'Custom fixture', initData: '0x1234' });

test('dapp module inventory reads only the requested cached Smart account without network or signing work', async () => {
  const f = await fixture({}, true);
  try {
    await f.change({ kind: 'create-smart', label: 'Modules',});
    const selected = f.owner.getCatalogue()!.active.accountId;
    const host = await f.runtime.openConnectionHost();
    const calls = f.calls.length;
    const inventory = host.readSmartAccountModules(selected, 'ethereum', () => undefined);
    assert.equal(inventory.address, f.owner.getSnapshot().account!.address);
    assert.equal(inventory.chainId, '0x1'); assert.equal(inventory.deployed, false);
    assert.deepEqual(Object.keys(inventory).sort(), ['activeValidator', 'address', 'chainId', 'deployed', 'installed']);
    assert(!JSON.stringify(inventory).includes('deploymentSalt')); assert(!JSON.stringify(inventory).includes('owners'));
    assert.equal(f.calls.length, calls); assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
    assert.throws(() => host.readSmartAccountModules('hd:60:0', 'ethereum', () => undefined), /not a smart account/);
    assert.throws(() => host.readSmartAccountModules(selected, 'ethereum', () => { throw Error('CANCELLED'); }), /CANCELLED/);
    assert.throws(() => host.readSmartAccountModules(selected, 'not-the-captured-network', () => undefined), /CANCELLED/);
    f.owner.lock();
    assert.throws(() => host.readSmartAccountModules(selected, 'ethereum', () => undefined), /CANCELLED/);
  } finally { await f.close(); }
});

function authorizeReviewedModule(operation: NativeSmartAccountOperation) {
  const review = operation.getSnapshot();
  assert.equal(review.intent.kind, 'modules');
  if (review.intent.kind !== 'modules') throw Error('Not a module review');
  return operation.authorizeModuleChange(review.revision, review.intent.command.draft.kind === 'install-custom'
    ? { kind: 'install-custom', riskAcknowledged: true } : { kind: review.intent.command.draft.kind });
}

async function confirmModuleOperation(operation: NativeSmartAccountOperation) {
  await operation.prepare();
  assert.equal(operation.getSnapshot().phase, 'authorize', JSON.stringify(operation.getSnapshot()));
  const authorizing = authorizeReviewedModule(operation);
  for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
  operation.confirmPayer(operation.getSnapshot().payerReview!.id);
  await authorizing;
  assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
}

for (const deployed of [false, true]) test(`dapp custom module consent uses the shared operation with deployed=${deployed}`, async () => {
  const f = await fixture({}, true);
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Dapp modules',});
    if (deployed) f.guardianStatus('no-policy');
    f.fundedSmart(); f.customValidator(CUSTOM_MODULE);
    connection = await smartMessageApproval(f);
    const prepared = await connection.host.prepareModuleChange({ accountId: connection.selected.id, networkId: 'ethereum',
      request: normalizeSmartAccountModuleRequest('wallet_requestSmartAccountModuleInstall', [{ address: CUSTOM_MODULE, initData: '0x1234', name: 'Fixture module', riskAcknowledged: true }]),
      approval: connection.approval, handoff: nonSuiteSigningHandoff }, connection.approval.assertCurrent, null);
    operation = prepared.operation;
    await operation.prepare();
    const review = operation.getSnapshot();
    assert.equal(review.phase, 'authorize', JSON.stringify(review));
    assert.equal(review.intent.kind, 'modules');
    if (review.intent.kind !== 'modules') throw Error('Wrong intent');
    assert.equal(review.intent.command.sourceIsDeployed, deployed);
    assert.equal(review.intent.command.removalPolicy, 'active-composite');
    await assert.rejects(operation.authorize(review.revision), /Explicit module authorization/);
    await assert.rejects(operation.authorizeModuleChange(review.revision, { kind: 'install-custom', riskAcknowledged: false } as never), /Explicit module authorization/);
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
    f.onBroadcast(() => { f.guardianStatus('no-policy'); f.customValidator(CUSTOM_MODULE, true); });
    const work = authorizeReviewedModule(operation);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id); await work;
    assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
    assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
    assert.equal(f.signatures.length, 1); assert.equal(f.submitted.length, 1);
    connection.approval.assertCurrent();
    const raw = Transaction.from(f.submitted[0]!);
    const [operations] = paliEntryPointInterface.decodeFunctionData('handleOps', raw.data);
    assert.equal(operations[0].initCode === '0x', deployed);
  } finally { await operation?.dispose(); connection?.approval.dispose(); await f.close(); }
});

test('dapp Trezor module installation preserves private approval through signed discovery and canonical reconciliation', async () => {
  const { f, device, close } = await readyTrezorSmartOwner();
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  let operation: NativeSmartAccountOperation | undefined;
  let continuation:ReturnType<typeof ownedSmartSdkHandoff>|undefined;
  try {
    f.customValidator(CUSTOM_MODULE);
    connection = await smartMessageApproval(f);
    const deadline = Date.now() + 60000;
    continuation=ownedSmartSdkHandoff(connection,'module-trezor',deadline,'wallet_requestSmartAccountModuleInstall');
    const handoff=continuation.handoff;
    const prepared = await connection.host.prepareModuleChange({ accountId: connection.selected.id, networkId: 'ethereum',
      request: normalizeSmartAccountModuleRequest('wallet_requestSmartAccountModuleInstall', [{ address: CUSTOM_MODULE, name: 'Trezor module', initData: '0x1234' }]),
      approval: connection.approval, handoff }, connection.approval.assertCurrent, null);
    operation = prepared.operation;
    await operation.prepare();
    assert.equal(operation.getSnapshot().phase, 'authorize');
    assert(operation.authorizationExpiresAt <= deadline);
    f.onBroadcast(() => f.customValidator(CUSTOM_MODULE, true));
    const signing = authorizeReviewedModule(operation);
    for (let attempt = 0; attempt < 1000 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; attempt++)
      await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(operation.getSnapshot().phase, 'review-fee', JSON.stringify(operation.getSnapshot()));
    continuation.terminal(); assert.equal(device.signatures.length, 1); assert.equal(f.submitted.length, 0);
    connection.approval.assertCurrent();
    operation.confirmPayer(operation.getSnapshot().payerReview!.id); await signing;
    assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
    assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
    assert.equal(f.submitted.length, 1); assert.equal(device.signatures.length, 1);
    assert.equal(f.owner.getCatalogue()!.active.accountId, connection.selected.id);
    connection.approval.assertCurrent();
  } finally { await operation?.dispose(); await continuation?.dispose(); connection?.approval.dispose(); await close(); }
});

for (const delayed of [false, true]) test(`module management custom install survives restart and metadata-only retry (delayed=${delayed})`, async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Modules',});
    f.guardianStatus('no-policy'); f.fundedSmart(); f.customValidator(CUSTOM_MODULE);
    operation = await f.runtime.openSmartAccountModuleChange(customModuleDraft(), new AbortController().signal, () => undefined, null);
    const before = savedSmartAccount((await f.inspectRecovery()).record).smartAccount;
    assert.equal(before.customModules?.length ?? 0, 0, 'opening a review does not persist abandoned discovery routes');
    assert(!before.installedModules?.some((module: SmartAccountInstalledModule) => module.address === CUSTOM_MODULE));
    f.onBroadcast(() => { if (!delayed) f.customValidator(CUSTOM_MODULE, true); });
    await confirmModuleOperation(operation);
    assert.equal(operation.getSnapshot().metadataRefresh, delayed ? 'failed' : 'complete');
    if (delayed) {
      f.customValidator(CUSTOM_MODULE, true); await operation.retryMetadata();
      assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
    }
    await authorizeReviewedModule(operation);
    assert.equal(f.submitted.length, 1); assert.equal(f.signatures.length, 1);
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.customModules?.[0]?.address, CUSTOM_MODULE);
    await operation.dispose(); operation = undefined;
    await f.reopen(); await f.owner.unlock();
    const observed = await f.runtime.readSmartAccountModules(new AbortController().signal, () => undefined);
    assert.equal(observed.auth?.module, 'ecdsa');
    assert.equal(observed.installedModules?.find(module => module.address === CUSTOM_MODULE)?.id, 'custom');
    assert.equal(observed.customModules?.[0]?.initData, '0x1234');
  } finally { await operation?.dispose(); await f.close(); }
});

test('module management rejects stale owner before signing and active-validator removal', async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Modules',});
    f.guardianStatus('no-policy'); f.fundedSmart(); f.customValidator(CUSTOM_MODULE);
    await assert.rejects(f.runtime.openSmartAccountModuleChange({ kind: 'uninstall', address: getConfiguredAuthenticatorAddress(1, 'ecdsa') }, new AbortController().signal, () => undefined, null), /modules changed/);
    operation = await f.runtime.openSmartAccountModuleChange(customModuleDraft(), new AbortController().signal, () => undefined, null);
    await operation.prepare(); assert.equal(operation.getSnapshot().phase, 'authorize');
    f.observedEcdsaOwners(['0x8888888888888888888888888888888888888888'], 1);
    await authorizeReviewedModule(operation);
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally { await operation?.dispose(); await f.close(); }
});

test('module management composite uses shared execution and reconciles its exact rule', async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Modules',});
    f.guardianStatus('no-policy'); f.fundedSmart();
    const children = [getConfiguredAuthenticatorAddress(1, 'ecdsa')];
    operation = await f.runtime.openSmartAccountModuleChange({ kind: 'composite', children, threshold: 1 }, new AbortController().signal, () => undefined, null);
    f.onBroadcast(() => f.observedCompositeChildren(children));
    await confirmModuleOperation(operation);
    assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
    assert.equal(f.submitted.length, 1); assert.equal(f.signatures.length, 1);
    const observed = await f.runtime.readSmartAccountModules(new AbortController().signal, () => undefined);
    assert.equal(observed.auth?.module, 'composite');
    assert.equal(f.runtime.canSignSmartAccount(), true);
  } finally { await operation?.dispose(); await f.close(); }
});

test('module management cancellation while saving a discovery record rolls back before commit', async () => {
  let armed = false, writes = 0;
  const lifetime = new AbortController();
  const f = await fixture({ after(kind, sql) {
    if (armed && kind === 'run' && sql.startsWith('UPDATE keyring_records') && ++writes === 1) {
      armed = false; lifetime.abort();
    }
  } }, true);
  try {
    await f.change({ kind: 'create-smart', label: 'Modules',});
    f.guardianStatus('no-policy'); f.customValidator(CUSTOM_MODULE);
    const operation = await f.runtime.openSmartAccountModuleChange(customModuleDraft(), lifetime.signal, () => undefined, null);
    try {
      await operation.prepare(); assert.equal(operation.getSnapshot().phase, 'authorize');
      armed = true;
      await authorizeReviewedModule(operation);
      assert.equal(operation.getSnapshot().phase, 'failed');
    } finally { await operation.dispose(); }
    assert.equal(writes, 1, 'revocation occurs during the authorized discovery update');
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.customModules?.length ?? 0, 0);
    assert.equal(f.signatures.length, 1); assert.equal(f.submitted.length, 0);
    assert.equal(f.runtime.catalogue.getSnapshot(), null, 'a revoked write quarantines its runtime even after SQL rollback');
    await assert.rejects(f.runtime.session.readSelectedAddress(), /CLEANUP_FAILED|CANCELLED|NOT_READY/);
    await f.reopenQuarantined(); await f.owner.unlock();
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.customModules?.length ?? 0, 0);
  } finally { await f.close(); }
});

test('module management confirmed custom uninstall retires its discovery record', async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Modules',});
    f.guardianStatus('no-policy'); f.fundedSmart(); f.customValidator(CUSTOM_MODULE);
    operation = await f.runtime.openSmartAccountModuleChange(customModuleDraft(), new AbortController().signal, () => undefined, null);
    f.onBroadcast(() => f.customValidator(CUSTOM_MODULE, true));
    await confirmModuleOperation(operation); await operation.dispose(); operation = undefined;
    operation = await f.runtime.openSmartAccountModuleChange({ kind: 'uninstall', address: CUSTOM_MODULE }, new AbortController().signal, () => undefined, null);
    f.onBroadcast(() => f.customValidator(CUSTOM_MODULE, false));
    await confirmModuleOperation(operation);
    assert.equal(operation.getSnapshot().metadataRefresh, 'complete');
    assert.equal(f.submitted.length, 2); assert.equal(f.signatures.length, 2);
    const observed = await f.runtime.readSmartAccountModules(new AbortController().signal, () => undefined);
    assert.equal(observed.customModules?.length, 0);
    assert(!observed.installedModules?.some(module => module.address === CUSTOM_MODULE));
  } finally { await operation?.dispose(); await f.close(); }
});

test('module management follows the extension self-target blacklist policy', async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Modules',});
    f.guardianStatus('no-policy'); f.customValidator(CUSTOM_MODULE); f.blockRecipient();
    operation = await f.runtime.openSmartAccountModuleChange(customModuleDraft(), new AbortController().signal, () => undefined, null);
    await operation.prepare(); assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.customModules?.length ?? 0, 0);
  } finally { await operation?.dispose(); await f.close(); }
});

for (const boundary of ['before-review', 'before-sign'] as const) test(`custom validator installed by another client is refused ${boundary} without prompting an owner`, async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Modules',});
    f.guardianStatus('no-policy'); f.fundedSmart(); f.customValidator(CUSTOM_MODULE);
    operation = await f.runtime.openSmartAccountModuleChange(customModuleDraft(), new AbortController().signal, () => undefined, null);
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.customModules?.length ?? 0, 0);
    if (boundary === 'before-review') f.customValidator(CUSTOM_MODULE, true);
    await operation.prepare();
    if (boundary === 'before-sign') {
      assert.equal(operation.getSnapshot().phase, 'authorize');
      f.customValidator(CUSTOM_MODULE, true);
      const work = authorizeReviewedModule(operation);
      for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
        await new Promise(resolve => setTimeout(resolve, 5));
      if (operation.getSnapshot().payerReview) operation.cancel();
      await work;
    }
    assert.equal(operation.getSnapshot().phase, 'failed', 'an already-installed target must be rejected at the current boundary');
    assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
    assert.equal(savedSmartAccount((await f.inspectRecovery()).record).smartAccount.customModules?.length ?? 0, 0, 'an early rejection must not persist a discovery record');
  } finally { await operation?.dispose(); await f.close(); }
});

test('a custom installation during payer review is refused before wire submission', async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Modules',});
    f.guardianStatus('no-policy'); f.fundedSmart(); f.customValidator(CUSTOM_MODULE);
    operation = await f.runtime.openSmartAccountModuleChange(customModuleDraft(), new AbortController().signal, () => undefined, null);
    await operation.prepare(); assert.equal(operation.getSnapshot().phase, 'authorize');
    const work = authorizeReviewedModule(operation);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview);
    f.customValidator(CUSTOM_MODULE, true);
    operation.confirmPayer(operation.getSnapshot().payerReview!.id); await work;
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(f.signatures.length, 1); assert.equal(f.submitted.length, 0);
  } finally { await operation?.dispose(); await f.close(); }
});

for (const kind of ['exact', 'maximum'] as const) test(`ordinary Smart ${kind} send prepares and signs with freshly hydrated composite metadata`, async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Externally deployed account',});
    // Cached constructor metadata remains undeployed/ECDSA. Another client has
    // deployed the account and activated composite authentication on-chain.
    f.guardianStatus('no-policy'); f.fundedSmart();
    f.observedCompositeChildren([getConfiguredAuthenticatorAddress(1, 'ecdsa')]);
    const cached = savedSmartAccount((await f.inspectRecovery()).record).smartAccount;
    assert.equal(cached.isDeployed, false); assert.equal(cached.auth.module, 'ecdsa');
    operation = await f.runtime.openSmartAccountSend('0x5555555555555555555555555555555555555555', kind === 'exact' ? { kind, amount: '0.000001' } : { kind }, () => undefined, null);
    await operation.prepare();
    const review = operation.getSnapshot();
    assert.equal(review.phase, 'authorize', JSON.stringify(review));
    const validator = getConfiguredAuthenticatorAddress(1, 'composite');
    assert.equal(BigInt(review.authorization!.nonce) >> 64n, BigInt(encodeSmartAccountValidatorNonceKey(validator)), 'nonce and gas preparation must use the newly observed authenticator');
    const authorizing = operation.authorize(review.revision);
    for (let i = 0; i < 300 && !operation.getSnapshot().payerReview && operation.getSnapshot().phase !== 'failed'; i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    assert(operation.getSnapshot().payerReview, JSON.stringify(operation.getSnapshot()));
    operation.confirmPayer(operation.getSnapshot().payerReview!.id); await authorizing;
    assert.equal(operation.getSnapshot().phase, 'complete');
    assert.equal(f.submitted.length, 1); assert.equal(f.signatures.length, 1);
    const transaction = Transaction.from(f.submitted[0]!);
    const [operations] = paliEntryPointInterface.decodeFunctionData('handleOps', transaction.data);
    assert.equal(operations[0].nonce, BigInt(review.authorization!.nonce), 'the submitted envelope must retain the reviewed composite nonce');
    const [childProofs] = coder.decode(['bytes[]'], operations[0].signature);
    assert.deepEqual([...childProofs], [f.signatures[0]!.signature], 'the submitted composite proof must preserve its configured ECDSA child');
    const op = operations[0];
    const submittedHash = getSmartAccountUserOpHash({ sender: op.sender, nonce: op.nonce.toString(), initCode: op.initCode, callData: op.callData,
      accountGasLimits: op.accountGasLimits, preVerificationGas: op.preVerificationGas.toString(), gasFees: op.gasFees, paymasterAndData: op.paymasterAndData, signature: op.signature }, 1);
    assert.equal(submittedHash, review.userOperationHash); assert.equal(f.signatures[0]!.digest, submittedHash);
    assert.equal(recoverAddress(submittedHash, childProofs[0]).toLowerCase(), f.signatures[0]!.address.toLowerCase());
  } finally { await operation?.dispose(); await f.close(); }
});


/** Simulate native prompt focus events while exercising actual credential acquisition. */
function ownedSmartAuthentication(f: Awaited<ReturnType<typeof fixture>>) {
  const scope = createNativePrivateAuthenticationScope();
  let live = true, interrupted = false, promptActive = false, requests = 0;
  const binding = bindNativePrivateAuthentication(scope, {
    assertCurrent() { assert(live, 'binding retired'); },
    isPromptActive: () => promptActive,
  });
  const guard = () => { assert(live, 'view retired'); assert(!interrupted || scope.isAuthenticating(), 'unowned interruption'); };
  f.onCredentialRequest(check => {
    requests++; promptActive = true; interrupted = true;
    try { assert(scope.isAuthenticating(), 'exact request owns native prompt'); check(); }
    finally { interrupted = false; promptActive = false; }
  });
  return { scope, binding, guard, requests: () => requests, retire() { live = false; scope.retire(); } };
}

test('owned smart authentication survives owner and payer prompt interruptions without extra submissions', async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Owned authentication' });
    const auth = ownedSmartAuthentication(f);
    operation = await f.runtime.openSmartAccountDeployment(auth.guard, auth.binding);
    await operation.prepare();
    const pending = operation.authorize(operation.getSnapshot().revision);
    for (let i = 0; i < 300 && !['complete', 'failed'].includes(operation.getSnapshot().phase); i++) {
      const review = operation.getSnapshot().payerReview;
      if (review) { operation.confirmPayer(review.id); operation.confirmPayer(review.id); }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await pending;
    assert.equal(operation.getSnapshot().phase, 'complete', JSON.stringify(operation.getSnapshot()));
    assert.equal(auth.requests(), 3, 'one owner proof and two separately approved payer signatures');
    assert.equal(f.signatures.length, 1); assert.equal(f.submitted.length, 2);
    assert.equal(auth.scope.isAuthenticating(), false);
  } finally { await operation?.dispose(); await f.close(); }
});

test('owned smart authentication rejects a retired scope before signing', async () => {
  const f = await fixture({}, true);
  let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create-smart', label: 'Retired authentication' });
    const auth = ownedSmartAuthentication(f);
    operation = await f.runtime.openSmartAccountDeployment(auth.guard, auth.binding);
    await operation.prepare(); auth.scope.retire();
    await operation.authorize(operation.getSnapshot().revision);
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(auth.requests(), 0); assert.equal(f.signatures.length, 0); assert.equal(f.submitted.length, 0);
  } finally { await operation?.dispose(); await f.close(); }
});

test('owned smart authentication also reaches infrastructure payer credentials', async () => {
  const f = await fixture({}, true);
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  try {
    f.infrastructureCode('ecdsaValidator', false);
    const auth = ownedSmartAuthentication(f);
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, auth.guard, auth.binding);
    await controller.refresh(controller.getSnapshot().revision);
    await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview; assert(review);
    await controller.confirm(review.id);
    assert.equal(auth.requests(), 1); assert.equal(f.submitted.length, 1);
    assert.equal(auth.scope.isAuthenticating(), false);
  } finally { controller?.dispose(); await f.close(); }
});

test('owned smart authentication reaches standalone SLH setup credentials', async () => {
  const backend = slhSmartBackend(), f = await fixture({}, true, backend.capability);
  try {
    await f.change({ kind: 'create-smart', label: 'Owned SLH authentication' });
    const auth = ownedSmartAuthentication(f);
    const account = await f.runtime.openSlhDsaAccount(auth.guard, new AbortController().signal, auth.binding);
    const key = await account.prepareFresh(() => undefined);
    assert(key.keyId); assert.equal(auth.requests(), 1); assert.equal(auth.scope.isAuthenticating(), false);
    f.assertNoSigningKeys();
  } finally { await f.close(); }
});


test('owned smart authentication reaches both guardian recovery proofs', async () => {
  const f = await fixture({}, true);
  let recovery: Awaited<ReturnType<KeyringRuntime['openGuardianRecovery']>> | undefined;
  try {
    const privateKey = '0x' + '02'.repeat(32);
    await f.owner.importAccount({ privateKey, label: 'Replacement', expectedAddress: importedKeyIdentity(privateKey, 0).address },
      f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined));
    await f.change({ kind: 'create-smart', label: 'Owned recovery authentication' });
    const accounts = f.owner.getCatalogue()!.accounts;
    const guardian = accounts.find(account => account.id === 'hd:60:0')!;
    const replacement = accounts.find(account => account.type === 'Imported')!;
    f.guardianStatus('installed').configure(guardian.address, 600); f.externalOwner();
    const auth = ownedSmartAuthentication(f);
    recovery = await f.runtime.openGuardianRecovery({ kind: 'start', guardianId: guardian.id, replacement: { kind: 'software' as const, accountId: replacement.id }, payerId: guardian.id },
      new AbortController().signal, auth.guard, auth.binding);
    await recovery.prepare(); await recovery.review();
    assert.equal(recovery.getSnapshot().phase, 'review', JSON.stringify(recovery.getSnapshot()));
    assert.equal(auth.requests(), 2); assert.equal(f.signatures.length, 2); assert.equal(f.submitted.length, 0);
    assert.equal(auth.scope.isAuthenticating(), false);
  } finally { recovery?.dispose(); await f.close(); }
});

function infrastructureTrezorDevice() {
  const wallet = new Wallet(`0x${'31'.repeat(32)}`), methods: string[] = [], unsignedTransactions: string[] = [], callbackErrors: unknown[] = [];
  let sequence = 0, clients = 0, disposals = 0;
  let beforeCallback: ((method: string) => Promise<void>) | undefined;
  let beforeDispose: (() => Promise<void>) | undefined;
  let signingFailure: string | undefined;
  let beforeSign: ((unsigned: string) => Promise<void>) | undefined;
  const sessions = createTrezorSessions({
    randomBytes: length => new Uint8Array(length).fill(++sequence),
    async loadClient() {
      const id = ++clients;
      let settings!: Parameters<NativeTrezorClient['init']>[0], settle!: (value: unknown) => void;
      const vendor = new Promise<unknown>(resolve => {settle = resolve;});
      return {
        async init(value) {settings = value;},
        call({method, ...params}) {
          const callback = new URL(settings.deeplinkCallbackUrl); callback.searchParams.set('id', `infrastructure-${id}`);
          const url = new URL(`${settings.connectSrc}deeplink/1/`);
          url.searchParams.set('method', String(method)); url.searchParams.set('params', JSON.stringify(params));
          url.searchParams.set('callback', callback.toString()); url.searchParams.set('appName', settings.manifest.appName);
          settings.deeplinkOpen(url.toString()); return vendor;
        },
        cancel() {settle(undefined);},
        async dispose() {disposals++; await beforeDispose?.();},
      } satisfies NativeTrezorClient;
    },
    async openURL(text) {
      const url = new URL(text), method = url.searchParams.get('method')!, params = JSON.parse(url.searchParams.get('params')!);
      methods.push(method);
      let payload: Record<string, unknown>;
      let success = true;
      if (method === 'ethereumSignTransaction' && signingFailure) {
        success = false; payload = {error: signingFailure, code: signingFailure};
      } else if (method === 'getFeatures') payload = {model: 'T', initialized: true, unlocked: true};
      else {
        assert.equal(Number(String(params.path).split('/').at(-1)), 0);
        if (method === 'ethereumGetPublicKey') payload = {publicKey: wallet.signingKey.publicKey.slice(2)};
        else if (method === 'ethereumGetAddress') payload = {address: wallet.address};
        else if (method === 'ethereumSignTransaction') {
          const tx = params.transaction;
          const transaction = Transaction.from({chainId: tx.chainId, nonce: Number(BigInt(tx.nonce)), to: tx.to,
            value: BigInt(tx.value), gasLimit: BigInt(tx.gasLimit), data: tx.data,
            ...(tx.gasPrice !== undefined ? {type: 0, gasPrice: BigInt(tx.gasPrice)}
              : {type: 2, accessList: tx.accessList, maxFeePerGas: BigInt(tx.maxFeePerGas), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas)})});
          await beforeSign?.(transaction.unsignedSerialized);
          unsignedTransactions.push(transaction.unsignedSerialized);
          const signature = wallet.signingKey.sign(transaction.unsignedHash);
          payload = {r: signature.r.slice(2), s: signature.s.slice(2), v: signature.v.toString(16)};
        } else throw Error(`Unexpected infrastructure Trezor method: ${method}`);
      }
      const callback = new URL(url.searchParams.get('callback')!);
      callback.searchParams.set('response', JSON.stringify(success ? {success, payload} : {success, error:{code:signingFailure!,message:'Trezor request refused'}}));
      setImmediate(() => {
        void Promise.resolve().then(() => beforeCallback?.(method)).then(() => {
          assert.equal(sessions.receiveCallback(callback.toString()), true);
        }).catch(error => callbackErrors.push(error));
      });
    },
  });
  return {wallet, sessions, methods, unsignedTransactions, callbackErrors,
    rejectSigning(error: string) {signingFailure = error;},
    counts: () => ({clients, disposals}),
    onBeforeCallback(hook: typeof beforeCallback) {beforeCallback = hook;},
    onBeforeDispose(hook: typeof beforeDispose) {beforeDispose = hook;},
    onBeforeSign(hook: typeof beforeSign) {beforeSign = hook;},
  };
}

async function readyTrezorInfrastructure() {
  const device = infrastructureTrezorDevice(), f = await fixture({}, true, null, undefined, device.sessions);
  try {
    await f.runtime.trezor.startImport('Infrastructure Trezor');
    await f.change({kind: 'import-trezor', label: 'Infrastructure Trezor'});
    if (f.owner.getCatalogue()!.active.accountId !== 'trezor:60:0') await f.change({kind: 'select', id: 'trezor:60:0'});
    device.onBeforeSign(async unsigned => {
      f.assertNoSigningKeys();
      const pending = ((await f.inspectRecovery()).record as {infrastructurePending: readonly NativeInfrastructurePending[]}).infrastructurePending[0];
      assert(pending, 'the reservation must commit before any Suite transaction signing');
      assert.equal(pending.payer.id, 'trezor:60:0'); assert.equal(pending.entry.nonce, Transaction.from(unsigned).nonce);
      assert.equal(pending.entry.payerAddress, device.wallet.address); assert.equal(pending.entry.transactionHash, undefined);
    });
    return {f, device, async close() {await f.close(); await device.sessions.dispose();}};
  } catch (error) {await f.close(); await device.sessions.dispose(); throw error;}
}

async function suspendTrezorInfrastructure(bundle: Awaited<ReturnType<typeof readyTrezorInfrastructure>>) {
  const {f, device} = bundle, entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  try {
    f.initialEoaNonce(7); f.infrastructureCode('factory', false); f.holdReceipts();
    device.onBeforeCallback(async method => {if (method === 'ethereumSignTransaction') {entered.resolve(); await release.promise;}});
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision); await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review);
    const confirmation = controller.confirm(review.id);
    await Promise.race([entered.promise, confirmation.then(() => {throw Error(`No Suite signing launch: ${JSON.stringify(controller?.getSnapshot())}`);})]);
    const pending = ((await f.inspectRecovery()).record as {infrastructurePending: readonly NativeInfrastructurePending[]}).infrastructurePending[0]!;
    const job = device.sessions.getSnapshot()!.job;
    controller.background(); f.runtime.trezor.background(); f.owner.lock(); await confirmation;
    release.resolve(); await new Promise<void>(resolve => setImmediate(resolve));
    await f.owner.unlock();
    const resume = await f.runtime.trezor.resumeSend(); assert.equal(resume.kind, 'infrastructure');
    return {controller, review, pending, resume, job};
  } catch (error) {controller?.dispose(); throw error;}
  finally {release.resolve();}
}

test('Trezor infrastructure private SDK deploys through its existing live EOA session', async () => {
  const bundle = await readyTrezorInfrastructure(), {f, device} = bundle;
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  try {
    f.initialEoaNonce(7); f.infrastructureCode('factory', false); f.holdReceipts();
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision); await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review);
    await controller.confirm(review.id);
    assert.equal(controller.getSnapshot().phase, 'pending', JSON.stringify(controller.getSnapshot()));
    assert.equal(device.unsignedTransactions.length, 1); assert.equal(f.submitted.length, 1); assert.equal(f.payerSignatures.length, 0);
    assert.equal(Transaction.from(f.submitted[0]).unsignedSerialized, serializePreparedEvmTransaction(review.transaction));
    assert.equal(Transaction.from(f.submitted[0]).from, device.wallet.address);
    assert.equal(device.sessions.getSnapshot(), null); assert.deepEqual(device.callbackErrors, []);
  } finally {controller?.dispose(); await bundle.close();}
});

for (const uncertain of [false, true]) test(`Trezor infrastructure private SDK resumes the same durable attempt after fresh consent (${uncertain})`, async () => {
  const bundle = await readyTrezorInfrastructure(), {f, device} = bundle;
  let suspended: Awaited<ReturnType<typeof suspendTrezorInfrastructure>> | undefined;
  let resumed: Awaited<ReturnType<KeyringRuntime['openResumedSmartInfrastructure']>> | undefined;
  try {
    suspended = await suspendTrezorInfrastructure(bundle);
    const clients = device.counts().clients;
    resumed = await f.runtime.openResumedSmartInfrastructure(suspended.resume.id, new AbortController().signal, () => undefined, null);
    const review = resumed.getSnapshot().feeReview!; assert(review, JSON.stringify(resumed.getSnapshot()));
    assert.equal(review.kind, 'suite-resume'); assert.equal(resumed.getSnapshot().phase, 'review');
    assert.equal(serializePreparedEvmTransaction(review.transaction), serializePreparedEvmTransaction(suspended.review.transaction));
    assert(review.expiresAtMonotonicMilliseconds <= suspended.review.expiresAtMonotonicMilliseconds, 'fresh review must never renew the original expiry');
    assert(review.expiresAtMonotonicMilliseconds > performance.now());
    assert.equal(device.counts().clients, clients, 'opening the new review must not accept the retained terminal SDK job');
    assert.equal(device.sessions.getSnapshot()!.phase, 'response-ready');
    assert.equal(device.sessions.getSnapshot()!.job, suspended.job);
    assert.equal(device.unsignedTransactions.length, 1); assert.equal(f.submitted.length, 0);
    assert.deepEqual(((await f.inspectRecovery()).record as {infrastructurePending: readonly NativeInfrastructurePending[]}).infrastructurePending, [suspended.pending]);
    if (uncertain) f.infrastructureResponseLost();
    await resumed.confirm(review.id);
    assert.equal(resumed.getSnapshot().phase, uncertain ? 'unknown' : 'pending', JSON.stringify(resumed.getSnapshot()));
    assert.equal(device.unsignedTransactions.length, 1, 'the resumed SDK must replay the captured exact signing response');
    assert.equal(f.submitted.length, 1); assert.equal(f.payerSignatures.length, 0);
    const transaction = Transaction.from(f.submitted[0]);
    assert.equal(transaction.unsignedSerialized, device.unsignedTransactions[0]); assert.equal(transaction.nonce, 7); assert.equal(transaction.from, device.wallet.address);
    assert.equal(f.infrastructureBroadcasts[0]!.pending.entry.attemptId, suspended.pending.entry.attemptId);
    assert.equal(device.sessions.getSnapshot(), null); assert.deepEqual(device.callbackErrors, []);
    suspended.controller.dispose(); suspended = undefined; resumed.dispose(); resumed = undefined;
    await f.reopen(); await f.owner.unlock();
    await assert.rejects(f.runtime.openResumedSmartInfrastructure('missing-continuation', new AbortController().signal, () => undefined, null));
    resumed = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await resumed.refresh(resumed.getSnapshot().revision); await resumed.reviewNext(resumed.getSnapshot().revision);
    assert.equal(resumed.getSnapshot().phase, 'pending'); assert.equal(f.submitted.length, 1);
    f.showReceipts(); await resumed.refresh(resumed.getSnapshot().revision);
    assert.deepEqual(((await f.inspectRecovery()).record as {infrastructurePending: unknown[]}).infrastructurePending, []);
  } finally {suspended?.controller.dispose(); resumed?.dispose(); await bundle.close();}
});

for (const changed of ['automatic-nonce', 'insufficient-funds', 'network', 'cold-reopen'] as const) test(`Trezor infrastructure private SDK ${changed} cannot consume its old signing job or clear its entered reservation`, async () => {
  const bundle = await readyTrezorInfrastructure(), {f, device} = bundle;
  let suspended: Awaited<ReturnType<typeof suspendTrezorInfrastructure>> | undefined;
  let resumed: Awaited<ReturnType<KeyringRuntime['openResumedSmartInfrastructure']>> | undefined;
  try {
    suspended = await suspendTrezorInfrastructure(bundle);
    const clients = device.counts().clients;
    if (changed === 'automatic-nonce') f.initialEoaNonce(8);
    if (changed === 'insufficient-funds') f.gasSponsored();
    if (changed === 'network') await f.selectNetwork('base');
    if (changed === 'cold-reopen') {await f.reopen(); await f.owner.unlock();}
    if (changed === 'network' || changed === 'cold-reopen')
      await assert.rejects(f.runtime.openResumedSmartInfrastructure(suspended.resume.id, new AbortController().signal, () => undefined, null));
    else {
      resumed = await f.runtime.openResumedSmartInfrastructure(suspended.resume.id, new AbortController().signal, () => undefined, null);
      assert.notEqual(resumed.getSnapshot().phase, 'review');
    }
    assert.equal(device.counts().clients, clients); assert.equal(device.unsignedTransactions.length, 1); assert.equal(f.submitted.length, 0);
    const stored = (await f.inspectRecovery()).record as {infrastructurePending: readonly NativeInfrastructurePending[]};
    assert.deepEqual(stored.infrastructurePending, [suspended.pending]);
  } finally {suspended?.controller.dispose(); resumed?.dispose(); await bundle.close();}
});

for (const poisoned of [false, true]) test(`Trezor infrastructure private SDK holds fresh unlock behind the original client disposal (${poisoned})`, async () => {
  const bundle = await readyTrezorInfrastructure(), {f, device} = bundle;
  const entered = Promise.withResolvers<void>(), callback = Promise.withResolvers<void>();
  const draining = Promise.withResolvers<void>(), disposal = Promise.withResolvers<void>();
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  let resumed: Awaited<ReturnType<KeyringRuntime['openResumedSmartInfrastructure']>> | undefined;
  let confirmation: Promise<void> | undefined, unlock: Promise<void> | undefined;
  try {
    f.initialEoaNonce(7); f.infrastructureCode('factory', false); f.holdReceipts();
    device.onBeforeCallback(async method => {if (method === 'ethereumSignTransaction') {entered.resolve(); await callback.promise;}});
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision); await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review);
    confirmation = controller.confirm(review.id);
    await Promise.race([entered.promise, confirmation.then(() => {throw Error('No Suite signing launch');})]);
    const job = device.sessions.getSnapshot()!.job;
    const saved = ((await f.inspectRecovery()).record as {infrastructurePending: readonly NativeInfrastructurePending[]}).infrastructurePending;
    device.onBeforeDispose(async () => {draining.resolve(); await disposal.promise; if (poisoned) throw Error('SDK disposal unproven');});
    controller.background(); f.runtime.trezor.background(); f.owner.lock();
    await draining.promise;
    const clients = device.counts().clients, quotes = f.calls.filter(method => method === 'eth_estimateGas').length;
    let unlocked = false;
    unlock = f.owner.unlock().then(() => {unlocked = true;});
    void unlock.catch(() => undefined);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(unlocked, false); assert.notEqual(f.owner.getSnapshot().phase, 'ready');
    assert.equal(f.runtime.catalogue.getSnapshot(), null); assert.equal(device.sessions.getSnapshot()!.job, job);
    assert.equal(device.counts().clients, clients); assert.equal(f.calls.filter(method => method === 'eth_estimateGas').length, quotes);
    assert.equal(f.submitted.length, 0);
    disposal.resolve(); callback.resolve();
    await confirmation;
    if (poisoned) {
      await assert.rejects(unlock);
      assert.notEqual(f.owner.getSnapshot().phase, 'ready');
      await f.reopenQuarantined(); await f.owner.unlock();
      await assert.rejects(f.runtime.openResumedSmartInfrastructure('retired-infrastructure', new AbortController().signal, () => undefined, null));
    } else {
      await unlock;
      const resume = await f.runtime.trezor.resumeSend(); assert.equal(resume.kind, 'infrastructure');
      resumed = await f.runtime.openResumedSmartInfrastructure(resume.id, new AbortController().signal, () => undefined, null);
      assert.equal(resumed.getSnapshot().phase, 'review', JSON.stringify(resumed.getSnapshot()));
      assert(resumed.getSnapshot().feeReview!.expiresAtMonotonicMilliseconds <= review.expiresAtMonotonicMilliseconds, 'drain and unlock must never renew the original expiry');
      assert(resumed.getSnapshot().feeReview!.expiresAtMonotonicMilliseconds > performance.now());
      assert.equal(device.sessions.getSnapshot()!.job, job); assert.equal(device.counts().clients, clients);
    }
    assert.deepEqual(((await f.inspectRecovery()).record as {infrastructurePending: readonly NativeInfrastructurePending[]}).infrastructurePending, saved);
    assert.equal(device.unsignedTransactions.length, 1); assert.equal(f.submitted.length, 0);
  } finally {
    disposal.resolve(); callback.resolve(); await confirmation?.catch(() => undefined); await unlock?.catch(() => undefined);
    controller?.dispose(); resumed?.dispose();
    if (poisoned) {
      await f.close();
      await assert.rejects(device.sessions.dispose(), {message: 'SDK disposal unproven'});
    } else await bundle.close();
  }
});

for (const refusal of ['Failure_ActionCancelled', 'Failure_ProcessError'] as const) test(`foreground Trezor infrastructure ${refusal} leaves the mounted controller usable`, async () => {
  const bundle = await readyTrezorInfrastructure(), {f, device} = bundle;
  let controller: Awaited<ReturnType<KeyringRuntime['openSmartInfrastructure']>> | undefined;
  try {
    f.infrastructureCode('factory', false); f.holdReceipts();
    device.rejectSigning(refusal);
    controller = await f.runtime.openSmartInfrastructure(new AbortController().signal, () => undefined, null);
    await controller.refresh(controller.getSnapshot().revision); await controller.reviewNext(controller.getSnapshot().revision);
    const review = controller.getSnapshot().feeReview!; assert(review);
    await controller.confirm(review.id);
    assert.equal(controller.getSnapshot().phase, 'failed', JSON.stringify(controller.getSnapshot()));
    assert.equal(controller.getSnapshot().feeReview, null);
    assert(controller.getSnapshot().error, 'the mounted screen receives the failure');
    assert.equal(device.unsignedTransactions.length, 0); assert.equal(f.submitted.length, 0);
    assert.equal(f.payerSignatures.length, 0); f.assertNoSigningKeys();
    assert.equal(device.sessions.getSnapshot(), null, 'the failed physical request is retired');
    const pending = ((await f.inspectRecovery()).record as {infrastructurePending: readonly NativeInfrastructurePending[]}).infrastructurePending;
    assert.equal(pending.length, 0, 'SDK-proven pre-broadcast failure releases only the exact unsent reservation');
    const before = controller.getSnapshot().revision;
    await controller.refresh(before);
    assert.equal(controller.getSnapshot().phase, 'ready');
    assert(controller.getSnapshot().revision > before, 'Refresh remains usable without reopening the screen');
    await controller.reviewNext(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().phase, 'review');
    assert.notEqual(controller.getSnapshot().feeReview!.id, review.id);
    assert.equal(device.methods.filter(method => method === 'ethereumSignTransaction').length, 1, 'new review never signs automatically');
    assert.equal(f.submitted.length, 0); assert.deepEqual(device.callbackErrors, []);
  } finally {controller?.dispose(); await bundle.close();}
});


test('cancelling a two-owner proof after its first SDK lease clears reuse before another owner or payer', async () => {
  const f = await fixture({}, true); let operation: NativeSmartAccountOperation | undefined;
  try {
    await f.change({ kind: 'create', label: 'Second cancelled owner' });
    await f.change({ kind: 'create-smart', label: 'Cancelled aggregate proof' });
    const owners = f.owner.getCatalogue()!.accounts.filter(account => account.type === 'HDAccount' && account.slip44 === 60);
    f.deployed(); f.fundedSmart(); f.observedEcdsaOwners(owners.map(owner => owner.address), 2);
    operation = await f.runtime.openSmartAccountSend('0x2222222222222222222222222222222222222222', { kind: 'exact', amount: '0.000000000000000009' }, () => undefined, null);
    await operation.prepare(); const reads = f.credentialReads, leases = f.secretLeases;
    f.afterSecretLease(() => { f.afterSecretLease(); f.owner.lock(); });
    await operation.authorize(operation.getSnapshot().revision);
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(f.credentialReads - reads, 1); assert.equal(f.secretLeases - leases, 1);
    assert.equal(f.signatures.length, 1); assert.equal(f.payerSignatures.length, 0); assert.equal(f.submitted.length, 0);
    assert.equal(f.completedSecretLeases, f.secretLeases); f.assertNoSigningKeys();
  } finally { f.afterSecretLease(); await operation?.dispose(); await f.close(); }
});

test('a Ledger prompt between software owners clears the aggregate credential before the next SDK lease', async () => {
  const owned = await readyLedgerSmartOwner(), { f, device } = owned;
  let connection: Awaited<ReturnType<typeof smartMessageApproval>> | undefined;
  try {
    const smart = f.owner.getCatalogue()!.accounts.find(account => account.type === 'SmartAccount')!;
    await f.change({ kind: 'create', label: 'Software owner after Ledger' });
    await f.change({ kind: 'select', id: smart.id });
    const owners = f.owner.getCatalogue()!.accounts.filter(account => account.type === 'HDAccount' && account.slip44 === 60);
    f.observedEcdsaOwners([owners[0]!.address, device.wallets[0]!.address, owners[1]!.address], 3);
    await f.runtime.refreshSmartAccountMetadata(new AbortController().signal, () => undefined);
    await connectLedgerSmart(owned); connection = await smartMessageApproval(f);
    const reads = f.credentialReads, leases = f.secretLeases;
    device.holdSignature(async () => {
      assert.equal(f.credentialReads - reads, 1); assert.equal(f.completedSecretLeases, f.secretLeases); f.assertNoSigningKeys();
    });
    await connection.host.signMessage({ handoff: nonSuiteSigningHandoff, accountId: connection.selected.id, networkId: 'ethereum', approval: connection.approval,
      request: { method: 'personal_sign', address: connection.selected.address, message: 'Fresh software authorization after hardware handoff' } }, null);
    assert.equal(f.credentialReads - reads, 2, 'hardware handoff invalidates the first software credential');
    assert.equal(f.secretLeases - leases, 2); assert.equal(f.completedSecretLeases, f.secretLeases);
    assert.equal(f.signatures.length, 2); assert.equal(device.signatures.length, 1); f.assertNoSigningKeys();
  } finally { connection?.approval.dispose(); await owned.close(); }
});

test('Smart guardian aggregate proof shares one OS read but replacement and payer remain separate approvals', async () => {
  const { f, guardian, owner, payer, open } = await smartGuardianRecoveryFixture(false);
  let controller: Awaited<ReturnType<typeof open>> | undefined;
  try {
    f.smartGuardian(guardian.address, [owner.address, payer.address], { threshold: 2 });
    controller = await open(); await controller.prepare();
    const reads = f.credentialReads, leases = f.secretLeases;
    await controller.review();
    assert.equal(controller.getSnapshot().phase, 'review');
    assert.equal(f.credentialReads - reads, 2, 'replacement and aggregate guardian proofs each require their own OS authorization');
    assert.equal(f.secretLeases - leases, 3, 'the two guardian owners still use separate SDK leases');
    assert.equal(f.completedSecretLeases, f.secretLeases); f.assertNoSigningKeys();
    assert.equal(f.signatures.length, 3);
    f.holdReceipts(); await controller.confirm(controller.getSnapshot().feeReview!.id);
    assert.equal(controller.getSnapshot().phase, 'waiting');
    assert.equal(f.credentialReads - reads, 3, 'the distinct payer consent does not reuse either proof credential');
    assert.equal(f.completedSecretLeases, f.secretLeases); f.assertNoSigningKeys();
    assert.equal(f.submitted.length, 1);
  } finally { await controller?.dispose(); await f.close(); }
});
