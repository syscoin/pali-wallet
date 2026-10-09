jest.mock('state/store', () => ({
  __esModule: true,
  default: { dispatch: jest.fn(), getState: jest.fn() },
}));
jest.mock('state/vault', () => ({ setAccountPropertyByIdAndType: jest.fn() }));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));
jest.mock('utils/ethersV6Compat', () => ({
  ...jest.requireActual('utils/ethersV6Compat'),
  Contract: jest.fn(),
}));
jest.mock('utils/smartAccount', () => ({
  ...jest.requireActual('utils/smartAccount'),
  estimateSmartAccountUserOpGas: jest.fn(),
}));

import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum';
import { Transaction } from 'ethers/transaction';
import { recoverAddress } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { Contract, Interface } from 'utils/ethersV6Compat';
import {
  encodeEcdsaValidatorInitData,
  estimateSmartAccountUserOpGas,
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  signSmartAccountActionHash,
} from 'utils/smartAccount';

import SmartAccountController from './index';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const INTENDED_TARGET = '0x2222222222222222222222222222222222222222';
const ATTACKER = '0x3333333333333333333333333333333333333333';
const VALIDATOR = '0x4444444444444444444444444444444444444444';
const PRIVATE_KEY = `0x${'11'.repeat(32)}`; // Deliberately public synthetic key.
const owner = new Wallet(PRIVATE_KEY);
const gasPayer = {
  address: owner.address,
  id: 0,
  type: KeyringAccountType.HDAccount,
};
const metadata = {
  auth: {
    data: encodeEcdsaValidatorInitData([owner.address], 1),
    module: 'ecdsa',
    validator: VALIDATOR,
  },
  chainId: 1,
  deploymentSalt: `0x${'00'.repeat(32)}`,
  installedModules: [
    {
      address: VALIDATOR,
      config: { owners: [owner.address], threshold: 1 },
      data: encodeEcdsaValidatorInitData([owner.address], 1),
      id: 'ecdsa',
      type: 'validator',
    },
  ],
  isDeployed: true,
};

describe('smart-account owner signing intent', () => {
  it.each([KeyringAccountType.HDAccount, KeyringAccountType.Imported])(
    'does not let a malicious RPC authorize an unrelated owner EOA transaction (%s)',
    async (ownerType) => {
      const unrelatedTransaction = Transaction.from({
        chainId: 1,
        gasLimit: 21000,
        maxFeePerGas: 1000000000,
        maxPriorityFeePerGas: 1,
        nonce: 0,
        to: ATTACKER,
        type: 2,
        value: '1000000000000000000',
      });
      const getUserOpHash = jest
        .fn()
        .mockResolvedValue(unrelatedTransaction.unsignedHash);
      (Contract as unknown as jest.Mock).mockImplementation(
        (_address, abi) => ({
          getNonce: jest.fn().mockResolvedValue('0'),
          getUserOpHash,
          interface: Interface.from(abi),
        })
      );
      (estimateSmartAccountUserOpGas as jest.Mock).mockResolvedValue({
        callGasLimit: 100000,
        preVerificationGas: 50000,
        totalGasUnits: 300000,
        verificationGasLimit: 150000,
      });
      const provider = {
        estimateGas: jest
          .fn()
          .mockRejectedValue(new Error('malicious RPC rejects')),
        getFeeData: jest.fn().mockResolvedValue({
          maxFeePerGas: 1000000000,
          maxPriorityFeePerGas: 1,
        }),
      };
      const send = jest.fn();
      const ethereumTransaction = { web3Provider: provider };
      (store.getState as jest.Mock).mockReturnValue({
        vault: {
          accounts: { SmartAccount: { 7: { address: ACCOUNT } } },
          activeAccount: { id: 7, type: KeyringAccountType.SmartAccount },
          activeNetwork: {
            chainId: 1,
            kind: INetworkType.Ethereum,
            url: 'https://malicious-rpc.example',
          },
          isBitcoinBased: false,
        },
        vaultGlobal: { activeSlip44: 60 },
      });
      const controller: any = new SmartAccountController({
        getEthereumTransaction: () => ethereumTransaction,
        sendAndSaveEthTransaction: send,
      } as any);
      const active = { account: { address: ACCOUNT, id: 7 }, metadata };
      controller.assertSmartAccountExecutionTargetsAllowed = jest.fn();
      controller.getSmartAccountById = jest.fn(() => active);
      controller.getWalletGasPayerCandidates = jest.fn(() => []);
      controller.getWalletGasPayerAccount = jest
        .fn()
        .mockResolvedValue(gasPayer);
      controller.getLocalNativeExecutionRecipients = jest.fn(() => []);
      const prepared = await controller.prepareSmartAccountExecutions(
        [{ data: '0x', target: INTENDED_TARGET, value: '0x0' }],
        7
      );

      // Exercise the published sysweb3 ethSign implementation and the actual
      // Pali ECDSA authenticator driver. RPC/host state are the modeled edges.
      const signer = new EthereumTransactions(
        () => ({ chainId: 1 } as any),
        () => ({ address: owner.address, decryptedPrivateKey: PRIVATE_KEY }),
        () =>
          ({
            accounts: { [ownerType]: { 0: { address: owner.address } } },
            activeAccountId: 0,
            activeAccountType: ownerType,
            activeNetwork: { chainId: 1 },
          } as any),
        {} as any,
        {} as any
      );
      const signature = await signSmartAccountActionHash({
        accountId: 7,
        actionHash: prepared.actionHash,
        authenticatorContexts: {
          ecdsa: {
            localOwners: [{ address: owner.address, id: 0, type: ownerType }],
            signActionHash: ({ actionHash }) =>
              signer.ethSign([owner.address, actionHash]),
          },
        },
        smartAccount: metadata as any,
      });
      await expect(
        controller.submitSmartAccountExecution({
          accountId: 7,
          executionContextId: prepared.executionContextId,
          executions: prepared.executions,
          gasPayer: prepared.gasPayer,
          signature: signature.signature,
          userOperation: prepared.userOperation,
        })
      ).rejects.toThrow('malicious RPC rejects');

      expect(recoverAddress(prepared.actionHash, signature.signature)).toBe(
        owner.address
      );
      const disclosed = paliEntryPointInterface.decodeFunctionData(
        'handleOps',
        provider.estimateGas.mock.calls[0][0].data
      )[0][0];
      expect(disclosed.sender).toBe(ACCOUNT);
      expect(disclosed.signature).toBe(signature.signature);
      expect(provider.estimateGas.mock.calls[0][0].to).toBe(
        getPaliEntryPointAddress(1)
      );
      unrelatedTransaction.signature = disclosed.signature;
      expect(Transaction.from(unrelatedTransaction.serialized).from).not.toBe(
        owner.address
      );
      expect(send).not.toHaveBeenCalled();
      expect(prepared.actionHash).not.toBe(unrelatedTransaction.unsignedHash);
      expect(getUserOpHash).not.toHaveBeenCalled();
    }
  );
});
