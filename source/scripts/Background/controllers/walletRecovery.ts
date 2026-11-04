import * as secp256k1 from '@bitcoinerlab/secp256k1';
import {
  getAddressDerivationPath,
  getSyscoinSigners,
} from '@sidhujag/sysweb3-keyring';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { mnemonicToSeedSync } from 'bip39';

// Match the public CommonJS implementation already used by syscoinjs-lib.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BIP32Factory } = require('bip32') as typeof import('bip32');
// Use the same public CommonJS helpers as the SDK, avoiding a duplicate graph.
/* eslint-disable @typescript-eslint/no-var-requires */
const { getAddress } =
  require('ethers/address') as typeof import('ethers/address');
const { keccak256 } =
  require('ethers/crypto') as typeof import('ethers/crypto');
const { dataSlice, hexlify } =
  require('ethers/utils') as typeof import('ethers/utils');
/* eslint-enable @typescript-eslint/no-var-requires */

import { isStrongWalletPassword } from '../../../shared/passwordPolicy';
import { EVM_SIGNED_RECORD_PREFIX } from '../../../wallet/evmSignedRecords';
import { walletPersistenceGate } from 'state/paliStorage';
import type { RootState } from 'state/store';
import type { AsyncMutex } from 'utils/asyncMutex';
import type { chromeStorage } from 'utils/storageAPI';

import type MainController from './MainController';
import {
  prepareExtensionAccountRecovery,
  recoveryAccountGroups,
} from './walletRecoveryAccounts';

export type WalletRecoveryContext = {
  getState: () => Pick<RootState, 'vault'>;
  persistenceMutex: Pick<AsyncMutex, 'runExclusive'>;
  readPresence: () => Promise<boolean>;
  rehydrate: (state: any) => Promise<void>;
  storage: typeof chromeStorage;
};

// This key must stay outside the keys removed by resetWalletStateExclusive.
const JOURNAL_KEY = 'pali-wallet-recovery-journal:v1';
const TICKET_LIFETIME_MS = 10 * 60 * 1000;
type RecoveryHost = {
  activateRecoveredWallet: (
    password: string,
    assertCurrent: () => void
  ) => Promise<void>;
  authenticationMutex: AsyncMutex;
  createWalletExclusive: (password: string, phrase: string) => Promise<void>;
  isAnyKeyringUnlocked: () => boolean;
  isCreatingWallet: boolean;
  isSeedValid: (phrase: string) => boolean;
  isUnlocked: () => boolean;
  lock: () => void;
  recoveryJournalPending: boolean;
  resetRateLimitState: () => void;
  resetWalletState: (options?: { resetNetworks?: boolean }) => Promise<void>;
  retireWalletRuntime: () => Promise<void>;
  walletSessionGeneration: number;
  walletStateGeneration: number;
};
type Records = Record<string, any>;
type RecoveryTicket = {
  createdAt: number;
  generation: number;
  identity: RecoveryIdentity;
  pairFingerprint: string;
  token: string;
  walletStateGeneration: number;
};
type RecoveryIdentity = {
  account: { address: string; id: number; xpub: string };
  network: any;
};
type RecoveryJournal = {
  before: Records;
  checksum: string;
  committedFingerprint?: string;
  committedIdentity?: CommittedIdentity;
  version: 1;
};
type CommittedIdentity = {
  id: 0;
  slip44: number;
  xpub: string;
};
const tickets = new WeakMap<MainController, RecoveryTicket>();
const resetTickets = new WeakMap<
  MainController,
  Omit<RecoveryTicket, 'identity'>
>();

const resetOwnedKey = (key: string) =>
  key === 'sysweb3-vault' ||
  key === 'sysweb3-vault-keys' ||
  key.startsWith('sysweb3-vault-') ||
  key.startsWith(EVM_SIGNED_RECORD_PREFIX) ||
  key.startsWith('state-') ||
  key === 'state' ||
  key.startsWith('pali-slh-dsa-state:') ||
  key.startsWith('pali-slh-dsa-precompute:') ||
  key.startsWith('pali-slh-dsa-smart-account-setup:') ||
  key.startsWith('pali-slh-dsa-prepared-smart-account-signer:v1:') ||
  key.startsWith('sentry-operator-v1:') ||
  key.startsWith('sentry-settings-v1:') ||
  key.startsWith('sentry-collateral-v1:') ||
  key.startsWith('sentry-linked-v1:');

