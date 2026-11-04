import { createNextState as produce } from '@reduxjs/toolkit';

import vault, {
  createAccount,
  removeAccount,
  setAccountLabel,
  setActiveAccount,
} from '../state/vault';
import {
  INetworkType,
  KeyringAccountType,
  type IKeyringAccountState,
} from '../types/network';

import {
  accountRecordsForPersistence,
  assertAccountCreationAvailable,
  assertCompleteHDAccountData,
  createAccountRecord,
  removeAccountRecord,
  setAccountRecordLabel,
  setActiveAccountRecord,
  type AccountRecords,
} from './accountRecords';

const empty = (): AccountRecords => ({
  HDAccount: {},
  Imported: {},
  Ledger: {},
  Trezor: {},
  SmartAccount: {},
});
const record = (id: number, type = KeyringAccountType.HDAccount) =>
  ({
    id,
    address: `public-address-${id}`,
    xpub: `public-key-${id}`,
    xprv:
      type === KeyringAccountType.HDAccount ||
      type === KeyringAccountType.Imported
        ? 'encrypted-fixture-key'
        : '',
    label: `Account ${id}`,
    balances: { syscoin: 2, ethereum: 3 },
    isImported: type === KeyringAccountType.Imported,
    isLedgerWallet: type === KeyringAccountType.Ledger,
    isTrezorWallet: type === KeyringAccountType.Trezor,
    isSmartAccount: type === KeyringAccountType.SmartAccount,
    slip44: 57,
    evmTxCountByChainId: { 1: 4 },
    nativeBalanceCache: { 'evm:1': { amount: '123', updatedAt: 40 } },
    smartAccountUserOpScanByChainId: { 1: 99 },
    smartAccount: {
      descriptor: { accountIndex: id },
      customModules: [{ id: 'retained' }],
    },
    retainedExtensionMetadata: { future: ['kept'] },
  } as unknown as IKeyringAccountState);

it.each(Object.values(KeyringAccountType))(
  'shares the extension create transition without reducing %s records',
  (accountType) => {
    const before = vault(undefined, { type: 'fixture' });
    const account = record(2, accountType);
    const original = JSON.stringify(account);
    const direct = produce(before.accounts, (accounts) => {
      createAccountRecord(
        accounts,
        account,
        accountType,
        before.activeNetwork.slip44
      );
    });
    const next = vault(before, createAccount({ account, accountType }));
    expect(next.accounts).toEqual(direct);
    expect(next.accounts[accountType][2]).toEqual({
      ...account,
      slip44: before.activeNetwork.slip44,
      balances: { syscoin: -1, ethereum: -1 },
    });
    expect(next.accountAssets[accountType][2]).toEqual({
      ethereum: [],
      syscoin: [],
    });
    expect(next.accountTransactions[accountType][2]).toEqual({
      ethereum: {},
      syscoin: {},
    });
    expect(before.accounts[accountType][2]).toBeUndefined();
    expect(JSON.stringify(account)).toBe(original);
  }
);

it('preserves caller-supplied asset/history state and public-only imported records', () => {
  const account = {
    ...record(4, KeyringAccountType.Imported),
    xpub: 'public-identifier',
    xprv: '',
  };
  const assets = { ethereum: [{ publicMetadata: true }], syscoin: [] } as any;
  const transactions = {
    ethereum: { 1: [{ hash: 'recorded' }] },
    syscoin: {},
  } as any;
  const next = vault(
    undefined,
    createAccount({
      account,
      accountType: KeyringAccountType.Imported,
      assets,
      transactions,
    })
  );
  expect(next.accounts.Imported[4].xprv).toBe('');
  expect(next.accounts.Imported[4].xpub).toBe('public-identifier');
  expect(next.accountAssets.Imported[4]).toEqual(assets);
  expect(next.accountTransactions.Imported[4]).toEqual(transactions);
});

