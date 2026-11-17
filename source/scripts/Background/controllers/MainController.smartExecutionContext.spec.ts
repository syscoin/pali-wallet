jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { notifyAccountChange: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('./storageManager', () => ({
  StorageManager: {
    getInstance: () => ({ ensureInitialized: async () => undefined }),
  },
}));
jest.mock('utils/evmCallBlacklist', () => ({
  getBlacklistTargetsForEvmCallWithContractType: jest
    .fn()
    .mockResolvedValue([]),
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn().mockResolvedValue(undefined),
  clearTransactionNavigationState: jest.fn().mockResolvedValue(undefined),
}));

import { recoverAddress } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { getController } from '..';
import { defaultAbiCoder, Interface } from '../../../utils/ethersV6Compat';
import * as slhSetup from '../../../utils/slhDsa/smartAccountSetup';
import * as slhState from '../../../utils/slhDsa/state';
import {
  buildSmartAccountUserOperation,
  encodeEcdsaValidatorInitData,
} from '../../../utils/smartAccount/account';
import {
  captureCompositePolicyChange,
  collectCompositePolicyPossession,
  createCompositePolicyPossession,
} from '../../../utils/smartAccount/compositePossession';
import { getPaliModuleAddress } from '../../../utils/smartAccount/contracts';
import { buildCompositeValidatorExecutions } from '../../../utils/smartAccount/moduleCommands';
import { createSmartAccountRawSigningIntent } from '../../../utils/smartAccount/ownerSigningIntent';
import { buildSmartAccountUserOpSigningIntent } from '../../../utils/smartAccount/userOperationHash';
import store from 'state/store';
import { setActiveAccount } from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getBlacklistTargetsForEvmCallWithContractType } from 'utils/evmCallBlacklist';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from 'utils/evmTransactionContext';

import MainController from './MainController';
import SmartAccountController from './smartAccount';

const OWNER_ADDRESS = `0x${'11'.repeat(20)}`;
const SMART_ACCOUNT_ADDRESS = `0x${'22'.repeat(20)}`;
const SIGNING_INTENT = buildSmartAccountUserOpSigningIntent(
  buildSmartAccountUserOperation({
    sender: SMART_ACCOUNT_ADDRESS,
    nonce: '1',
    callData: '0x',
    initCode: '0x',
    accountGasLimits: '0x' + '00'.repeat(32),
    gasFees: '0x' + '00'.repeat(32),
    preVerificationGas: '1',
  }),
  1
);
const ACTION_HASH = SIGNING_INTENT.actionHash;
const EXECUTION_CONTEXT_ID = 'approved-smart-account-operation';