const getAll = (): Promise<Records> =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get(null, (records) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else if (!records || typeof records !== 'object')
        reject(new Error('Wallet recovery storage is unavailable'));
      else resolve(records);
    });
  });

const snapshot = (records: Records): Records =>
  Object.fromEntries(
    Object.keys(records)
      .filter(resetOwnedKey)
      .sort()
      .map((key) => [key, records[key]])
  );

const digest = async (value: any): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
};

const pairFingerprint = (records: Records) =>
  digest({
    vault: records['sysweb3-vault'],
    keys: records['sysweb3-vault-keys'],
  });

const assertStoredPair = (records: Records) => {
  if (
    typeof records['sysweb3-vault'] !== 'string' ||
    !records['sysweb3-vault'] ||
    !records['sysweb3-vault-keys'] ||
    typeof records['sysweb3-vault-keys'] !== 'object' ||
    Array.isArray(records['sysweb3-vault-keys'])
  )
    throw new Error('Wallet recovery storage is incomplete');
};

const savedCommittedIdentity = (
  records: Records,
  slip44: number = records.state?.vaultGlobal?.activeSlip44
): CommittedIdentity => {
  const account = records[`state-vault-${slip44}`]?.accounts?.HDAccount?.[0];
  if (
    !Number.isSafeInteger(slip44) ||
    slip44 < 0 ||
    records.state?.vaultGlobal?.hasEncryptedVault !== true ||
    account?.id !== 0 ||
    typeof account.address !== 'string' ||
    !account.address ||
    typeof account.xpub !== 'string' ||
    !account.xpub ||
    account.isImported ||
    account.isTrezorWallet ||
    account.isLedgerWallet
  )
    throw new Error('Recovered wallet account state was not durably saved');
  // Validate the complete retained account maps before dropping the backup,
  // and again if a committed marker survives cleanup.
  recoveryAccountGroups(records);
  // UTXO receiving addresses advance normally. The HD xpub anchors identity.
  return { slip44, id: 0, xpub: account.xpub };
};

const committedFingerprint = (
  records: Records,
  publicIdentity: CommittedIdentity
) => digest({ records: snapshot(records), identity: publicIdentity });

const assertCommittedRecords = async (
  records: Records,
  journal: RecoveryJournal
) => {
  assertStoredPair(records);
  const publicIdentity = savedCommittedIdentity(
    records,
    journal.committedIdentity!.slip44
  );
  if (
    JSON.stringify(publicIdentity) !==
      JSON.stringify(journal.committedIdentity) ||
    (await committedFingerprint(records, publicIdentity)) !==
      journal.committedFingerprint
  )
    throw new Error('Committed wallet recovery storage does not match');
};

const identity = (context: WalletRecoveryContext): RecoveryIdentity => {
  const { vault } = context.getState();
  const accounts = Object.values(vault.accounts.HDAccount || {})
    .filter(
      (account: any) =>
        Number.isSafeInteger(account?.id) &&
        account.id >= 0 &&
        !account.isImported &&
        !account.isTrezorWallet &&
        !account.isLedgerWallet &&
        typeof account.xpub === 'string' &&
        account.xpub &&
        typeof account.address === 'string' &&
        account.address
    )
    .sort((left, right) => left.id - right.id);
  if (!accounts.length || !vault.activeNetwork)
    throw new Error('Saved HD account identity is unavailable for recovery');
  return {
    account: {
      id: accounts[0].id,
      xpub: accounts[0].xpub,
      address: accounts[0].address,
    },
    network: { ...vault.activeNetwork },
  };
};