it('keeps legal typed aliases distinct through admission, selection, rename and removal', () => {
  let state = vault(undefined, { type: 'fixture' });
  const hd = record(0);
  const imported = {
    ...record(0, KeyringAccountType.Imported),
    address: hd.address,
  };
  state = vault(
    state,
    createAccount({ account: hd, accountType: KeyringAccountType.HDAccount })
  );
  expect(() =>
    assertAccountCreationAvailable(
      state.accounts,
      KeyringAccountType.Imported,
      0
    )
  ).not.toThrow();
  state = vault(
    state,
    createAccount({
      account: imported,
      accountType: KeyringAccountType.Imported,
    })
  );
  const selection = { id: 0, type: KeyringAccountType.Imported };
  const direct = produce(state, (draft) => {
    setActiveAccountRecord(draft, selection);
    setAccountRecordLabel(
      draft.accounts,
      KeyringAccountType.Imported,
      0,
      'Imported alias'
    );
    removeAccountRecord(draft.accounts, KeyringAccountType.HDAccount, 0);
  });
  state = vault(state, setActiveAccount(selection));
  state = vault(
    state,
    setAccountLabel({
      accountId: 0,
      accountType: KeyringAccountType.Imported,
      label: 'Imported alias',
    })
  );
  state = vault(
    state,
    removeAccount({ id: 0, type: KeyringAccountType.HDAccount })
  );
  expect(state.accounts).toEqual(direct.accounts);
  expect(state.activeAccount).toEqual(direct.activeAccount);
  expect(state.accounts.Imported[0]).toEqual({
    ...imported,
    label: 'Imported alias',
    slip44: 57,
    balances: { syscoin: -1, ethereum: -1 },
  });
  expect(state.accountAssets.HDAccount[0]).toBeUndefined();
  expect(state.accountTransactions.HDAccount[0]).toBeUndefined();
  expect(state.accountAssets.Imported[0]).toEqual({
    ethereum: [],
    syscoin: [],
  });
});

it('keeps same-type admission conflicts and HD completeness errors unchanged', () => {
  const accounts = empty();
  accounts.HDAccount = { 0: record(0), 2: record(2) };
  expect(() =>
    assertAccountCreationAvailable(accounts, KeyringAccountType.HDAccount, 1)
  ).not.toThrow();
  expect(() =>
    assertAccountCreationAvailable(accounts, KeyringAccountType.HDAccount, 2)
  ).toThrow('Account creation conflicted with another request. Please retry.');
  accounts.Imported[7] = record(7, KeyringAccountType.Imported);
  expect(() =>
    assertAccountCreationAvailable(accounts, KeyringAccountType.Imported, 7)
  ).toThrow('Account import conflicted with another import. Please retry.');
  delete accounts.HDAccount[0];
  expect(() =>
    assertAccountCreationAvailable(accounts, KeyringAccountType.HDAccount, 0)
  ).toThrow(
    'Account data is incomplete; recovery is required. Your saved accounts and history have not been changed.'
  );
  expect(() => assertCompleteHDAccountData({})).not.toThrow();
});

it('retains every account and network field while omitting only the separate credential profile', () => {
  const state = {
    ...structuredClone(vault(undefined, { type: 'fixture' })),
    passkeyCredentialProfile: { privateProfile: 'separate' },
  } as any;
  for (const accountType of Object.values(KeyringAccountType)) {
    state.accounts[accountType] = { 2: record(2, accountType) };
  }
  state.activeNetwork = {
    ...state.activeNetwork,
    kind: INetworkType.Ethereum,
    slip44: 60,
  };
  const original = JSON.stringify(state);
  const stored = accountRecordsForPersistence(state);
  expect(stored).not.toBe(state);
  expect(stored).not.toHaveProperty('passkeyCredentialProfile');
  expect(stored.accounts).toBe(state.accounts);
  const { passkeyCredentialProfile: _profile, ...expected } = state;
  void _profile;
  expect(stored).toEqual(expected);
  expect(JSON.stringify(state)).toBe(original);
});

it('preserves no-op label/removal transitions for missing records', () => {
  const before = vault(undefined, { type: 'fixture' });
  const renamed = vault(
    before,
    setAccountLabel({
      accountId: 9,
      accountType: KeyringAccountType.Imported,
      label: 'missing',
    })
  );
  expect(renamed).toBe(before);
  const removed = vault(
    before,
    removeAccount({ id: 9, type: KeyringAccountType.Imported })
  );
  expect(removed).toBe(before);
});
