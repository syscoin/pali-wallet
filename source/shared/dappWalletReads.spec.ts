import {
  normalizeDappWalletRead,
  projectWalletBalance,
  projectWalletBalanceUnits,
  projectWalletAvailableBalanceUnits,
  projectWalletTokens,
  readWalletFee,
  walletTokenChainId,
  type DappWalletTokens,
} from './dappWalletReads';

it('preserves the existing number/string balance response and distinguishes unknown from zero', () => {
  expect(projectWalletBalance(null)).toBeNull();
  expect(projectWalletBalance(undefined)).toBeNull();
  expect(projectWalletBalance(0)).toBe(0);
  expect(projectWalletBalance('1.000000000000000001')).toBe(
    '1.000000000000000001'
  );
  expect(projectWalletBalanceUnits('0', 18)).toBe('0.0');
  expect(projectWalletBalanceUnits('1234567890123456789', 18)).toBe(
    '1.234567890123456789'
  );
  expect(() => projectWalletBalance(NaN)).toThrow();
  expect(() => projectWalletBalance(-1)).toThrow();
  expect(() => projectWalletBalanceUnits('-1', 18)).toThrow();
});

it('matches UTXO confirmed plus signed pending observations without changing funding units', () => {
  expect(projectWalletAvailableBalanceUnits('100000000', '-1', 8)).toBe(
    '0.99999999'
  );
  expect(projectWalletAvailableBalanceUnits('1', '-2', 8)).toBe('0');
  expect(projectWalletAvailableBalanceUnits('0', '1', 8)).toBe('0.00000001');
});

it('shares the public token container and permits an explicit negotiated-chain projection', () => {
  const zero = {
    chainId: 1,
    contractAddress: 'zero',
    decimals: 18,
    isNft: false,
    tokenSymbol: 'Z',
    rawBalance: '0',
    balance: 0,
  };
  const unknown = {
    chainId: 1,
    contractAddress: 'unknown',
    decimals: 18,
    isNft: false,
    tokenSymbol: 'U',
  };
  const input = {
    ethereum: [zero, unknown, { ...zero, chainId: 10 }],
    syscoin: [{ chainId: 57, assetGuid: '123' }],
  };
  const result = projectWalletTokens(input, {
    kind: 'chain',
    family: 'ethereum',
    chainId: 1,
  });
  expect(result).toEqual({ ethereum: [zero, unknown], syscoin: [] });
  expect(projectWalletTokens(input, { kind: 'all' })).toEqual(input);
  expect(projectWalletTokens([], { kind: 'all' })).toEqual([]);
  zero.rawBalance = '9';
  expect((result as DappWalletTokens).ethereum[0].rawBalance).toBe('0');
  expect(
    Object.hasOwn((result as DappWalletTokens).ethereum[1], 'balance')
  ).toBe(false);
  const extraFields = {
    ethereum: [{ ...zero, internalSecret: 'never disclose' }],
    syscoin: [],
  };
  expect(projectWalletTokens(extraFields, { kind: 'all' })).toEqual({
    ethereum: [zero],
    syscoin: [],
  });
});

it('accepts only the three parameterless custom wallet reads', () => {
  for (const method of [
    'wallet_getBalance',
    'wallet_getTokens',
    'wallet_estimateFee',
  ]) {
    expect(normalizeDappWalletRead(method, [])).toBe(method);
    expect(normalizeDappWalletRead(method, undefined)).toBe(method);
    expect(() => normalizeDappWalletRead(method, ['other-account'])).toThrow();
  }
  expect(() => normalizeDappWalletRead('wallet_changeAccount', [])).toThrow();
});

it('refuses an unrepresentable public numeric chain ID without rounding it', () => {
  expect(walletTokenChainId('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  expect(() => walletTokenChainId('9007199254740993')).toThrow();
  expect(() =>
    projectWalletTokens(
      { ethereum: [], syscoin: [] },
      {
        kind: 'chain',
        family: 'ethereum',
        chainId: Number.MAX_SAFE_INTEGER + 1,
      }
    )
  ).toThrow();
});

it('accepts Bitcoin chain zero only for the UTXO token response family', () => {
  const empty = { ethereum: [], syscoin: [] };
  expect(
    projectWalletTokens(empty, { kind: 'chain', family: 'syscoin', chainId: 0 })
  ).toEqual(empty);
  expect(() =>
    projectWalletTokens(empty, {
      kind: 'chain',
      family: 'ethereum',
      chainId: 0,
    })
  ).toThrow();
  expect(() =>
    projectWalletTokens(empty, {
      kind: 'chain',
      family: 'syscoin',
      chainId: -1,
    })
  ).toThrow();
});

it('shares explicit unavailable-fee errors instead of guessed rates, preserving cancellation', async () => {
  const current = () => {
    /* This fixture's public context stays current. */
  };
  await expect(
    readWalletFee(async () => '12345678901234567890', current)
  ).resolves.toBe('12345678901234567890');
  await expect(readWalletFee(async () => 0.000001, current)).resolves.toBe(
    0.000001
  );
  for (const value of [0, NaN, '', '0'])
    await expect(
      readWalletFee(async () => value, current)
    ).rejects.toMatchObject({ code: -32603 });
  await expect(
    readWalletFee(async () => {
      throw Error('offline');
    }, current)
  ).rejects.toMatchObject({
    code: -32603,
    message: 'Fee estimate unavailable',
  });
  const cancelled = Object.assign(Error('cancelled read'), {
    code: 'CANCELLED',
  });
  await expect(
    readWalletFee(async () => {
      throw cancelled;
    }, current)
  ).rejects.toBe(cancelled);
  let live = true;
  await expect(
    readWalletFee(
      async () => {
        live = false;
        return '1';
      },
      () => {
        if (!live) throw Error('CONTEXT_CHANGED');
      }
    )
  ).rejects.toThrow('CONTEXT_CHANGED');
});