const assertMatchingSeed = (phrase: string, expected: RecoveryIdentity) => {
  if (expected.network.kind === 'ethereum') {
    const seed = mnemonicToSeedSync(phrase);
    try {
      const derived = BIP32Factory(secp256k1)
        .fromSeed(seed)
        .derivePath(
          getAddressDerivationPath('eth', 60, 0, false, expected.account.id)
        );
      const publicKey = hexlify(
        secp256k1.pointCompress(derived.publicKey, false)
      );
      const address = getAddress(
        dataSlice(keccak256(dataSlice(publicKey, 1)), 12)
      );
      if (
        address.toLowerCase() !== expected.account.address.toLowerCase() ||
        publicKey.toLowerCase() !== expected.account.xpub.toLowerCase()
      )
        throw new Error('Recovery phrase does not match this wallet');
    } finally {
      seed.fill(0);
    }
    return;
  }
  if (expected.network.kind !== 'syscoin')
    throw new Error('Saved HD account network is unavailable for recovery');
  const config = getNetworkConfig(
    expected.network.slip44,
    expected.network.currency
  );
  const { hd } = getSyscoinSigners({
    mnemonic: phrase,
    rpc: {
      formattedNetwork: expected.network,
      networkConfig: {
        networks: config.networks,
        types: {
          xPubType: config.types.xPubType,
          zPubType: config.types.zPubType,
        },
      },
    },
  });
  hd.createAccountAtIndex(expected.account.id, 84);
  if (hd.getAccountXpub() !== expected.account.xpub)
    throw new Error('Recovery phrase does not match this wallet');
};

const assertLocked = (wallet: RecoveryHost, reset = false) => {
  if (wallet.isAnyKeyringUnlocked())
    throw new Error(
      reset
        ? 'Lock the wallet before starting wallet reset'
        : 'Lock the wallet before starting seed recovery'
    );
};

// Both read-only admissions bind a ticket to the same locked durable wallet.
// Keep the kind-specific guards and commits here, within one synchronous tail.
const beginWalletChange = async (
  controller: MainController,
  context: WalletRecoveryContext,
  reset: boolean
): Promise<string> => {
  const wallet = controller as unknown as RecoveryHost;
  assertLocked(wallet, reset);
  if (wallet.isCreatingWallet)
    throw new Error(
      `Wallet ${reset ? 'setup' : 'creation'} is already in progress`
    );
  if (reset && wallet.recoveryJournalPending)
    throw new Error('Reload the wallet to finish the previous recovery');
  const generation = wallet.walletSessionGeneration;
  const walletStateGeneration = wallet.walletStateGeneration;
  const records = await context.storage.getItems([
    'sysweb3-vault',
    'sysweb3-vault-keys',
    JOURNAL_KEY,
  ]);
  assertStoredPair(records);
  if (records[JOURNAL_KEY] !== undefined && records[JOURNAL_KEY] !== null)
    throw new Error('Reload the wallet to finish the previous recovery');
  const fingerprint = await pairFingerprint(records);
  if (
    generation !== wallet.walletSessionGeneration ||
    walletStateGeneration !== wallet.walletStateGeneration ||
    wallet.isCreatingWallet
  )
    throw new Error(
      `Wallet state changed before ${reset ? 'reset' : 'recovery'}`
    );
  assertLocked(wallet, reset);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const ticket = {
    token,
    pairFingerprint: fingerprint,
    generation,
    walletStateGeneration,
  };
  if (reset) {
    tickets.delete(controller);
    resetTickets.set(controller, { ...ticket, createdAt: Date.now() });
  } else {
    // Resolve identity before invalidating any existing reset ticket.
    tickets.set(controller, {
      ...ticket,
      identity: identity(context),
      createdAt: Date.now(),
    });
    resetTickets.delete(controller);
  }
  return token;
};

export const beginWalletRecovery = (
  controller: MainController,
  context: WalletRecoveryContext
): Promise<string> => beginWalletChange(controller, context, false);

export const beginLockedWalletReset = (
  controller: MainController,
  context: WalletRecoveryContext
): Promise<string> => beginWalletChange(controller, context, true);

/**
 * Explicit destructive reset, never a bypass for ordinary onboarding or recovery.
 * The caller owns authenticationMutex and reserves setup until final cleanup.
 */
