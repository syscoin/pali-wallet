import { TypedDataEncoder } from 'ethers/hash';
import { Wallet } from 'ethers/wallet';

import { buildPaliErc7739PersonalSigningIntent } from './erc7739';
import {
  signSmartAccountOwnerIntent,
  type SmartAccountOwnerSigningSdk,
  type SmartAccountOwnerIdentity,
} from './ownerSigning';
import { createSmartAccountRawSigningIntent } from './ownerSigningIntent';

const wallet = new Wallet('0x' + '31'.repeat(32)),
  SMART = '0x' + '41'.repeat(20);
const intent = buildPaliErc7739PersonalSigningIntent({
  accountAddress: SMART,
  chainId: 1,
  message: 'exact message',
});
function input(type: SmartAccountOwnerIdentity['type'] = 'HDAccount') {
  const lifetime = new AbortController();
  const rawSign = jest.fn(
    async ([, hash]: string[]) => wallet.signingKey.sign(hash).serialized
  );
  const signTypedData = jest.fn(async ({ data }: any, authority: any) => {
    authority.assertCurrent();
    const types = { ...data.types };
    delete types.EIP712Domain;
    return wallet.signingKey.sign(
      TypedDataEncoder.hash(data.domain, types, data.message)
    ).serialized;
  });
  const sdk: SmartAccountOwnerSigningSdk = {
    rawSign,
    ledger: { signTypedData },
    trezor: { signTypedData },
  };
  return {
    intent,
    selectedSmart: {
      id: 9,
      type: 'SmartAccount' as const,
      expectedAddress: SMART,
    },
    owner: { id: 7, type, address: wallet.address },
    authority: { signal: lifetime.signal, assertCurrent: jest.fn() },
    sdk,
    lifetime,
    rawSign,
    signTypedData,
  };
}
it.each(['HDAccount', 'Imported'] as const)(
  'uses the existing raw software route for %s with exact selected Smart/owner and authority',
  async (type) => {
    const request = input(type),
      result = await signSmartAccountOwnerIntent(request);
    expect(result).toBe(wallet.signingKey.sign(intent.actionHash).serialized);
    expect(request.rawSign).toHaveBeenCalledWith(
      [wallet.address, intent.actionHash],
      expect.objectContaining({
        selectedAccount: request.selectedSmart,
        targetAccount: { id: 7, type, expectedAddress: wallet.address },
        signal: request.lifetime.signal,
        assertCurrent: expect.any(Function),
      })
    );
    expect(request.signTypedData).not.toHaveBeenCalled();
  }
);
it.each(['Ledger', 'Trezor'] as const)(
  'dispatches canonical V4 only to explicit %s owner and retains raw-proof digest',
  async (type) => {
    const request = input(type),
      result = await signSmartAccountOwnerIntent(request);
    expect(result).toBe(wallet.signingKey.sign(intent.actionHash).serialized);
    expect(request.rawSign).not.toHaveBeenCalled();
    expect(request.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining(
        type === 'Ledger'
          ? { accountIndex: 7, expectedAddress: wallet.address, version: 'V4' }
          : { index: 7, address: wallet.address, version: 'V4' }
      ),
      expect.objectContaining({
        signal: request.lifetime.signal,
        assertCurrent: expect.any(Function),
      })
    );
  }
);
it.each(['Ledger', 'Trezor'] as const)(
  'refuses explicit raw-only %s before SDK/device and never falls back',
  async (type) => {
    const request = input(type);
    await expect(
      signSmartAccountOwnerIntent({
        ...request,
        intent: createSmartAccountRawSigningIntent(
          'erc7739-typed-data',
          intent.actionHash,
          'unrepresentable-types'
        ),
      })
    ).rejects.toThrow('not supported');
    expect(request.rawSign).not.toHaveBeenCalled();
    expect(request.signTypedData).not.toHaveBeenCalled();
  }
);
it('preserves valid software raw-only digest', async () => {
  const request = input();
  await expect(
    signSmartAccountOwnerIntent({
      ...request,
      intent: createSmartAccountRawSigningIntent(
        'erc7739-typed-data',
        intent.actionHash,
        'unrepresentable-types'
      ),
    })
  ).resolves.toBe(wallet.signingKey.sign(intent.actionHash).serialized);
});
it('refuses missing hardware capability instead of widening native owner support', async () => {
  const request = input('Ledger');
  request.sdk = { ...request.sdk, ledger: null };
  await expect(signSmartAccountOwnerIntent(request)).rejects.toThrow(
    'unavailable'
  );
  expect(request.rawSign).not.toHaveBeenCalled();
  expect(request.signTypedData).not.toHaveBeenCalled();
});
it.each([
  async () => undefined,
  async () => {
    throw new Error('revoked');
  },
])(
  'refuses asynchronous authority before all signing',
  async (assertCurrent) => {
    const request = input('Ledger');
    await expect(
      signSmartAccountOwnerIntent({
        ...request,
        authority: { ...request.authority, assertCurrent },
      })
    ).rejects.toThrow('synchronous');
    expect(request.rawSign).not.toHaveBeenCalled();
    expect(request.signTypedData).not.toHaveBeenCalled();
  }
);
it('refuses retired authority before dispatch and a late result after await', async () => {
  const request = input('Ledger');
  request.lifetime.abort();
  await expect(signSmartAccountOwnerIntent(request)).rejects.toThrow('expired');
  expect(request.signTypedData).not.toHaveBeenCalled();
  const next = input('Ledger');
  next.signTypedData.mockImplementationOnce(async () => {
    next.lifetime.abort();
    return 'late';
  });
  await expect(signSmartAccountOwnerIntent(next)).rejects.toThrow('expired');
  expect(next.rawSign).not.toHaveBeenCalled();
});

it('rejects a different selected Smart before either SDK route', async () => {
  const request = input('Ledger');
  await expect(
    signSmartAccountOwnerIntent({
      ...request,
      selectedSmart: {
        ...request.selectedSmart,
        expectedAddress: '0x' + '77'.repeat(20),
      },
    })
  ).rejects.toThrow('account changed');
  expect(request.rawSign).not.toHaveBeenCalled();
  expect(request.signTypedData).not.toHaveBeenCalled();
});
