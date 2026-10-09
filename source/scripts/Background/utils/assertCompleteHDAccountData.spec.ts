import type { IVaultState } from 'state/vault/types';

import {
  AccountRecoveryRequiredError,
  assertCompleteHDAccountData,
  assertEmptyHDAccountMetadata,
} from './assertCompleteHDAccountData';

const account = (id: number, overrides = {}) => ({
  id,
  address: `saved-address-${id}`,
  xpub: `saved-public-key-${id}`,
  label: `Saved label ${id}`,
  ...overrides,
});

const check = (accounts: unknown) =>
  assertCompleteHDAccountData(accounts as IVaultState['accounts']['HDAccount']);

describe('HD account recovery preflight', () => {
  it('accepts healthy accounts without mutating their identity or metadata', () => {
    const accounts = { 0: account(0), 1: account(1) };
    const snapshot = JSON.stringify(accounts);
    expect(() => check(accounts)).not.toThrow();
    expect(JSON.stringify(accounts)).toBe(snapshot);
  });

  it('preserves sparse IDs instead of creating accounts in deleted positions', () => {
    const accounts = { 0: account(0), 2: account(2), 7: account(7) };
    expect(() => check(accounts)).not.toThrow();
    expect(Object.keys(accounts)).toEqual(['0', '2', '7']);
  });

  it('allows an empty HD collection, including wallets using imported accounts', () => {
    expect(() => check({})).not.toThrow();
  });

  it.each([
    null,
    undefined,
    [],
    'invalid',
    { 0: account(0), '00': account(0) },
    { 2: account(2) },
    { 0: account(0, { xpub: '' }) },
    { 0: account(0, { xpub: '   ' }) },
    { 0: account(0, { address: '' }) },
    { 0: account(0), 2: account(1) },
    { 0: account(0), '-1': account(-1) },
    { 0: account(0), 2: null },
  ])('rejects incomplete account data without changing it: %j', (accounts) => {
    const snapshot = JSON.stringify(accounts);
    expect(() => check(accounts)).toThrow(AccountRecoveryRequiredError);
    expect(JSON.stringify(accounts)).toBe(snapshot);
  });

  it('allows empty legacy asset and transaction scaffolding', () => {
    expect(() =>
      assertEmptyHDAccountMetadata({
        accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
        accountTransactions: {
          HDAccount: { 0: { ethereum: { 1: [] }, syscoin: {} } },
        },
      } as any)
    ).not.toThrow();
  });

  it.each([
    {
      accountAssets: {
        HDAccount: { 0: { ethereum: [{ symbol: 'SAVED' }], syscoin: [] } },
      },
    },
    {
      accountTransactions: {
        HDAccount: { 0: { ethereum: { 1: ['saved-tx'] }, syscoin: {} } },
      },
    },
    { accountAssets: { HDAccount: [] } },
    {
      accountTransactions: {
        HDAccount: { 0: { ethereum: 'invalid', syscoin: {} } },
      },
    },
  ])('preserves meaningful or malformed orphan metadata: %j', (vault) => {
    const snapshot = JSON.stringify(vault);
    expect(() => assertEmptyHDAccountMetadata(vault as any)).toThrow(
      AccountRecoveryRequiredError
    );
    expect(JSON.stringify(vault)).toBe(snapshot);
  });
});