export const resetLockedWallet = async (
  controller: MainController,
  token: unknown,
  confirmation: unknown,
  context: WalletRecoveryContext
): Promise<void> => {
  const wallet = controller as unknown as RecoveryHost;
  const ticket = resetTickets.get(controller);
  // A wrong/older token must not consume a different document's newer ticket.
  // A matching attempt is single use, including a rejected acknowledgement.
  if (ticket?.token === token) resetTickets.delete(controller);
  if (
    !ticket ||
    typeof token !== 'string' ||
    token !== ticket.token ||
    Date.now() < ticket.createdAt ||
    Date.now() - ticket.createdAt > TICKET_LIFETIME_MS
  )
    throw new Error('Wallet reset expired. Start reset again');
  if (confirmation !== 'ERASE')
    throw new Error('Confirm wallet removal by typing ERASE');
  const assertCurrent = () => {
    if (wallet.recoveryJournalPending)
      throw new Error('Reload the wallet to finish the previous recovery');
    if (
      ticket.generation !== wallet.walletSessionGeneration ||
      ticket.walletStateGeneration !== wallet.walletStateGeneration
    )
      throw new Error('Wallet state changed before reset');
    assertLocked(wallet, true);
  };
  assertCurrent();
  const records = await context.storage.getItems([
    'sysweb3-vault',
    'sysweb3-vault-keys',
    JOURNAL_KEY,
  ]);
  assertStoredPair(records);
  if (records[JOURNAL_KEY] !== undefined && records[JOURNAL_KEY] !== null)
    throw new Error('Reload the wallet to finish the previous recovery');
  if ((await pairFingerprint(records)) !== ticket.pairFingerprint)
    throw new Error('Wallet storage changed before reset');
  assertCurrent();
  tickets.delete(controller);
  // The same verified backup/rollback and full scoped cleanup used by Forget
  // Wallet owns the destructive portion; this path never accepts a seed.
  await forgetWalletWithRecovery(controller, context);
};

const validateJournal = async (record: any): Promise<RecoveryJournal> => {
  if (
    record?.version !== 1 ||
    !record.before ||
    typeof record.before !== 'object' ||
    Array.isArray(record.before) ||
    Object.keys(record.before).some((key) => !resetOwnedKey(key)) ||
    typeof record.checksum !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.checksum) ||
    (record.committedFingerprint !== undefined &&
      (typeof record.committedFingerprint !== 'string' ||
        !/^[0-9a-f]{64}$/.test(record.committedFingerprint))) ||
    (record.committedFingerprint === undefined) !==
      (record.committedIdentity === undefined) ||
    (record.committedIdentity !== undefined &&
      (record.committedIdentity?.id !== 0 ||
        !Number.isSafeInteger(record.committedIdentity.slip44) ||
        record.committedIdentity.slip44 < 0 ||
        typeof record.committedIdentity.xpub !== 'string' ||
        !record.committedIdentity.xpub))
  )
    throw new Error(
      'Wallet recovery journal is invalid; saved data is unchanged'
    );
  assertStoredPair(record.before);
  if ((await digest(record.before)) !== record.checksum)
    throw new Error(
      'Wallet recovery journal is damaged; saved data is unchanged'
    );
  return record;
};

const recoveryAccountRecords = (accounts: any) =>
  Object.keys(accounts)
    .sort()
    .flatMap((type) =>
      Object.entries(accounts[type] || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, account]: [string, any]) => {
          // Hydration normalizes legacy coin types and refreshes balances.
          // Compare every other saved field, including signer metadata/keys.
          const { balances, slip44, ...record } = account;
          void balances;
          void slip44;
          return [type, id, record];
        })
    );

const retireCommittedJournal = async (
  context: WalletRecoveryContext,
  wallet?: RecoveryHost
) => {
  // The new password owns the committed vault. Retain its journal if clearing
  // the old password's durable lockout fails, so restart can safely retry.
  await context.storage.setItem('pali_rate_limit_state', {
    failedAttempts: 0,
    lastFailedTime: 0,
  });
  wallet?.resetRateLimitState();
  await context.storage.removeItem(JOURNAL_KEY);
  if (wallet) wallet.recoveryJournalPending = false;
  walletPersistenceGate.blocked = false;
};

