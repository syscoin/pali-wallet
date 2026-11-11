import { getNetworkConfig } from '@sidhujag/sysweb3-network';

import { isStrongWalletPassword } from '../shared/passwordPolicy.ts';

import type { AccountRecords, AccountRecordSelection } from './accountRecords';
import {
  assertImportedRecoveryAccount,
  readImportedRecoverySecret,
  snapshotImportedRecoveryEntry,
  type ImportedRecoveryEntry,
} from './importedAccountRecovery.ts';
import type { KeyringAccountType, INetwork } from '../types/network';

type Sdk = typeof import('@sidhujag/sysweb3-keyring/cjs/software.js');
type Keyring = InstanceType<Sdk['SoftwareKeyring']>;
type RecoveryOptions = Readonly<{
  assertCurrent(): void;
  captureSession?: (keyring: Keyring) => () => void;
  /** Enables checkpoint creation on this exact temporary pair; never an unlock fallback. */
  fingerprintPair?: (pair: StagedAccountRecovery['pair']) => Promise<string>;
  loadSdk?: () => Promise<Sdk>;
  validateRetained?: (session: {
    assertCurrent(): void;
    keyring: Keyring;
    profileId: string;
    staged: StagedAccountRecovery;
  }) => Promise<void>;
  verifyRoot?: (
    identity: Readonly<{
      address: string;
      profileId: string;
      publicKey: string;
    }>
  ) => Promise<void>;
}>;

export type RecoveryAccountGroup = Readonly<{
  accounts: AccountRecords;
  activeAccount: AccountRecordSelection;
  activeNetwork: INetwork;
  key: string;
}>;
export type StagedAccountRecovery = Readonly<{
  groups: readonly RecoveryAccountGroup[];
  pair: Readonly<{ keys: unknown; vault: string }>;
  profileId: string;
}>;

const invalid = (): never => {
  throw new Error('WALLET_RECOVERY_DATA_INVALID');
};

/**
 * Rewrap existing SDK account records in an isolated software session. Hosts
 * own tickets, retained encrypted domains and the atomic durable replacement.
 * This operation never opens the live wallet or writes to platform storage.
 */