describe('smart-account signing and outer broadcast context', () => {
  let wallet: any;
  let currentState: any;
  let keyring: any;
  let sign: jest.Mock;
  let send: jest.Mock;
  const owner = { id: 0, type: KeyringAccountType.HDAccount };
  const smartAccount = { id: 1, type: KeyringAccountType.SmartAccount };
  const response = {
    hash: `0x${'44'.repeat(32)}`,
    nonce: 7,
    chainId: 1,
  };
  const metadata = {
    smartAccountExecution: true,
    smartAccountExecutionFrom: SMART_ACCOUNT_ADDRESS,
  };

  const documentAuthority = () => ({
    kind: 'document' as const,
    signal: new AbortController().signal,
    assertCurrent() {
      if (wallet.walletSessionGeneration !== 5)
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    },
  });

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation();
    (getBlacklistTargetsForEvmCallWithContractType as jest.Mock)
      .mockReset()
      .mockResolvedValue([]);
    currentState = {
      vault: {
        isBitcoinBased: false,
        activeNetwork: {
          chainId: 1,
          kind: INetworkType.Ethereum,
          url: 'rpc-a',
        },
        activeAccount: smartAccount,
        accounts: {
          HDAccount: { 0: { ...owner, address: OWNER_ADDRESS } },
          SmartAccount: {
            1: { ...smartAccount, address: SMART_ACCOUNT_ADDRESS },
          },
        },
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    jest.spyOn(store, 'getState').mockImplementation(() => currentState);
    sign = jest.fn().mockResolvedValue('owner-signature');
    send = jest.fn().mockResolvedValue(response);
    (getController as jest.Mock).mockReturnValue({
      wallet: {
        ethereumTransaction: {
          ethSign: sign,
          web3Provider: {},
          sendFormattedTransaction: send,
        },
      },
    });
    keyring = {
      isUnlocked: () => true,
      setVaultStateGetter: jest.fn(),
      ethereumTransaction: {
        ethSign: sign,
        web3Provider: {},
        sendFormattedTransaction: send,
      },
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 5;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.sendAndSaveTransaction = jest.fn().mockResolvedValue(undefined);
    wallet.smartAccount = {
      captureOwnerSigningIntent: jest.fn((id) => {
        if (id !== EXECUTION_CONTEXT_ID)
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
        return { intent: SIGNING_INTENT, expiresAt: Date.now() + 300000 };
      }),
      assertSmartAccountPreparedNonce: jest.fn(async () => undefined),
      assertSmartAccountExecutionContext: jest.fn((id, digest) => {
        if (
          id !== EXECUTION_CONTEXT_ID ||
          (digest !== undefined && digest !== ACTION_HASH)
        )
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      }),
      captureCompositeSlhSigningMetadata: jest.fn((id, digest) => {
        wallet.smartAccount.assertSmartAccountExecutionContext(id, digest);
        return undefined;
      }),
    };
  });

  afterEach(() => jest.restoreAllMocks());

  describe('prepared combined approval possession', () => {
    const signer = new Wallet('0x' + '71'.repeat(32));
    const ecdsa = getPaliModuleAddress(1, 'ecdsa');
    const passkey = getPaliModuleAddress(1, 'p256-webauthn');
    const validatorInterface = new Interface([
      'function isValidSignatureWithSender(address sender,bytes32 hash,bytes signature) view returns (bytes4)',
    ]);
    function prepare(
      threshold: number,
      children = [ecdsa, passkey],
      approveFee = true
    ) {
      const value: any = {
        chainId: 1,
        isDeployed: true,
        auth: {
          module: 'ecdsa',
          validator: ecdsa,
          data: encodeEcdsaValidatorInitData([signer.address], 1),
        },
        installedModules: [
          {
            type: 'validator',
            id: 'ecdsa',
            address: ecdsa,
            data: encodeEcdsaValidatorInitData([signer.address], 1),
            config: { owners: [signer.address], threshold: 1 },
          },
          {
            type: 'validator',
            id: 'p256-webauthn',
            address: passkey,
            data: '0x',
            config: {
              publicKey: {
                x: '0x' + '01'.repeat(32),
                y: '0x' + '02'.repeat(32),
              },
            },
          },
        ],
      };
      currentState.vault.accounts.HDAccount[0].address = signer.address;
      Object.assign(currentState.vault.accounts.SmartAccount[1], {
        isSmartAccount: true,
        smartAccount: value,
      });
      const controller: any = new SmartAccountController({
        getEthereumTransaction: () => keyring.ethereumTransaction,
        getWalletSessionGeneration: () => wallet.walletSessionGeneration,
      } as any);
      const executions = buildCompositeValidatorExecutions({
        accountAddress: SMART_ACCOUNT_ADDRESS,
        metadata: value,
        children,
        threshold,
        compositeValidatorAddress: getPaliModuleAddress(1, 'composite'),
        isAlgorithmAvailable: () => true,
      });
      const proposal = captureCompositePolicyChange({
        accountAddress: SMART_ACCOUNT_ADDRESS,
        metadata: value,
        executions,
      })!;
      const expiresAt = Date.now() + 300000;
      const challenge = createCompositePolicyPossession({
        proposal,
        accountAddress: SMART_ACCOUNT_ADDRESS,
        chainId: 1,
        executionContextId: EXECUTION_CONTEXT_ID,
        preparedActionHash: ACTION_HASH,
        expiresAt,
        nonce: '0x' + '89'.repeat(32),
      });
      const call = jest.fn(async (transaction: any) => {
        const [sender, hash, signature] = validatorInterface.decodeFunctionData(
          'isValidSignatureWithSender',
          transaction.data
        );
        let valid = false;
        if (
          transaction.to.toLowerCase() === ecdsa.toLowerCase() &&
          sender === SMART_ACCOUNT_ADDRESS
        ) {
          try {
            valid = recoverAddress(hash, signature) === signer.address;
          } catch {
            /* invalid proof */
          }
        }
        return defaultAbiCoder.encode(
          ['bytes4'],
          [valid ? '0x1626ba7e' : '0xffffffff']
        );
      });
      const context = {
        accountId: 1,
        actionHash: ACTION_HASH,
        purpose: 'user-operation',
        expiresAt,
        entryPointFeeQuote: {
          executionContextId: EXECUTION_CONTEXT_ID,
          feePayer: {
            id: 0,
            type: KeyringAccountType.HDAccount,
            address: signer.address,
          },
          gasUnits: '1',
          maximumFeeWei: '0',
        },
        entryPointFeeApproved: false,
        entryPointFeeConsumed: false,
        snapshot: controller.infrastructureContext(),
        userOperation: buildSmartAccountUserOperation({
          sender: SMART_ACCOUNT_ADDRESS,
          nonce: '1',
          callData: '0x',
          initCode: '0x',
          accountGasLimits: '0x' + '00'.repeat(32),
          gasFees: '0x' + '00'.repeat(32),
          preVerificationGas: '1',
        }),
        pending: {
          withReadPhase: async (work: any) => work({ provider: { call } }),
        },
        compositePossession: {
          proposal,
          challenge,
          proofs: new Map(),
          accepted: false,
          sourceMetadata: JSON.stringify({
            auth: value.auth,
            installedModules: value.installedModules,
          }),
        },
      };
      controller.executionContexts.set(EXECUTION_CONTEXT_ID, context);
      jest
        .spyOn(controller, 'assertSmartAccountPreparedNonce')
        .mockResolvedValue(undefined);
      wallet.smartAccount = controller;
      if (approveFee)
        wallet.approveSmartAccountExecutionFeeQuote(
          EXECUTION_CONTEXT_ID,
          context.entryPointFeeQuote,
          documentAuthority()
        );
      return {
        controller,
        context,
        challenge,
        call,
        value,
        signature: signer.signingKey.sign(challenge.intent.actionHash)
          .serialized,
      };
    }

    it('requires explicit exact EntryPoint fee consent before proposed signing and refuses changed or consumed quotes', async () => {
      const fixture = prepare(1, [ecdsa], false),
        quote = fixture.context.entryPointFeeQuote;
      await expect(
        wallet.signSmartAccountCompositeOwner(
          EXECUTION_CONTEXT_ID,
          owner,
          documentAuthority()
        )
      ).rejects.toThrow('Approve the Smart account fee');
      for (const changed of [
        { ...quote, maximumFeeWei: '100000000000000000000' },
        { ...quote, gasUnits: '2' },
        { ...quote, feePayer: { ...quote.feePayer, address: OWNER_ADDRESS } },
        { ...quote, executionContextId: 'another-operation' },
      ])
        expect(() =>
          wallet.approveSmartAccountExecutionFeeQuote(
            EXECUTION_CONTEXT_ID,
            changed,
            documentAuthority()
          )
        ).toThrow('fee quote changed');
      expect(sign).not.toHaveBeenCalled();
      wallet.approveSmartAccountExecutionFeeQuote(
        EXECUTION_CONTEXT_ID,
        quote,
        documentAuthority()
      );
      await expect(
        wallet.signSmartAccountCompositeOwner(
          EXECUTION_CONTEXT_ID,
          owner,
          documentAuthority()
        )
      ).resolves.toBe('owner-signature');
      fixture.context.entryPointFeeConsumed = true;
      expect(() =>
        wallet.approveSmartAccountExecutionFeeQuote(
          EXECUTION_CONTEXT_ID,
          quote,
          documentAuthority()
        )
      ).toThrow('fee quote changed');
      await expect(
        wallet.signSmartAccountCompositeOwner(
          EXECUTION_CONTEXT_ID,
          owner,
          documentAuthority()
        )
      ).rejects.toThrow('Approve the Smart account fee');
    });

    it.each([1, 2])(
      'does not release current-policy signing or submission after unavailable passkey proof at threshold %i',
      async (threshold) => {
        const fixture = prepare(
          threshold,
          threshold === 1 ? [passkey] : [ecdsa, passkey]
        );
        const signatures =
          threshold === 1 ? ['0xdead'] : [fixture.signature, '0xdead'];
        const result = await wallet.verifySmartAccountCompositePossession(
          EXECUTION_CONTEXT_ID,
          signatures,
          documentAuthority()
        );
        expect(result.satisfied).toBe(false);
        await expect(
          wallet.signSmartAccountPreparedOwner(
            EXECUTION_CONTEXT_ID,
            owner,
            documentAuthority()
          )
        ).rejects.toThrow('Prove the proposed');
        await expect(
          fixture.controller.submitSmartAccountExecution(
            { executionContextId: EXECUTION_CONTEXT_ID },
            () => undefined
          )
        ).rejects.toThrow('Prove the proposed');
        expect(sign).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(fixture.context.compositePossession.accepted).toBe(false);
      }
    );

    it('accepts a sufficient actual ECDSA child proof, memoizes it, and only then releases a different transaction digest', async () => {
      const fixture = prepare(1);
      expect(fixture.challenge.intent.actionHash).not.toBe(ACTION_HASH);
      await expect(
        wallet.signSmartAccountCompositeOwner(
          EXECUTION_CONTEXT_ID,
          owner,
          documentAuthority()
        )
      ).resolves.toBe('owner-signature');
      expect(sign).toHaveBeenLastCalledWith(
        [signer.address, fixture.challenge.intent.actionHash],
        expect.any(Object)
      );
      sign.mockClear();
      const vector = [fixture.signature, '0x'];
      await expect(
        wallet.verifySmartAccountCompositePossession(
          EXECUTION_CONTEXT_ID,
          vector,
          documentAuthority()
        )
      ).resolves.toMatchObject({ satisfied: true, threshold: 1 });
      await wallet.verifySmartAccountCompositePossession(
        EXECUTION_CONTEXT_ID,
        vector,
        documentAuthority()
      );
      expect(fixture.call).toHaveBeenCalledTimes(1);
      await wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        owner,
        documentAuthority()
      );
      expect(sign).toHaveBeenLastCalledWith(
        [signer.address, ACTION_HASH],
        expect.any(Object)
      );
    });

    it('rejects a transaction authorization signature offered as a possession proof', async () => {
      const fixture = prepare(1, [ecdsa]);
      const signature = signer.signingKey.sign(ACTION_HASH).serialized;
      await expect(
        wallet.verifySmartAccountCompositePossession(
          EXECUTION_CONTEXT_ID,
          [signature],
          documentAuthority()
        )
      ).resolves.toMatchObject({ satisfied: false });
      expect(
        fixture.controller.getSmartAccountCompositePossession(
          EXECUTION_CONTEXT_ID
        ).intent.actionHash
      ).toBe(fixture.challenge.intent.actionHash);
      expect(() =>
        fixture.controller.captureOwnerSigningIntent(EXECUTION_CONTEXT_ID)
      ).toThrow('Prove the proposed');
    });

    it('joins concurrent verification of the same child without a duplicate physical contract read', async () => {
      const fixture = prepare(1, [ecdsa]);
      const original = fixture.call.getMockImplementation()!;
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      fixture.call.mockImplementation(async (transaction) => {
        entered();
        await held;
        return original(transaction);
      });
      const first = wallet.verifySmartAccountCompositePossession(
        EXECUTION_CONTEXT_ID,
        [fixture.signature],
        documentAuthority()
      );
      await started;
      const second = wallet.verifySmartAccountCompositePossession(
        EXECUTION_CONTEXT_ID,
        [fixture.signature],
        documentAuthority()
      );
      release();
      await expect(Promise.all([first, second])).resolves.toEqual([
        expect.objectContaining({ satisfied: true }),
        expect.objectContaining({ satisfied: true }),
      ]);
      expect(fixture.call).toHaveBeenCalledTimes(1);
    });

    it('does not cache an apparently valid child when final canonical phase validation fails', async () => {
      const fixture = prepare(1, [ecdsa]);
      let failFinalCheck = true;
      fixture.context.pending.withReadPhase = async (work: any) => {
        const result = await work({ provider: { call: fixture.call } });
        if (failFinalCheck) throw new Error('canonical block changed');
        return result;
      };
      await expect(
        wallet.verifySmartAccountCompositePossession(
          EXECUTION_CONTEXT_ID,
          [fixture.signature],
          documentAuthority()
        )
      ).rejects.toThrow('canonical block changed');
      expect(fixture.context.compositePossession.proofs.size).toBe(0);
      expect(fixture.context.compositePossession.accepted).toBe(false);
      failFinalCheck = false;
      fixture.call.mockResolvedValueOnce(
        defaultAbiCoder.encode(['bytes4'], ['0xffffffff'])
      );
      await expect(
        wallet.verifySmartAccountCompositePossession(
          EXECUTION_CONTEXT_ID,
          [fixture.signature],
          documentAuthority()
        )
      ).resolves.toMatchObject({ satisfied: false });
      expect(fixture.call).toHaveBeenCalledTimes(2);
    });

    it('aborts collection on a transport failure, publishes no proof cache, and permits a healthy retry', async () => {
      const fixture = prepare(1),
        original = fixture.call.getMockImplementation()!;
      fixture.call.mockRejectedValueOnce(new Error('invalid UTF-8 response'));
      const proposedSigner = jest.fn(async () => fixture.signature);
      await expect(
        collectCompositePolicyPossession({
          proposal: fixture.context.compositePossession.proposal,
          assertCurrent: () => undefined,
          sign: proposedSigner,
          verify: (signatures) =>
            wallet.verifySmartAccountCompositePossession(
              EXECUTION_CONTEXT_ID,
              signatures,
              documentAuthority()
            ),
        })
      ).rejects.toThrow('invalid UTF-8 response');
      expect(proposedSigner).toHaveBeenCalledTimes(1);
      expect(fixture.context.compositePossession.proofs.size).toBe(0);
      expect(fixture.context.compositePossession.accepted).toBe(false);
      expect(sign).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      fixture.call.mockImplementation(original);
      await expect(
        wallet.verifySmartAccountCompositePossession(
          EXECUTION_CONTEXT_ID,
          [fixture.signature, '0x'],
          documentAuthority()
        )
      ).resolves.toMatchObject({ satisfied: true });
      expect(fixture.call).toHaveBeenCalledTimes(2);
    });

    it.each(['nonce changed', 'insufficient Smart account balance'])(
      'keeps fresh transaction admission after possession when %s',
      async (reason) => {
        const fixture = prepare(1, [ecdsa]);
        await wallet.signSmartAccountCompositeOwner(
          EXECUTION_CONTEXT_ID,
          owner,
          documentAuthority()
        );
        expect(
          fixture.controller.assertSmartAccountPreparedNonce
        ).not.toHaveBeenCalled();
        await wallet.verifySmartAccountCompositePossession(
          EXECUTION_CONTEXT_ID,
          [fixture.signature],
          documentAuthority()
        );
        sign.mockClear();
        fixture.controller.assertSmartAccountPreparedNonce.mockRejectedValueOnce(
          new Error(reason)
        );
        await expect(
          wallet.signSmartAccountPreparedOwner(
            EXECUTION_CONTEXT_ID,
            owner,
            documentAuthority()
          )
        ).rejects.toThrow(reason);
        expect(
          fixture.controller.assertSmartAccountPreparedNonce
        ).toHaveBeenCalledTimes(1);
        expect(sign).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
      }
    );

    it('rejects metadata changes and retired documents while validation is pending, without opening transaction signing', async () => {
      const fixture = prepare(1);
      const authority = documentAuthority();
      fixture.call.mockImplementationOnce(async () => {
        fixture.value.auth.data = '0x00';
        return defaultAbiCoder.encode(['bytes4'], ['0x1626ba7e']);
      });
      await expect(
        wallet.verifySmartAccountCompositePossession(
          EXECUTION_CONTEXT_ID,
          [fixture.signature, '0x'],
          authority
        )
      ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
      expect(fixture.context.compositePossession.accepted).toBe(false);
      const next = prepare(1);
      const lifetime = new AbortController();
      next.call.mockImplementationOnce(async () => {
        lifetime.abort();
        return defaultAbiCoder.encode(['bytes4'], ['0x1626ba7e']);
      });
      await expect(
        wallet.verifySmartAccountCompositePossession(
          EXECUTION_CONTEXT_ID,
          [next.signature, '0x'],
          { ...documentAuthority(), signal: lifetime.signal }
        )
      ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
      expect(next.context.compositePossession.accepted).toBe(false);
      expect(sign).not.toHaveBeenCalled();
    });

    it('refuses expired contexts and unrelated local owners before a possession signature or validation read', async () => {
      const fixture = prepare(1);
      currentState.vault.accounts.HDAccount[2] = {
        id: 2,
        type: KeyringAccountType.HDAccount,
        address: OWNER_ADDRESS,
      };
      await expect(
        wallet.signSmartAccountCompositeOwner(
          EXECUTION_CONTEXT_ID,
          { id: 2, type: KeyringAccountType.HDAccount },
          documentAuthority()
        )
      ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
      fixture.context.expiresAt = Date.now() - 1;
      await expect(
        wallet.verifySmartAccountCompositePossession(
          EXECUTION_CONTEXT_ID,
          [fixture.signature, '0x'],
          documentAuthority()
        )
      ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
      expect(sign).not.toHaveBeenCalled();
      expect(fixture.call).not.toHaveBeenCalled();
    });

    it('classifies only missing encrypted composite state as an optional unavailable SLH child', async () => {
      prepare(1);
      const load = jest
        .spyOn(slhState, 'loadEncryptedSLHDSAState')
        .mockResolvedValue(null);
      const setup = jest
        .spyOn(slhSetup, 'getSLHDSASmartAccountSetupStatus')
        .mockResolvedValue(null);
      wallet.getSLHDSASessionStateCrypto = jest.fn(() => ({}));
      const slh = getPaliModuleAddress(1, 'slh-dsa'),
        composite = getPaliModuleAddress(1, 'composite');
      const proposed: any = {
        chainId: 1,
        auth: { module: 'composite', validator: composite, data: '0x' },
        installedModules: [
          {
            type: 'validator',
            id: 'slh-dsa',
            address: slh,
            config: { keyId: 'configured-key' },
          },
          {
            type: 'validator',
            id: 'composite',
            address: composite,
            config: { childValidators: [slh], threshold: 1 },
          },
        ],
      };
      const request = {
        accountId: 1,
        actionHash: '0x' + '38'.repeat(32),
        keyId: 'configured-key',
      };
      await expect(
        wallet.hydrateActiveSLHDSAStateForSigning(request, 0, proposed)
      ).rejects.toMatchObject({
        code: 'COMPOSITE_CHILD_UNAVAILABLE',
        transactionNotBroadcast: true,
      });
      load.mockRejectedValueOnce(new Error('corrupt encrypted signer'));
      await expect(
        wallet.hydrateActiveSLHDSAStateForSigning(request, 0, proposed)
      ).rejects.toEqual(new Error('corrupt encrypted signer'));
      setup.mockResolvedValueOnce({
        config: { keyId: 'different-local-key' },
      } as any);
      await expect(
        wallet.hydrateActiveSLHDSAStateForSigning(request, 0, proposed)
      ).rejects.not.toHaveProperty('code');
      currentState.vault.accounts.SmartAccount[1].smartAccount = proposed;
      await expect(
        wallet.hydrateActiveSLHDSAStateForSigning(request, 0)
      ).rejects.toMatchObject({
        code: 'COMPOSITE_CHILD_UNAVAILABLE',
        transactionNotBroadcast: true,
      });
      currentState.vault.accounts.SmartAccount[1].smartAccount = {
        ...proposed,
        auth: { module: 'slh-dsa', validator: slh, data: '0x' },
      };
      await expect(
        wallet.hydrateActiveSLHDSAStateForSigning(request, 0)
      ).rejects.not.toHaveProperty('code');
    });
  });

  it('rejects a stale prepared nonce before starting the SLH signing path', async () => {
    wallet.configureSLHDSASessionStateCrypto = jest.fn();
    wallet.smartAccount.assertSmartAccountPreparedNonce.mockRejectedValueOnce(
      new Error('nonce changed')
    );
    await expect(
      wallet.signSLHDSAActionHash({
        actionHash: ACTION_HASH,
        executionContextId: EXECUTION_CONTEXT_ID,
      })
    ).rejects.toThrow('nonce changed');
    expect(wallet.configureSLHDSASessionStateCrypto).not.toHaveBeenCalled();
  });

  it('checks the bound action digest before signing and before exposing the result', async () => {
    await expect(
      wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        owner,
        documentAuthority()
      )
    ).resolves.toBe('owner-signature');
    expect(sign).toHaveBeenCalledWith([OWNER_ADDRESS, ACTION_HASH], {
      selectedAccount: {
        ...smartAccount,
        expectedAddress: SMART_ACCOUNT_ADDRESS,
      },
      targetAccount: { ...owner, expectedAddress: OWNER_ADDRESS },
      assertCurrent: expect.any(Function),
      signal: expect.any(AbortSignal),
    });
    const assertContext =
      wallet.smartAccount.assertSmartAccountExecutionContext;
    expect(assertContext.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(assertContext.mock.calls[0].slice(0, 2)).toEqual([
      EXECUTION_CONTEXT_ID,
      ACTION_HASH,
    ]);
    expect(assertContext.mock.calls.at(-1).slice(0, 2)).toEqual([
      EXECUTION_CONTEXT_ID,
      ACTION_HASH,
    ]);
    expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
  });

  it.each(['stale-token', undefined, [OWNER_ADDRESS, ACTION_HASH]])(
    'rejects invalid prepared context %j before SDK signing',
    async (contextId) => {
      await expect(
        wallet.signSmartAccountPreparedOwner(
          contextId,
          owner,
          documentAuthority()
        )
      ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
      expect(sign).not.toHaveBeenCalled();
    }
  );

  it('rejects old arity or a renderer digest in place of actual document authority', async () => {
    for (const authority of [undefined, null, `0x${'55'.repeat(32)}`]) {
      await expect(
        wallet.signSmartAccountPreparedOwner(
          EXECUTION_CONTEXT_ID,
          owner,
          authority
        )
      ).rejects.toThrow('Owned document authority');
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it.each(['address', 'xpub'])(
    'pins owner %s through the prepared nonce wait before SDK dispatch',
    async (field) => {
      let finish!: () => void, entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      wallet.smartAccount.assertSmartAccountPreparedNonce.mockImplementationOnce(
        () => {
          entered();
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        }
      );
      const pending = wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        owner,
        documentAuthority()
      );
      const rejected = expect(pending).rejects.toThrow(
        EVM_TRANSACTION_CONTEXT_CHANGED
      );
      await started;
      currentState.vault.accounts.HDAccount[0] = {
        ...currentState.vault.accounts.HDAccount[0],
        [field]: field === 'address' ? '0x' + '99'.repeat(20) : 'new-xpub',
      };
      finish();
      await rejected;
      expect(sign).not.toHaveBeenCalled();
    }
  );

  it('keeps metadata-only owner replacement healthy during nonce validation', async () => {
    wallet.smartAccount.assertSmartAccountPreparedNonce.mockImplementationOnce(
      async () => {
        currentState.vault.accounts.HDAccount[0] = {
          ...currentState.vault.accounts.HDAccount[0],
          label: 'New label',
          balances: { ethereum: '9' },
        };
      }
    );
    await expect(
      wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        owner,
        documentAuthority()
      )
    ).resolves.toBe('owner-signature');
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('suppresses a completed signature when the wallet context changed while signing', async () => {
    let finishSigning!: (value: string) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    sign.mockImplementation(() => {
      entered();
      return new Promise((resolve) => (finishSigning = resolve));
    });
    const signing = wallet.signSmartAccountPreparedOwner(
      EXECUTION_CONTEXT_ID,
      owner,
      documentAuthority()
    );
    await started;
    wallet.smartAccount.assertSmartAccountExecutionContext.mockImplementation(
      () => {
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      }
    );
    finishSigning('owner-signature');
    await expect(signing).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
  });

  it('rejects a context change at the explicitly bound owner SDK boundary', async () => {
    wallet.smartAccount.assertSmartAccountExecutionContext.mockImplementation(
      () => {
        if (currentState.vault.activeNetwork.url !== 'rpc-a')
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      }
    );
    sign.mockImplementationOnce(async (_params, options) => {
      currentState.vault.activeNetwork.url = 'rpc-b';
      options.assertCurrent();
      return 'unreachable';
    });
    await expect(
      wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        owner,
        documentAuthority()
      )
    ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it.each(['network metadata', 'SDK owner', 'wallet session'])(
    'rejects %s changes at the exact SDK return boundary',
    async (axis) => {
      sign.mockImplementationOnce(async () => {
        if (axis === 'network metadata')
          currentState.vault.activeNetwork = {
            ...currentState.vault.activeNetwork,
            currency: 'CHANGED',
          };
        else if (axis === 'SDK owner')
          wallet.getActiveKeyring.mockReturnValue({ ...keyring });
        else wallet.walletSessionGeneration++;
        return 'late-signature';
      });
      await expect(
        wallet.signSmartAccountPreparedOwner(
          EXECUTION_CONTEXT_ID,
          owner,
          documentAuthority()
        )
      ).rejects.toThrow();
      expect(sign).toHaveBeenCalledTimes(1);
    }
  );

  it('checks the personal-sign approval again at the actual smart owner SDK invocation', async () => {
    let approvalCurrent = true;
    const assertApproval = () => {
      if (!approvalCurrent) throw new Error('Approval retired');
    };
    sign.mockImplementationOnce(async (_params, options) => {
      approvalCurrent = false;
      options.assertCurrent();
      return 'unreachable';
    });
    await expect(
      wallet.signSmartAccountMessageOwnerInternal(SIGNING_INTENT, owner, {
        assertCurrent: assertApproval,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('Approval retired');
    expect(sign).toHaveBeenCalledTimes(1);
    expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
  });

  it.each([
    ['resolved Promise', () => Promise.resolve()],
    ['rejected Promise', () => Promise.reject(new Error('Retired approval'))],
    ['nonvoid result', () => true],
  ])(
    'rejects a %s approval guard before invoking the SDK',
    async (_name, guard) => {
      await expect(
        wallet.signSmartAccountOperationOwnerInternal(
          EXECUTION_CONTEXT_ID,
          owner,
          guard
        )
      ).rejects.toThrow('EVM fee approval guard must be synchronous');
      expect(sign).not.toHaveBeenCalled();
      expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
    }
  );

  it('preserves software recovery only through its private prepared context and rejects hardware before SDK', async () => {
    wallet.smartAccount.captureOwnerSigningIntent.mockReturnValue({
      intent: createSmartAccountRawSigningIntent(
        'recovery',
        ACTION_HASH,
        'recovery-digest'
      ),
      expiresAt: Date.now() + 300000,
    });
    await expect(
      wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        owner,
        documentAuthority()
      )
    ).resolves.toBe('owner-signature');
    sign.mockClear();
    await expect(
      wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        {
          ...owner,
          type: KeyringAccountType.Ledger,
        },
        documentAuthority()
      )
    ).rejects.toThrow('software owner');
    expect(sign).not.toHaveBeenCalled();
  });

  const contextGuard = () => {
    if (
      currentState.vault.activeNetwork.url !== 'rpc-a' ||
      currentState.vault.activeAccount.id !== smartAccount.id ||
      wallet.walletSessionGeneration !== 5
    )
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
  };

  it('refuses a Smart outer send without the shared payer fee approval', async () => {
    await expect(
      wallet.sendAndSaveEthTransaction(
        { chainId: 1, value: '0x0' },
        false,
        owner,
        metadata,
        {
          assertCurrentContext: contextGuard,
          assertPendingState: async () => undefined,
        }
      )
    ).rejects.toMatchObject({
      message: 'Smart account payer approval is required',
      transactionNotBroadcast: true,
    });
    expect(send).not.toHaveBeenCalled();
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });

  describe('public account-switch session invalidation', () => {
    beforeEach(() => {
      currentState.vault.accounts.SmartAccount[1].smartAccount = { chainId: 1 };
      currentState.vault.accounts.SmartAccount[2] = {
        id: 2,
        type: KeyringAccountType.SmartAccount,
        address: `0x${'66'.repeat(20)}`,
        smartAccount: { chainId: 1 },
      };
      jest.spyOn(store, 'dispatch').mockImplementation((action: any) => {
        if (action.type === setActiveAccount.type)
          currentState.vault.activeAccount = action.payload;
        return action;
      });
      wallet.stopAllRapidPolling = jest.fn();
      wallet.cancellablePromises = {};
      wallet.assetUpdateRequestId = 0;
      wallet.cancelActiveBalanceUpdate = jest.fn();
      wallet.resetAutoLockTimer = jest.fn();
      wallet.performPostAccountSwitchOperations = jest
        .fn()
        .mockResolvedValue(undefined);
    });

    it('preserves the session when the public setter selects the same account', async () => {
      await wallet.setAccount(1, KeyringAccountType.SmartAccount);
      expect(wallet.getWalletSessionGeneration()).toBe(5);
      expect(currentState.vault.activeAccount).toEqual(smartAccount);
    });

    it('cannot revive the original approval session by switching A to B and back to A', async () => {
      const expectedContext = {
        account: { ...smartAccount, address: SMART_ACCOUNT_ADDRESS },
        chainId: 1,
        rpcUrl: 'rpc-a',
        sessionGeneration: wallet.getWalletSessionGeneration(),
        slip44: 60,
      };
      await wallet.setAccount(2, KeyringAccountType.SmartAccount);
      expect(wallet.getWalletSessionGeneration()).toBe(6);
      await wallet.setAccount(1, KeyringAccountType.SmartAccount);
      expect(wallet.getWalletSessionGeneration()).toBe(7);
      expect(currentState.vault.activeAccount).toEqual(smartAccount);

      const getEthereumTransaction = jest.fn();
      const smartController = new SmartAccountController({
        captureSmartAccountPendingRecords: async () => ({
          profileId: '0x' + '11'.repeat(32),
          read: async () => [],
        }),
        getEthereumTransaction,
        getWalletSessionGeneration: () => wallet.getWalletSessionGeneration(),
      } as any);
      await expect(
        smartController.prepareSmartAccountExecutions(
          [{ data: '0x', target: OWNER_ADDRESS, value: '0x0' }],
          1,
          { expectedContext }
        )
      ).rejects.toMatchObject({
        message: EVM_TRANSACTION_CONTEXT_CHANGED,
        transactionNotBroadcast: true,
      });
      expect(getEthereumTransaction).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  });
});