const reconcileWithinLock = async (
  context: WalletRecoveryContext
): Promise<boolean> => {
  const current = await getAll();
  const stored = current[JOURNAL_KEY];
  if (stored === undefined || stored === null) {
    walletPersistenceGate.blocked = false;
    return false;
  }
  const journal = await validateJournal(stored);
  if (journal.committedFingerprint) {
    await assertCommittedRecords(current, journal);
    await retireCommittedJournal(context);
    return false;
  }
  // One batch restores the old pair and state while nulling any scoped records
  // created by the interrupted setup. A repeated rollback is idempotent.
  await context.storage.setItems({
    ...Object.fromEntries(
      Object.keys(current)
        .filter(resetOwnedKey)
        .map((key) => [key, null])
    ),
    ...journal.before,
  });
  const originalState = journal.before.state;
  const slip44 = originalState?.vaultGlobal?.activeSlip44;
  const isolatedVault = journal.before[`state-vault-${slip44}`];
  const vault = isolatedVault || originalState?.vault;
  const profileKey = `state-vault-${slip44}-passkey-profile`;
  if (!originalState || !vault?.accounts || !Number.isSafeInteger(slip44))
    throw new Error('Wallet recovery snapshot is incomplete');
  const state = { ...originalState };
  // Match ordinary startup's authority: an inline copy must never replace the
  // isolated vault. A legacy inline-only snapshot still needs detached-profile
  // precedence, which the frontend-style hydration branch cannot load itself.
  if (isolatedVault) delete state.vault;
  else {
    const profile =
      journal.before[profileKey]?.passkeyCredentialProfile ||
      vault.passkeyCredentialProfile;
    state.vault = profile
      ? { ...vault, passkeyCredentialProfile: profile }
      : vault;
  }
  // Read-only hydration stays inside the persistence lock. Neither an empty
  // fallback nor a no-op callback may retire the only durable old snapshot.
  await context.rehydrate(state);
  const restored = context.getState().vault;
  if (
    JSON.stringify(recoveryAccountRecords(restored.accounts)) !==
      JSON.stringify(recoveryAccountRecords(vault.accounts)) ||
    restored.activeNetwork?.slip44 !== vault.activeNetwork?.slip44 ||
    restored.activeNetwork?.slip44 !== slip44
  )
    throw new Error('Wallet recovery account restoration is incomplete');
  // Preserve the loader's embedded-profile migration without letting ordinary
  // Redux saves through the gate or recursively acquiring the persistence lock.
  if (
    vault.passkeyCredentialProfile &&
    !journal.before[profileKey]?.passkeyCredentialProfile
  )
    await context.storage.setItem(profileKey, {
      passkeyCredentialProfile: vault.passkeyCredentialProfile,
    });
  if (!isolatedVault) {
    // Cold startup hydrates only the isolated record. Make a legacy inline-only
    // restoration durable before retiring its last backup, even without a later
    // popup-close save. The detached profile is already durable above.
    const { passkeyCredentialProfile, ...isolated } = restored;
    void passkeyCredentialProfile;
    await context.storage.setItem(`state-vault-${slip44}`, isolated);
  }
  await context.storage.removeItem(JOURNAL_KEY);
  const remainingJournal = (await getAll())[JOURNAL_KEY];
  if (remainingJournal !== undefined && remainingJournal !== null)
    throw new Error('Wallet recovery backup cleanup failed');
  walletPersistenceGate.blocked = false;
  return true;
};

/** Run before migrations/rehydration on cold startup; failed reads fail closed. */
export const reconcileWalletRecoveryJournal = (
  context: WalletRecoveryContext
): Promise<boolean> => {
  walletPersistenceGate.blocked = true;
  return context.persistenceMutex.runExclusive(() =>
    reconcileWithinLock(context)
  );
};

