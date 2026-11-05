import type {
  IKeyringAccountState,
  KeyringAccountType,
} from '../types/network';

export type AccountRecords = {
  [key in KeyringAccountType]: { [id: number]: IKeyringAccountState };
};

export type AccountRecordSelection = {
  id: number;
  type: KeyringAccountType;
};

export class AccountRecoveryRequiredError extends Error {
  constructor() {
    super(
      'Account data is incomplete; recovery is required. Your saved accounts and history have not been changed.'
    );
    this.name = 'AccountRecoveryRequiredError';
  }
}

/** Never replace persisted account identities while opening a wallet. */
export function assertCompleteHDAccountData(
  accounts: AccountRecords['HDAccount']
): void {
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) {
    throw new AccountRecoveryRequiredError();
  }
  const entries = Object.entries(accounts);
  if (entries.length === 0) return;

  // Account zero is the default anchor. Gaps above zero are valid deletions.
  if (!accounts[0]) throw new AccountRecoveryRequiredError();

  for (const [id, account] of entries) {
    const accountId = Number(id);
    if (
      !Number.isSafeInteger(accountId) ||
      accountId < 0 ||
      String(accountId) !== id ||
      !account ||
      account.id !== accountId ||
      typeof account.address !== 'string' ||
      account.address.trim() === '' ||
      typeof account.xpub !== 'string' ||
      account.xpub.trim() === ''
    ) {
      throw new AccountRecoveryRequiredError();
    }
  }
}

type HDAccountMetadata = {
  accountAssets?: {
    HDAccount?: { [id: number]: { ethereum: unknown[]; syscoin: unknown[] } };
  };
  accountTransactions?: {
    HDAccount?: {
      [id: number]: {
        ethereum: Record<number, unknown[]>;
        syscoin: Record<number, unknown[]>;
      };
    };
  };
};

/** Empty scaffolding can be populated, but never infer identities for saved data. */
export function assertEmptyHDAccountMetadata(vault: HDAccountMetadata): void {
  const assets = vault.accountAssets?.HDAccount;
  const transactions = vault.accountTransactions?.HDAccount;
  for (const metadata of [assets, transactions]) {
    if (
      metadata !== null &&
      metadata !== undefined &&
      (typeof metadata !== 'object' || Array.isArray(metadata))
    ) {
      throw new AccountRecoveryRequiredError();
    }
  }
  for (const accountAssets of Object.values(assets ?? {})) {
    if (
      !Array.isArray(accountAssets?.ethereum) ||
      !Array.isArray(accountAssets?.syscoin) ||
      accountAssets.ethereum.length > 0 ||
      accountAssets.syscoin.length > 0
    ) {
      throw new AccountRecoveryRequiredError();
    }
  }
  for (const accountTransactions of Object.values(transactions ?? {})) {
    for (const chain of ['ethereum', 'syscoin'] as const) {
      const history = accountTransactions?.[chain];
      if (!history || typeof history !== 'object' || Array.isArray(history)) {
        throw new AccountRecoveryRequiredError();
      }
      if (
        Object.values(history).some(
          (entries) => !Array.isArray(entries) || entries.length > 0
        )
      ) {
        throw new AccountRecoveryRequiredError();
      }
    }
  }
}

/** Admission after SDK creation, checked again at the host's commit boundary. */
export function assertAccountCreationAvailable(
  accounts: AccountRecords,
  accountType: KeyringAccountType,
  accountId: number
): void {
  if (accountType === 'HDAccount')
    assertCompleteHDAccountData(accounts.HDAccount);
  if (accounts[accountType]?.[accountId])
    throw new Error(
      accountType === 'Imported'
        ? 'Account import conflicted with another import. Please retry.'
        : 'Account creation conflicted with another request. Please retry.'
    );
}

/** Apply the existing extension transition to an owned mutable state or draft. */
export function createAccountRecord(
  accounts: AccountRecords,
  account: IKeyringAccountState,
  accountType: KeyringAccountType,
  slip44: number
): void {
  accounts[accountType][account.id] = {
    ...account,
    slip44,
    balances: { syscoin: -1, ethereum: -1 },
  };
}

export function setAccountRecordLabel(
  accounts: AccountRecords,
  accountType: KeyringAccountType,
  accountId: number,
  label: string
): void {
  if (accounts[accountType]?.[accountId]) {
    accounts[accountType][accountId].label = label;
  }
}

export function removeAccountRecord(
  accounts: AccountRecords,
  accountType: KeyringAccountType,
  accountId: number
): void {
  delete accounts[accountType][accountId];
}

export function setActiveAccountRecord(
  state: { activeAccount: AccountRecordSelection },
  selection: AccountRecordSelection
): void {
  state.activeAccount = selection;
}

/** Preserve complete account records, keeping credential profiles separate. */
export function accountRecordsForPersistence<
  T extends { passkeyCredentialProfile?: unknown }
>(state: T): T {
  const snapshot = { ...state };
  delete snapshot.passkeyCredentialProfile;
  return snapshot;
}
