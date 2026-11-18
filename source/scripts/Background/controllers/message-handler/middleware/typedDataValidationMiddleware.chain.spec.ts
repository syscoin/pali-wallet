const mockGetState = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockGetState() },
}));

import { typedDataValidationMiddleware } from './typedDataValidationMiddleware';

const address = `0x${'11'.repeat(20)}`;
const payload = (chainId?: unknown) => ({
  types: { EIP712Domain: [], Note: [{ name: 'text', type: 'string' }] },
  domain: chainId === undefined ? {} : { chainId },
  primaryType: 'Note',
  message: { text: 'Reviewed data' },
});
beforeEach(() => {
  mockGetState.mockReturnValue({
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      activeNetwork: { chainId: 1 },
    },
  });
});

it.each(['eth_signTypedData_v3', 'eth_signTypedData_v4'])(
  'refuses a foreign %s domain before opening approval',
  async (method) => {
    const next = jest.fn();
    await expect(
      typedDataValidationMiddleware(
        { originalRequest: { method, params: [address, payload(10)] } } as any,
        next
      )
    ).rejects.toMatchObject({ code: -32602 });
    expect(next).not.toHaveBeenCalled();
  }
);
it.each([1, '0x1', undefined])(
  'continues matching or absent domain chain %p',
  async (chainId) => {
    const next = jest.fn();
    await typedDataValidationMiddleware(
      {
        originalRequest: {
          method: 'eth_signTypedData_v4',
          params: [address, payload(chainId)],
        },
      } as any,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  }
);
it('uses the selected account type rather than a dapp-supplied Smart flag', async () => {
  const next = jest.fn();
  await expect(
    typedDataValidationMiddleware(
      {
        originalRequest: {
          method: 'eth_signTypedData_v4',
          params: [address, { ...payload(10), isSmartAccount: true }],
        },
      } as any,
      next
    )
  ).rejects.toMatchObject({ code: -32602 });
  expect(next).not.toHaveBeenCalled();
  mockGetState.mockReturnValue({
    vault: {
      activeAccount: { type: 'SmartAccount', id: 0 },
      activeNetwork: { chainId: 1 },
    },
  });
  await typedDataValidationMiddleware(
    {
      originalRequest: {
        method: 'eth_signTypedData_v4',
        params: [address, payload(10)],
      },
    } as any,
    next
  );
  expect(next).toHaveBeenCalledTimes(1);
});