/** An authenticated forget retains a rollback snapshot until all cleanup commits. */
export const forgetWalletWithRecovery = async (
  controller: MainController,
  context: WalletRecoveryContext
): Promise<void> => {
  const wallet = controller as unknown as RecoveryHost;
  const generation = wallet.walletSessionGeneration;
  const stateGeneration = wallet.walletStateGeneration;
  const assertCurrent = () => {
    if (
      generation !== wallet.walletSessionGeneration ||
      stateGeneration !== wallet.walletStateGeneration
    )
      throw new Error('Wallet state changed before removal');
  };
  let backedUp = false;
  let resetCompleted = false;
  try {
    await context.persistenceMutex.runExclusive(async () => {
      assertCurrent();
      const current = await getAll();
      if (current[JOURNAL_KEY] !== undefined && current[JOURNAL_KEY] !== null)
        throw new Error('Reload the wallet to finish the previous recovery');
      assertStoredPair(current);
      const before = snapshot(current);
      const candidate: RecoveryJournal = {
        version: 1,
        before,
        checksum: await digest(before),
      };
      assertCurrent();
      wallet.recoveryJournalPending = true;
      await context.storage.setItem(JOURNAL_KEY, candidate);
      // A no-op storage acknowledgement cannot authorize deleting the only copy.
      const saved = await validateJournal((await getAll())[JOURNAL_KEY]);
      if (saved.checksum !== candidate.checksum || saved.committedFingerprint)
        throw new Error('Wallet removal backup could not be verified');
      backedUp = true;
      assertCurrent();
    });
    await wallet.resetWalletState({ resetNetworks: true });
    await context.persistenceMutex.runExclusive(async () => {
      const remaining = await getAll();
      if (
        Object.keys(remaining).some(
          (key) =>
            resetOwnedKey(key) &&
            remaining[key] !== undefined &&
            remaining[key] !== null
        )
      )
        throw new Error('Wallet removal left saved account data');
      resetCompleted = true;
      await context.storage.removeItem(JOURNAL_KEY);
      const retired = await getAll();
      if (retired[JOURNAL_KEY] !== undefined && retired[JOURNAL_KEY] !== null)
        throw new Error('Wallet removal backup cleanup failed');
    });
    wallet.recoveryJournalPending = false;
  } catch (error) {
    if (!wallet.recoveryJournalPending) throw error;
    // Stop ordinary/emergency saves before rollback or any ambiguous read.
    walletPersistenceGate.blocked = true;
    wallet.lock();
    const current = await getAll();
    if (current[JOURNAL_KEY] === undefined || current[JOURNAL_KEY] === null) {
      // The final deletion can apply even when its callback reports failure.
      // This is success only after the entire reset completed; otherwise no
      // destructive action was admitted without a verified backup.
      if (resetCompleted || !backedUp) {
        wallet.recoveryJournalPending = false;
        walletPersistenceGate.blocked = false;
        if (resetCompleted) return;
      }
      throw error;
    }
    await reconcileWalletRecoveryJournal(context);
    wallet.recoveryJournalPending = false;
    throw error;
  }
};

/** A failed same-worker cleanup must finish before any keyring is usable. */
export const prepareWalletRecoveryAccess = async (
  controller: MainController,
  context: WalletRecoveryContext
): Promise<void> => {
  const wallet = controller as unknown as RecoveryHost;
  await context.persistenceMutex.runExclusive(async () => {
    const current = await getAll();
    const stored = current[JOURNAL_KEY];
    if (stored === undefined || stored === null)
      throw new Error('Reload the extension to finish wallet recovery');
    const journal = await validateJournal(stored);
    if (!journal.committedFingerprint)
      throw new Error('Reload the extension to finish wallet recovery');
    await assertCommittedRecords(current, journal);
    await retireCommittedJournal(context, wallet);
  });
};

const cleanupCommittedRecovery = async (
  wallet: RecoveryHost,
  context: WalletRecoveryContext
) => {
  try {
    await retireCommittedJournal(context, wallet);
  } catch {
    // Keep the committed pair and journal. No signing/mutation may proceed
    // until cleanup succeeds or cold startup reconciles the durable marker.
    wallet.lock();
    throw new Error('Reload the extension to finish wallet recovery cleanup');
  }
};

