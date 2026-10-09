import type { IVaultState } from 'state/vault/types';

export class AccountRecoveryRequiredError extends Error {
  constructor() {
    super(
      'Account data is incomplete; recovery is required. Your saved accounts and history have not been changed.'
    );
    this.name = 'AccountRecoveryRequiredError';
  }
}

/**
 * Never infer replacements for persisted account identities during login or a
 * network switch. The public keyring API chooses new IDs from live state and
 * cannot atomically reconstruct a damaged account collection at explicit IDs.
 */
export function assertCompleteHDAccountData(
  accounts: IVaultState['accounts']['HDAccount']
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

// Empty legacy scaffolding is safe to populate. Orphaned assets/history have
// no address against which to verify a newly derived identity, so keep them.
export function assertEmptyHDAccountMetadata(
  vault: Pick<IVaultState, 'accountAssets' | 'accountTransactions'>
): void {
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