async function stageWallet(
  input: Readonly<{
    groups: readonly RecoveryAccountGroup[];
    imported: readonly ImportedRecoveryEntry[];
    password: string;
    phrase: string;
  }>,
  options: RecoveryOptions,
  creating: boolean
): Promise<StagedAccountRecovery> {
  const {
    assertCurrent,
    loadSdk,
    validateRetained,
    captureSession,
    verifyRoot,
    fingerprintPair,
  } = options;
  const { password, phrase } = input;
  const check = () => {
    if (assertCurrent() !== undefined) invalid();
  };
  check();
  if (!isStrongWalletPassword(password) || !input.groups.length)
    return invalid();
  // These are the host's already validated persisted JSON records, not an
  // external request. Match their storage representation in both JS runtimes
  // without requiring a global structuredClone implementation on the phone.
  const groups: RecoveryAccountGroup[] = JSON.parse(
    JSON.stringify(input.groups)
  );
  const initialGroup = groups[0] ?? invalid();
  const imported = input.imported.map((entry) =>
    snapshotImportedRecoveryEntry(entry)
  );
  const importedKey = (kind: string, slip44: number, id: number) =>
    `${kind}:${slip44}:${id}`;
  const importedByAccount = new Map<string, ImportedRecoveryEntry>();
  for (const entry of imported) {
    const key = importedKey(
      entry.identity.kind,
      entry.identity.slip44,
      entry.identity.id
    );
    if (importedByAccount.has(key)) invalid();
    importedByAccount.set(key, entry);
  }
  const sdk = await (loadSdk?.() ??
    import('@sidhujag/sysweb3-keyring/cjs/software.js'));
  check();
  const values = new Map<string, unknown>();
  const allowed = (key: string) => {
    check();
    if (key !== 'vault' && key !== 'vault-keys') invalid();
  };
  const keyring = new sdk.SoftwareKeyring(
    sdk.createKeyringHost({
      ...(fingerprintPair
        ? {
            async readDeviceUnlockVaultPair() {
              check();
              const vault = values.get('vault'),
                keys = values.get('vault-keys');
              if (vault === undefined && keys === undefined) return null;
              if (
                typeof vault !== 'string' ||
                !keys ||
                typeof keys !== 'object'
              )
                return invalid();
              const pair = Object.freeze({ vault, keys });
              const pairFingerprint = await fingerprintPair(pair);
              check();
              if (
                values.get('vault') !== vault ||
                values.get('vault-keys') !== keys
              )
                return invalid();
              return { ...pair, pairFingerprint };
            },
          }
        : {}),
      async get(key) {
        allowed(key);
        return values.get(key);
      },
      async set() {
        return invalid();
      },
      async deleteItem() {
        return invalid();
      },
      async createManyIfAbsent(items) {
        check();
        if (
          Object.keys(items).sort().join(',') !== 'vault,vault-keys' ||
          values.size
        )
          return invalid();
        for (const [key, value] of Object.entries(items)) {
          allowed(key);
          values.set(key, value);
        }
        return true;
      },
    }),
    { captureEvmSubmission: null }
  );
  const emptyAccounts = (): AccountRecords => ({
    HDAccount: {},
    Imported: {},
    Ledger: {},
    Trezor: {},
    SmartAccount: {},
  });
  let state = {
    activeNetwork: initialGroup.activeNetwork,
    activeAccount: initialGroup.activeAccount,
    accounts: emptyAccounts(),
  };
  keyring.setVaultStateGetter(() => state);
  let releaseSession: (() => void) | undefined;
  let recovered: StagedAccountRecovery;
  try {
    releaseSession = captureSession?.(keyring);
    if (!keyring.isSeedValid(phrase))
      throw new Error('WALLET_RECOVERY_PHRASE_INVALID');
    await keyring.initializeSession(phrase, password);
    check();
    const profileId = await keyring.getPrivateRecordProfileId();
    check();
    if (!/^0x[0-9a-f]{64}$/.test(profileId)) return invalid();
    if (creating) {
      if (groups.length !== 1 || imported.length !== 0) invalid();
      const first = await keyring.createFirstAccount();
      check();
      if (
        !first ||
        first.id !== 0 ||
        first.isImported ||
        first.isLedgerWallet ||
        first.isTrezorWallet ||
        first.isSmartAccount ||
        !first.xprv ||
        !first.xpub ||
        !first.address
      )
        invalid();
      initialGroup.accounts.HDAccount[0] = first;
    }
    const usedCopies = new Set<ImportedRecoveryEntry>();
    const groupKeys = new Set<string>();
    for (const group of groups) {
      if (
        typeof group.key !== 'string' ||
        !group.key ||
        groupKeys.has(group.key)
      )
        invalid();
      groupKeys.add(group.key);
      const { activeNetwork: network, accounts } = group;
      state = {
        activeNetwork: network,
        activeAccount: group.activeAccount,
        accounts: emptyAccounts(),
      };
      if (
        !['ethereum', 'syscoin'].includes(network.kind) ||
        !Number.isSafeInteger(network.slip44) ||
        network.slip44 < 0 ||
        !Number.isSafeInteger(network.chainId) ||
        network.chainId < (network.kind === 'ethereum' ? 1 : 0) ||
        typeof network.url !== 'string' ||
        !network.url ||
        (network.kind === 'ethereum') !== (network.slip44 === 60)
      )
        invalid();
      for (const [type, records] of Object.entries(accounts)) {
        if (
          !Object.hasOwn(state.accounts, type) ||
          !records ||
          Array.isArray(records)
        )
          invalid();
        for (const [id, account] of Object.entries(records)) {
          if (
            !Number.isSafeInteger(account.id) ||
            account.id < 0 ||
            String(account.id) !== id ||
            typeof account.xpub !== 'string' ||
            !account.xpub ||
            typeof account.address !== 'string' ||
            !account.address
          )
            invalid();
          check();
          if (type === 'HDAccount' && !creating) {
            if (
              account.isImported ||
              account.isLedgerWallet ||
              account.isTrezorWallet ||
              account.isSmartAccount
            )
              invalid();
            if (network.kind === 'ethereum') {
              const derived = await keyring.deriveEvmHdRuntimeAccount(
                { index: account.id },
                { assertCurrent: check }
              );
              check();
              if (account.id === 0) {
                await verifyRoot?.({
                  address: derived.address,
                  publicKey: derived.xpub.toLowerCase(),
                  profileId,
                });
                check();
              }
              if (
                derived.address.toLowerCase() !==
                  account.address.toLowerCase() ||
                derived.xpub.toLowerCase() !== account.xpub.toLowerCase()
              )
                invalid();
              account.xprv = derived.xprv;
            } else {
              // These are the existing extension recovery proof and SDK
              // account encryptor; account IDs are never inferred or filled.
              // Import the existing portable signer entry, not the extension
              // package entry that initializes hardware dependencies. Keep
              // it in the worker's loaded chunk for MV3 cold recovery.
              const { getSyscoinSigners } = await import(
                /* webpackMode: "eager" */ '@sidhujag/sysweb3-keyring/cjs/signers.js'
              );
              check();
              const config = getNetworkConfig(network.slip44, network.currency);
              const { hd } = getSyscoinSigners({
                mnemonic: phrase,
                rpc: {
                  formattedNetwork: network,
                  networkConfig: {
                    networks: config.networks,
                    types: {
                      xPubType: config.types.xPubType ?? invalid(),
                      zPubType: config.types.zPubType ?? invalid(),
                    },
                  },
                },
              });
              hd.createAccountAtIndex(account.id, 84);
              if (hd.getAccountXpub() !== account.xpub) invalid();
              account.xprv = keyring.getEncryptedXprv(hd);
            }
          } else if (type === 'Imported' && account.xprv) {
            if (
              !account.isImported ||
              account.isLedgerWallet ||
              account.isTrezorWallet ||
              account.isSmartAccount
            )
              invalid();
            const copy =
              importedByAccount.get(
                importedKey(network.kind, network.slip44, account.id)
              ) ?? invalid();
            if (copy.envelope.profileId !== profileId) invalid();
            assertImportedRecoveryAccount(copy, {
              kind: network.kind,
              slip44: network.slip44,
              id: account.id,
              address: account.address,
              xpub: account.xpub,
            });
            const opened = await (async () => {
              try {
                return await readImportedRecoverySecret(
                  keyring,
                  copy,
                  copy.identity,
                  check
                );
              } catch {
                check();
                return invalid();
              }
            })();
            check();
            const restored = await keyring.importAccount(
              opened.secret,
              account.label,
              opened.options ?? undefined
            );
            check();
            if (
              restored.xpub !== copy.identity.xpub ||
              restored.address !== copy.identity.address ||
              !restored.isImported ||
              !restored.xprv
            )
              invalid();
            account.xprv = restored.xprv;
            usedCopies.add(copy);
          } else if (account.xprv && !(creating && type === 'HDAccount')) {
            // Never leave an unsupported password-encrypted key readable only
            // with the old password while reporting recovery as complete.
            invalid();
          }
        }
      }
      if (!accounts[group.activeAccount.type]?.[group.activeAccount.id])
        invalid();
    }
    if (usedCopies.size !== imported.length) invalid();
    const vault = values.get('vault');
    const keys = values.get('vault-keys');
    if (
      typeof vault !== 'string' ||
      !vault ||
      !keys ||
      typeof keys !== 'object'
    )
      invalid();
    recovered = Object.freeze({
      groups,
      profileId,
      pair: Object.freeze({ vault: vault as string, keys }),
    });
    await validateRetained?.({
      keyring,
      profileId,
      staged: recovered,
      assertCurrent: check,
    });
    check();
  } finally {
    try {
      await keyring.destroy();
    } finally {
      values.clear();
      releaseSession?.();
    }
  }
  check();
  return recovered;
}

export function stageAccountRecovery(
  input: Readonly<{
    groups: readonly RecoveryAccountGroup[];
    imported: readonly ImportedRecoveryEntry[];
    password: string;
    phrase: string;
  }>,
  options: RecoveryOptions
): Promise<StagedAccountRecovery> {
  return stageWallet(input, options, false);
}

/** Stage the actual SDK's first record together with its encrypted pair. */
export function stageInitialWallet(
  input: Readonly<{
    key: string;
    network: INetwork;
    password: string;
    phrase: string;
  }>,
  options: RecoveryOptions
): Promise<StagedAccountRecovery> {
  return stageWallet(
    {
      password: input.password,
      phrase: input.phrase,
      imported: [],
      groups: [
        {
          key: input.key,
          activeNetwork: input.network,
          activeAccount: { id: 0, type: 'HDAccount' as KeyringAccountType },
          accounts: {
            HDAccount: {},
            Imported: {},
            Ledger: {},
            Trezor: {},
            SmartAccount: {},
          },
        },
      ],
    },
    options,
    true
  );
}