export const runWalletSetup = async (
  controller: MainController,
  recovery: boolean,
  password: string,
  phrase: string,
  token: string | undefined,
  walletStateGeneration: number,
  generation: number,
  context: WalletRecoveryContext
): Promise<void> => {
  const wallet = controller as unknown as RecoveryHost;
  const ticket = recovery ? tickets.get(controller) : undefined;
  if (recovery && ticket?.token === token) tickets.delete(controller);
  const assertCurrent = () => {
    if (
      walletStateGeneration !== wallet.walletStateGeneration ||
      (recovery && generation !== wallet.walletSessionGeneration)
    )
      throw new Error('Wallet state changed before reset');
  };
  return wallet.authenticationMutex.runExclusive(async () => {
    assertCurrent();
    if (!recovery) {
      const pending = await context.storage.getItems([JOURNAL_KEY]);
      if (pending[JOURNAL_KEY] !== undefined && pending[JOURNAL_KEY] !== null)
        throw new Error('Reload the extension to finish the previous recovery');
      // Ordinary onboarding never overwrites a durable wallet.
      if (await context.readPresence())
        throw new Error(
          'A wallet already exists. Unlock it or explicitly forget it before starting setup.'
        );
      assertCurrent();
      return wallet.createWalletExclusive(password, phrase);
    }
    assertLocked(wallet);
    if (
      !ticket ||
      token !== ticket.token ||
      ticket.generation !== generation ||
      ticket.walletStateGeneration !== walletStateGeneration ||
      Date.now() - ticket.createdAt > TICKET_LIFETIME_MS
    )
      throw new Error('Seed recovery expired. Start recovery again');
    if (!isStrongWalletPassword(password))
      throw new Error(
        'Recovery password does not meet the strong password requirements'
      );
    if (typeof phrase !== 'string' || !wallet.isSeedValid(phrase))
      throw new Error('Invalid recovery phrase');
    try {
      assertMatchingSeed(phrase, ticket.identity);
    } catch {
      // Vendor validation errors can include their input; never return/log it.
      throw new Error('Recovery phrase does not match this wallet');
    }
    if (JSON.stringify(identity(context)) !== JSON.stringify(ticket.identity))
      throw new Error('Wallet account changed before recovery');

    let before!: Records;
    await context.persistenceMutex.runExclusive(async () => {
      assertCurrent();
      assertLocked(wallet);
      const current = await getAll();
      if (current[JOURNAL_KEY] !== null && current[JOURNAL_KEY] !== undefined)
        throw new Error('Reload the wallet to finish the previous recovery');
      assertStoredPair(current);
      if ((await pairFingerprint(current)) !== ticket.pairFingerprint)
        throw new Error('Wallet storage changed before recovery');
      before = snapshot(current);
    });
    // Reconstruct only in the memory host. Missing recovery copies or an
    // unsupported private domain fail before touching the active pair.
    const after = await prepareExtensionAccountRecovery(
      before,
      password,
      phrase,
      () => {
        assertCurrent();
        assertLocked(wallet);
      }
    );
    assertCurrent();
    assertLocked(wallet);
    const journal: RecoveryJournal = {
      version: 1,
      before,
      checksum: await digest(before),
    };
    await context.persistenceMutex.runExclusive(async () => {
      assertCurrent();
      assertLocked(wallet);
      const current = await getAll();
      if (
        (current[JOURNAL_KEY] !== null && current[JOURNAL_KEY] !== undefined) ||
        (await digest(snapshot(current))) !== journal.checksum
      )
        throw new Error('Wallet storage changed before recovery');
      wallet.recoveryJournalPending = true;
      walletPersistenceGate.blocked = true;
      try {
        await context.storage.setItem(JOURNAL_KEY, journal);
        const persisted = (await getAll())[JOURNAL_KEY];
        if (
          JSON.stringify(await validateJournal(persisted)) !==
          JSON.stringify(journal)
        )
          throw new Error('Wallet recovery backup was not saved');
      } catch (error) {
        const pending = await context.storage.getItems([JOURNAL_KEY]);
        if (
          pending[JOURNAL_KEY] === null ||
          pending[JOURNAL_KEY] === undefined
        ) {
          wallet.recoveryJournalPending = false;
          walletPersistenceGate.blocked = false;
        }
        throw error;
      }
    });
    const assertInstalledSession = () => {
      if (
        wallet.walletStateGeneration !== walletStateGeneration + 1 ||
        wallet.walletSessionGeneration !== generation + 1
      )
        throw new Error('Wallet state changed during recovery');
    };
    try {
      assertCurrent();
      await wallet.retireWalletRuntime();
      assertInstalledSession();
      await context.persistenceMutex.runExclusive(async () => {
        assertInstalledSession();
        const current = await getAll();
        if (
          (await digest(snapshot(current))) !== journal.checksum ||
          JSON.stringify(await validateJournal(current[JOURNAL_KEY])) !==
            JSON.stringify(journal)
        )
          throw new Error('Wallet storage changed during recovery');
        assertInstalledSession();
        await context.storage.setItems(after);
        const committed = snapshot(await getAll());
        assertInstalledSession();
        if ((await digest(committed)) !== (await digest(after)))
          throw new Error('Recovered wallet was not durably saved');
        const state = { ...after.state };
        delete state.vault;
        await context.rehydrate(state);
        assertInstalledSession();
        const active =
          after[`state-vault-${after.state.vaultGlobal.activeSlip44}`];
        if (
          JSON.stringify(
            recoveryAccountRecords(context.getState().vault.accounts)
          ) !== JSON.stringify(recoveryAccountRecords(active.accounts))
        )
          throw new Error('Recovered account records were not restored');
      });
      await wallet.activateRecoveredWallet(password, assertInstalledSession);
      assertInstalledSession();
      await context.persistenceMutex.runExclusive(async () => {
        assertInstalledSession();
        const current = await getAll();
        if ((await digest(snapshot(current))) !== (await digest(after)))
          throw new Error('Recovered wallet storage changed');
        const committedIdentity = savedCommittedIdentity(current);
        const committed = {
          ...journal,
          committedIdentity,
          committedFingerprint: await committedFingerprint(
            current,
            committedIdentity
          ),
        };
        assertInstalledSession();
        await context.storage.setItem(JOURNAL_KEY, committed);
        const observed = await getAll();
        assertInstalledSession();
        const marker = await validateJournal(observed[JOURNAL_KEY]);
        if (JSON.stringify(marker) !== JSON.stringify(committed))
          throw new Error('Wallet recovery commit was not saved');
        await assertCommittedRecords(observed, marker);
      });
    } catch {
      walletPersistenceGate.blocked = true;
      wallet.lock();
      const current = await getAll();
      const durableJournal = await validateJournal(current[JOURNAL_KEY]);
      if (durableJournal.committedFingerprint) {
        await assertCommittedRecords(current, durableJournal);
        await cleanupCommittedRecovery(wallet, context);
        return;
      }
      // Only the exact admitted old/new ciphertext may be compensated. An
      // unrelated wallet must never receive this operation's old snapshot.
      const observed = snapshot(current);
      const keys = Object.keys(observed);
      const admittedKeys = Object.keys(before);
      const admittedPartialWrite =
        keys.length === admittedKeys.length &&
        keys.every(
          (key) =>
            admittedKeys.includes(key) &&
            [before[key], after[key]].some(
              (value) => JSON.stringify(value) === JSON.stringify(observed[key])
            )
        );
      if (durableJournal.checksum !== journal.checksum || !admittedPartialWrite)
        throw new Error('Reload the extension to finish wallet recovery');
      await wallet.retireWalletRuntime();
      await reconcileWalletRecoveryJournal(context);
      wallet.recoveryJournalPending = false;
      throw new Error(
        'Wallet recovery failed. Your previous wallet was restored'
      );
    }
    // A committed marker makes a lost cleanup acknowledgement safe on restart.
    wallet.lock();
    await cleanupCommittedRecovery(wallet, context);
  });
};
