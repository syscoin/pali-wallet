jest.mock('state/store', () => ({
  __esModule: true,
  default: { dispatch: jest.fn(), getState: jest.fn() },
}));
jest.mock('state/vault', () => ({ setAccountPropertyByIdAndType: jest.fn() }));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));

import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import { BigNumber } from 'utils/ethersV6Compat';
import {
  ERC7579_MODE_SINGLE_DEFAULT,
  getConfiguredAuthenticatorAddress,
  getSmartAccountGuardianRecoveryHash,
  paliGuardianRecoveryModuleInterface,
} from 'utils/smartAccount';

import SmartAccountController from './index';

const TARGET = `0x${'11'.repeat(20)}`;
const GUARDIAN = `0x${'22'.repeat(20)}`;
const PAYER = `0x${'33'.repeat(20)}`;
const SECOND_PAYER = `0x${'44'.repeat(20)}`;
const MODULE = getConfiguredAuthenticatorAddress(57057, 'guardian-recovery');
const SIGNATURE = '0x1234';
const intent = {
  account: TARGET,
  chainId: 57057,
  executionCalldata: '0x1234',
  mode: ERC7579_MODE_SINGLE_DEFAULT,
  policyEpoch: '7',
  recoveryModule: MODULE,
  salt: `0x${'00'.repeat(32)}`,
};
const operation = {
  ...intent,
  hash: getSmartAccountGuardianRecoveryHash(intent),
};

describe('guardian recovery provider numeric boundaries', () => {
  let controller: SmartAccountController;
  let provider: any;
  let send: jest.Mock;
  let state: any;

  const submit = () =>
    controller.submitPreparedSmartAccountGuardianStartRecovery({
      account: TARGET,
      approval: { guardian: GUARDIAN, signature: SIGNATURE },
      guardian: GUARDIAN,
      operation,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    state = {
      vault: {
        activeAccount: { id: 3, type: KeyringAccountType.SmartAccount },
        activeNetwork: { chainId: 57057 },
        accounts: {
          [KeyringAccountType.HDAccount]: { 0: { address: PAYER, id: 0 } },
          [KeyringAccountType.Imported]: {},
        },
      },
    };
    (store.getState as jest.Mock).mockImplementation(() => state);
    // The live SDK provider returns a native bigint balance; gas estimates
    // can be SDK-compat BigNumbers or native ethers-v6 bigints.
    provider = {
      estimateGas: jest.fn().mockResolvedValue(BigNumber.from(21000)),
      getBalance: jest.fn().mockResolvedValue(BigInt(42000)),
      getFeeData: jest.fn().mockResolvedValue({ maxFeePerGas: BigInt(2) }),
    };
    send = jest.fn().mockResolvedValue({ hash: `0x${'55'.repeat(32)}` });
    controller = new SmartAccountController({
      getEthereumTransaction: () => ({ web3Provider: provider }),
      sendAndSaveEthTransaction: send,
    } as any);
    jest
      .spyOn(controller, 'validateSmartAccountGuardianRecoveryOperation')
      .mockResolvedValue();
  });

  it('submits the unchanged approved recovery with a single bigint balance at the exact fee boundary', async () => {
    await expect(submit()).resolves.toMatchObject({ operation });
    expect(provider.getBalance).toHaveBeenCalledWith(PAYER);
    expect(send).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0][0];
    const decoded = paliGuardianRecoveryModuleInterface.decodeFunctionData(
      'scheduleRecovery',
      request.data
    );
    expect(decoded[0]).toBe(TARGET);
    expect(decoded[4][0].guardian).toBe(GUARDIAN);
    expect(decoded[4][0].signature).toBe(SIGNATURE);
    expect(send.mock.calls[0][2]).toEqual({
      address: PAYER,
      id: 0,
      type: KeyringAccountType.HDAccount,
    });
  });

  it('accepts native ethers-v6 bigint gas estimates as well as balances', async () => {
    provider.estimateGas.mockResolvedValue(BigInt(21000));
    await expect(submit()).resolves.toMatchObject({ operation });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('normalizes individual bigint balances after a batched-read failure and selects the funded payer', async () => {
    state.vault.accounts[KeyringAccountType.Imported][0] = {
      address: SECOND_PAYER,
      id: 0,
    };
    provider.sendBatch = jest
      .fn()
      .mockRejectedValue(new Error('batch unavailable'));
    provider.getBalance.mockImplementation(async (address: string) =>
      BigInt(address === PAYER ? 41999 : 42000)
    );
    await expect(submit()).resolves.toMatchObject({ operation });
    expect(provider.sendBatch).toHaveBeenCalledWith('eth_getBalance', [
      [PAYER, 'latest'],
      [SECOND_PAYER, 'latest'],
    ]);
    expect(send.mock.calls[0][2]).toMatchObject({ address: SECOND_PAYER });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports insufficient bigint funds before any recovery publication', async () => {
    provider.getBalance.mockResolvedValue(BigInt(41999));
    await expect(submit()).rejects.toThrow('PALI_NATIVE_GAS_REQUIRED');
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves compat provider support without changing recovery encoding', async () => {
    provider.getBalance.mockResolvedValue(BigNumber.from(42000));
    await expect(submit()).resolves.toMatchObject({ operation });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('preserves individual-read failures without signing or publishing', async () => {
    provider.getBalance.mockRejectedValue(
      new Error('balance read unavailable')
    );
    await expect(submit()).rejects.toThrow('balance read unavailable');
    expect(send).not.toHaveBeenCalled();
  });
});
