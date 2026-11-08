import {
  resolveEvmFeeFunding,
  captureEvmFeeApproval,
} from '../../shared/evmFeeApproval';
import { BigNumber, defaultAbiCoder } from '../ethersV6Compat';

import { getPaliEntryPointAddress } from './contracts';
import { createSmartAccountGasTankFunding } from './payerPolicy';

it.each([0, 2] as const)(
  'verifies full approved type-%s fee cap instead of a fresh low gas quote',
  async (type) => {
    const chainId = 57057;
    const payer = '0x1111111111111111111111111111111111111111';
    const to = getPaliEntryPointAddress(chainId);
    let credit = BigInt(1000000);
    const provider = {
      estimateGas: jest.fn(async () => BigNumber.from(100_000)),
      call: jest.fn(async () => defaultAbiCoder.encode(['uint256'], [credit])),
      getFeeData: jest.fn(async () => ({ gasPrice: BigNumber.from(1) })),
    };
    const funding = createSmartAccountGasTankFunding(
      provider,
      { chainId, payer, to, data: '0x1234', value: '0' },
      jest.fn()
    );
    const approval = captureEvmFeeApproval(
      {
        chainId: String(chainId),
        from: payer,
        to,
        data: '0x1234',
        value: '0',
        gasLimit: '300000',
        nonce: '1',
        ...(type === 2
          ? {
              type,
              maxFeePerGas: '10000',
              maxPriorityFeePerGas: '1',
              accessList: [],
            }
          : { type, gasPrice: '10000' }),
      },
      'fixture',
      1000
    );
    await expect(
      resolveEvmFeeFunding(funding, approval, jest.fn())
    ).rejects.toThrow('PALI_ZKSYS_GAS_TANK_REQUIRED');
    credit = BigInt(3000000000);
    await expect(
      resolveEvmFeeFunding(funding, approval, jest.fn())
    ).resolves.toEqual({ coveredFeeUnits: '3000000000' });
    expect(provider.getFeeData).not.toHaveBeenCalled();
    const changed = {
      ...approval,
      transaction: { ...approval.transaction, nonce: '2' },
    };
    await expect(
      resolveEvmFeeFunding(funding, changed, jest.fn())
    ).rejects.toThrow('Sponsored transaction changed');
  }
);
