import { getAddress } from 'ethers/address';
import { computeAddress } from 'ethers/transaction';
import { parseUtxoPublicIdentifier } from '../core/utxoIdentifier.ts';
import { normalizeUtxoAddress } from '../core/utxoAddresses.ts';
import { findUtxoNetwork, getUtxoSdkNetwork, isCustomUtxoNetworkId, projectUtxoRegistration, supportsUtxoSoftwareCustody, UTXO_NETWORKS, utxoRegistrationData,
  type UtxoNetwork, type UtxoRegistration } from '../core/utxoNetworks.ts';
import {
  NATIVE_NETWORKS,
  getNativeNetwork,
  snapshotNativeNetwork,
  type NativeNetworkRegistration,
  type EvmNetworkId,
} from './networkContext.ts';
import { ACCOUNT_RECORD_KEY, decodeAccountRecord as decodeStorageValue, encodeAccountRecord as encodeStorageValue } from '../storage/accountRecordKey.ts';
import type { KeyringStoragePort } from '../storage/types.ts';
import { getFirstCompatibleAccountForNetwork, isAccountCompatibleWithNetwork } from '../../../../source/utils/accountCompatibility.ts';
import { requireSmartAccountAddressIdentity } from '../../../../source/utils/smartAccount/addressIdentity.ts';
import { encodeEcdsaValidatorInitData, getConfiguredAuthenticatorAddress, type PaliRecoveryTarget } from '../../../../source/utils/smartAccount/account.ts';
import type { SmartAccountGuardianRecoveryOperation } from '../../../../source/utils/smartAccount/recovery.ts';
import { captureGuardianRecoveryIntent } from '../../../../source/utils/smartAccount/guardianRecoveryIntent.ts';
import { nativeAccountId, parseNativeAccountId } from './accountIdentity.ts';
import {
  assertImportedRecoveryAccount,
  snapshotImportedRecoveryEntry,
  type ImportedRecoveryEntry,
} from '../../../../source/wallet/importedAccountRecovery.ts';
import {
  assertCompleteHDAccountData,
  assertAccountCreationAvailable,
  createAccountRecord,
  removeAccountRecord,
  setAccountRecordLabel,
  setActiveAccountRecord,
} from '../../../../source/wallet/accountRecords.ts';
import type {
  RecoveryAccountGroup,
  StagedAccountRecovery,
} from '../../../../source/wallet/accountRecovery.ts';
import type {
  INetworkType,
  IKeyringAccountState,
  ISmartAccountMetadata,
  KeyringAccountType as SharedAccountType,
} from '../../../../source/types/network.ts';
import { KeyringAccountType as SdkAccountType } from '@sidhujag/sysweb3-keyring/cjs/software.js';
const KeyringAccountType =
  SdkAccountType as unknown as typeof import('../../../../source/types/network.ts').KeyringAccountType;

export const WALLET_CATALOGUE_KEY = ACCOUNT_RECORD_KEY;
export type NativeCatalogueAccount = Readonly<{
  id: string;
  type: 'HDAccount' | 'Imported' | 'SmartAccount' | 'Ledger';
  smartAccount?: Readonly<{ chainId: number; isDeployed: boolean; localEcdsa: boolean; managementAddress: string }>;
  index: number;
  slip44: number;
  address: string;
  label: string;
  utxoExtended?: true;
}>;
/** Public projection. Complete encrypted SDK records remain inside custody. */
export type NativeWalletCatalogueSnapshot = Readonly<{
  revision: number;
  accounts: readonly NativeCatalogueAccount[];
  networks: readonly NativeNetworkRegistration[];
  utxoNetworks: readonly UtxoNetwork[];
  active: Readonly<{ accountId: string; networkId: EvmNetworkId }>;
}>;
export type NativeWalletCatalogueIdentity = Readonly<{
  walletFingerprint: string;
  address: string;
  publicKey: string;
}>;
export type DerivedCatalogueIdentity = Readonly<{
  address: string;
  publicKey: string;
}>;
type SavedUtxoNetwork = UtxoRegistration & Readonly<{ kind: 'utxo' }>;
type SavedNetwork = NativeNetworkRegistration | SavedUtxoNetwork;
export type NativeGuardianRecoveryAccountRef = Readonly<{
  id: string;
  address: string;
  xpub: string;
}>;
export type NativeGuardianRecoveryIntent = Readonly<{
  accountId: string;
  operation: SmartAccountGuardianRecoveryOperation;
  target: PaliRecoveryTarget;
  guardian: NativeGuardianRecoveryAccountRef;
  replacement: NativeGuardianRecoveryAccountRef;
}>;
type SmartAccountObservedMetadata = Pick<ISmartAccountMetadata,
  'auth' | 'availableModules' | 'isDeployed' | 'installedModules'>;
export type NativeAccountRecord = Readonly<{
  version: 1;
  revision: number;
  walletFingerprint: string;
  groups: readonly RecoveryAccountGroup[];
  recovery: readonly ImportedRecoveryEntry[];
  networks: readonly SavedNetwork[];
  active: Readonly<{ accountId: string; networkId: EvmNetworkId }>;
  guardianRecoveryIntents?: readonly NativeGuardianRecoveryIntent[];
}>;
export type CatalogueMutation =
  | Readonly<{ kind: 'create'; account: IKeyringAccountState }>
  | Readonly<{ kind: 'import-ledger'; account: IKeyringAccountState }>
  | Readonly<{ kind: 'create-smart'; account: IKeyringAccountState }>
  | Readonly<{ kind: 'mark-smart-deployed'; id: string }>
  | Readonly<{ kind: 'refresh-smart-metadata'; id: string; metadata: Pick<ISmartAccountMetadata,
    'auth' | 'availableModules' | 'isDeployed' | 'installedModules'> }>
  | Readonly<{ kind: 'store-guardian-recovery'; id: string; intent: NativeGuardianRecoveryIntent; expectedOperationHash: string | null }>
  | Readonly<{ kind: 'retire-guardian-recovery'; id: string; operationHash: string }>
  | Readonly<{ kind: 'complete-guardian-recovery'; id: string; operationHash: string; metadata: SmartAccountObservedMetadata }>
  | Readonly<{
      kind: 'import';
      account: IKeyringAccountState;
      recovery: ImportedRecoveryEntry;
    }>
  | Readonly<{ kind: 'select'; id: string }>
  | Readonly<{ kind: 'select-network'; id: EvmNetworkId; initialGroup?: RecoveryAccountGroup }>
  | Readonly<{ kind: 'save-network'; registration: NativeNetworkRegistration }>
  | Readonly<{ kind: 'add-utxo-network'; registration: UtxoRegistration }>
  | Readonly<{ kind: 'edit-utxo-network'; registration: UtxoRegistration }>
  | Readonly<{ kind: 'remove-utxo-network'; id: EvmNetworkId }>
  | Readonly<{ kind: 'remove-network'; id: EvmNetworkId }>
  | Readonly<{ kind: 'rename'; id: string; label: string }>
  | Readonly<{ kind: 'remove'; id: string }>;
export type CatalogueRemovalCommit = (
  key: string,
  expected: unknown,
  next: unknown,
  assertCurrent: () => void
) => Promise<boolean>;

export class WalletCatalogueError extends Error {
  readonly code:
    | 'CATALOGUE_INVALID'
    | 'CATALOGUE_CONTEXT_CHANGED'
    | 'CATALOGUE_REOPEN_REQUIRED'
    | 'CATALOGUE_BUSY'
    | 'CATALOGUE_LIMIT'
    | 'CATALOGUE_NOT_REMOVABLE';
  constructor(code: WalletCatalogueError['code']) {
    super(code);
    this.code = code;
    this.name = 'WalletCatalogueError';
  }
}
const invalid = (): never => {
  throw new WalletCatalogueError('CATALOGUE_INVALID');
};
const changed = (): never => {
  throw new WalletCatalogueError('CATALOGUE_CONTEXT_CHANGED');
};
function snapshot<T>(value: T): T {
  return decodeStorageValue(encodeStorageValue(value)) as T;
}
function object(
  value: unknown,
  fields: readonly string[]
): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  const keys = Object.keys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key))
  )
    return invalid();
  return value as Record<string, any>;
}
function publicIdentity(
  value: DerivedCatalogueIdentity
): DerivedCatalogueIdentity {
  if (
    typeof value.address !== 'string' ||
    typeof value.publicKey !== 'string' ||
    !/^0x(?:(?:02|03)[0-9a-fA-F]{64}|04[0-9a-fA-F]{128})$/.test(value.publicKey)
  )
    return invalid();
  try {
    const address = getAddress(value.address);
    if (
      computeAddress(value.publicKey) !== address ||
      /^0x0{40}$/i.test(address)
    )
      return invalid();
    return Object.freeze({ address, publicKey: value.publicKey.toLowerCase() });
  } catch {
    return invalid();
  }
}
function softwareGroup(record: NativeAccountRecord): RecoveryAccountGroup {
  const group = record.groups.find(
    (group) =>
      group.activeNetwork.kind === 'ethereum' &&
      group.activeNetwork.slip44 === 60
  );
  return group ?? invalid();
}

function recoveryAccountReference(value: unknown, record: NativeAccountRecord): NativeGuardianRecoveryAccountRef {
  const raw = object(value, ['id', 'address', 'xpub']);
  const identity = parseNativeAccountId(raw.id);
  if (identity.slip44 !== 60 || !['HDAccount', 'Imported'].includes(identity.type)) return invalid();
  const account = softwareGroup(record).accounts[identity.type]?.[identity.index];
  const publicKey = publicIdentity({ address: raw.address, publicKey: raw.xpub });
  if (!account?.xprv || account.address.toLowerCase() !== publicKey.address.toLowerCase() ||
      account.xpub.toLowerCase() !== publicKey.publicKey) return invalid();
  return Object.freeze({ id: identity.id, address: publicKey.address, xpub: publicKey.publicKey });
}

function snapshotGuardianRecoveryIntent(value: unknown, record: NativeAccountRecord): NativeGuardianRecoveryIntent {
  const raw = object(value, ['accountId', 'operation', 'target', 'guardian', 'replacement']);
  const identity = parseNativeAccountId(raw.accountId);
  if (identity.type !== 'SmartAccount' || identity.slip44 !== 60) return invalid();
  const account = softwareGroup(record).accounts.SmartAccount[identity.index];
  if (!account?.smartAccount) return invalid();
  const { operation, target } = captureGuardianRecoveryIntent({ operation: raw.operation, target: raw.target });
  requireSmartAccountAddressIdentity(account, operation.chainId);
  if (getAddress(account.address) !== operation.account) return invalid();
  const guardian = recoveryAccountReference(raw.guardian, record);
  const replacement = recoveryAccountReference(raw.replacement, record);
  if (target.auth.module !== 'ecdsa' ||
      getAddress(target.auth.validator) !== getAddress(getConfiguredAuthenticatorAddress(operation.chainId, 'ecdsa')) ||
      target.auth.data.toLowerCase() !== encodeEcdsaValidatorInitData([replacement.address], 1).toLowerCase()) return invalid();
  return Object.freeze({ accountId: identity.id, operation, target, guardian, replacement });
}
export function catalogueEvmNetworks(record: NativeAccountRecord): readonly NativeNetworkRegistration[] {
  return record.networks.filter((network) => network.kind === 'evm');
}

function savedUtxoNetwork({ kind: _kind, ...registration }: SavedUtxoNetwork): UtxoNetwork {
  const network = projectUtxoRegistration(registration);
  if (!isCustomUtxoNetworkId(network.id)) return invalid();
  return network;
}

export function catalogueUtxoNetworks(networks: readonly SavedNetwork[]): readonly UtxoNetwork[] {
  return Object.freeze([...UTXO_NETWORKS, ...networks.filter((network) => network.kind === 'utxo').map(savedUtxoNetwork)]);
}

export function catalogueAccountGroup(
  record: NativeAccountRecord,
  networkId = record.active.networkId
): RecoveryAccountGroup | undefined {
  const network = findUtxoNetwork(networkId, catalogueUtxoNetworks(record.networks));
  return network
    ? record.groups.find(({ activeNetwork }) => activeNetwork.kind === 'syscoin' &&
        activeNetwork.chainId === network.chainId && activeNetwork.slip44 === network.slip44)
    : softwareGroup(record);
}

function decode(value: unknown, binding: string): NativeAccountRecord {
  const captured = snapshot(value);
  const raw = object(captured, [
    'version',
    'revision',
    'walletFingerprint',
    'groups',
    'recovery',
    'networks',
    'active',
    ...(Object.prototype.hasOwnProperty.call(captured, 'guardianRecoveryIntents') ? ['guardianRecoveryIntents'] : []),
  ]);
  if (
    raw.version !== 1 ||
    !/^[0-9a-f]{64}$/.test(binding) ||
    raw.walletFingerprint !== binding ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 0 ||
    !Array.isArray(raw.groups) ||
    !raw.groups.length ||
    !Array.isArray(raw.recovery) ||
    !Array.isArray(raw.networks) ||
    !raw.networks.length ||
    raw.networks.length > 256
  )
    return invalid();
  const networks: SavedNetwork[] = raw.networks.map((entry: unknown) => {
    if ((entry as SavedNetwork | null)?.kind !== 'utxo') return snapshotNativeNetwork(entry);
    return Object.freeze({ kind: 'utxo', ...utxoRegistrationData(savedUtxoNetwork(entry as SavedUtxoNetwork)) });
  });
  const evm = networks.filter((entry) => entry.kind === 'evm');
  const utxos = catalogueUtxoNetworks(networks);
  const ids = [...evm, ...utxos].map(({ id }) => id);
  if (!evm.length || new Set(ids).size !== ids.length ||
      new Set(evm.map(({ chainId }) => chainId)).size !== evm.length ||
      new Set(utxos.map(({ chainId }) => chainId)).size !== utxos.length ||
      new Set(utxos.map(({ slip44 }) => slip44)).size !== utxos.length)
    return invalid();
  const groupKeys = new Set<string>();
  const groups: RecoveryAccountGroup[] = [];
  for (const group of raw.groups as RecoveryAccountGroup[]) {
    object(group, ['key', 'activeNetwork', 'activeAccount', 'accounts']);
    const network = group.activeNetwork;
    if (
      !network ||
      !['ethereum', 'syscoin'].includes(network.kind) ||
      !Number.isSafeInteger(network.slip44) ||
      network.slip44 < 0 ||
      group.key !== String(network.slip44) ||
      groupKeys.has(group.key)
    )
      return invalid();
    groupKeys.add(group.key);
    const utxo = network.kind === 'syscoin'
      ? utxos.find((registration) => registration.chainId === network.chainId && registration.slip44 === network.slip44)
      : undefined;
    const currentNetwork = utxo && getUtxoSdkNetwork(utxo);
    if (network.kind === 'syscoin') {
      if (!currentNetwork || network.currency !== currentNetwork.currency ||
          typeof network.url !== 'string')
        return invalid();
    } else if (network.slip44 !== 60) return invalid();
    object(group.accounts, Object.values(KeyringAccountType));
    assertCompleteHDAccountData(group.accounts.HDAccount);
    for (const [type, accounts] of Object.entries(group.accounts)) {
      if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts) ||
          (utxo && type !== 'HDAccount' && type !== 'Imported' && type !== 'Ledger' && Object.keys(accounts).length))
        return invalid();
      for (const [id, account] of Object.entries(accounts)) {
        if (
          !Number.isSafeInteger(account.id) ||
          account.id < 0 ||
          String(account.id) !== id ||
          typeof account.address !== 'string' ||
          !account.address ||
          typeof account.xpub !== 'string' ||
          !account.xpub ||
          typeof account.xprv !== 'string' ||
          typeof account.label !== 'string'
        )
          return invalid();
        if (
          type === 'HDAccount' &&
          (!account.xprv ||
            account.isImported ||
            account.isLedgerWallet ||
            account.isTrezorWallet ||
            account.isSmartAccount)
        )
          return invalid();
        if (type === 'Ledger') {
          if (!account.isLedgerWallet || account.isImported || account.isTrezorWallet || account.isSmartAccount || account.xprv !== '') return invalid();
          if (network.kind === 'ethereum') publicIdentity({ address: account.address, publicKey: `0x${account.xpub.replace(/^0x/, '')}` });
        }
        if (type === 'SmartAccount') {
          if (network.kind !== 'ethereum' || !account.isSmartAccount || account.isImported || account.isLedgerWallet || account.isTrezorWallet || account.xprv !== '' ||
              !Number.isSafeInteger(account.smartAccount?.chainId) || account.smartAccount!.chainId < 1)
            return invalid();
          requireSmartAccountAddressIdentity({ address: account.address, xpub: account.xpub, smartAccount: account.smartAccount }, account.smartAccount!.chainId);
        }
        if (
          network.kind === 'ethereum' &&
          ['HDAccount', 'Imported'].includes(type) &&
          account.xprv
        )
          publicIdentity({ address: account.address, publicKey: account.xpub });
        if (utxo) {
          if (normalizeUtxoAddress(account.address, utxo) !== account.address)
            return invalid();
          const bip84 = /^(?:zpub|vpub)[1-9A-HJ-NP-Za-km-z]{107}$/.test(account.xpub);
          if ((type === 'HDAccount' || type === 'Ledger') && !bip84)
            return invalid();
          if (type === 'Imported' &&
              ((account.xpub !== account.address &&
                (!bip84 || !account.xpub.startsWith(utxo.testnet ? 'vpub' : 'zpub'))) ||
               !account.xprv || account.isImported !== true ||
               account.isLedgerWallet || account.isTrezorWallet || account.isSmartAccount))
            return invalid();
        }
      }
    }
    if (!group.accounts[group.activeAccount.type]?.[group.activeAccount.id])
      return invalid();
    // The group stores chain identity. Its saved endpoint cannot configure
    // custody or recovery after the shared default changes.
    groups.push(currentNetwork ? { ...group, activeNetwork: currentNetwork } : group);
  }
  const recoveries = raw.recovery.map((entry: unknown) =>
    snapshotImportedRecoveryEntry(entry)
  ) as ImportedRecoveryEntry[];
  const identities = new Set<string>();
  for (const entry of recoveries) {
    const key = `${entry.identity.slip44}:${entry.identity.id}`;
    if (identities.has(key)) return invalid();
    identities.add(key);
    const group = groups.find(
      (group) => group.activeNetwork.slip44 === entry.identity.slip44
    );
    const account = group?.accounts.Imported[entry.identity.id];
    if (!group || !account?.xprv || !account.isImported) return invalid();
    assertImportedRecoveryAccount(entry, {
      kind: group.activeNetwork.kind,
      slip44: entry.identity.slip44,
      id: account.id,
      address: account.address,
      xpub: account.xpub,
    });
  }
  for (const group of groups) {
    for (const account of Object.values(group.accounts.Imported))
      if (
        account.xprv &&
        !identities.has(`${group.activeNetwork.slip44}:${account.id}`)
      )
        return invalid();
  }
  const record = { ...(raw as NativeAccountRecord), groups, networks };
  if (!softwareGroup(record).accounts.HDAccount[0])
    return invalid();
  if (Object.prototype.hasOwnProperty.call(raw, 'guardianRecoveryIntents')) {
    const smartAccounts = Object.values(softwareGroup(record).accounts.SmartAccount);
    if (!Array.isArray(raw.guardianRecoveryIntents) || raw.guardianRecoveryIntents.length > smartAccounts.length) return invalid();
    const scopes = new Set<string>();
    record.guardianRecoveryIntents = Object.freeze(raw.guardianRecoveryIntents.map((value: unknown) => {
      const intent = snapshotGuardianRecoveryIntent(value, record);
      const scope = `${intent.operation.chainId}:${intent.operation.account}`;
      if (scopes.has(scope)) return invalid();
      scopes.add(scope);
      return intent;
    }));
  }
  const active = object(raw.active, ['accountId', 'networkId']) as NativeAccountRecord['active'];
  const selected = parseNativeAccountId(active.accountId);
  const group = catalogueAccountGroup(record, active.networkId);
  const account = group?.accounts[selected.type]?.[selected.index];
  const utxo = findUtxoNetwork(active.networkId, utxos);
  if (
    (!utxo && !networks.some((network) => network.id === active.networkId)) ||
    !group || selected.slip44 !== group.activeNetwork.slip44 || !account
  )
    return invalid();
  if (selected.type === 'SmartAccount' && account.smartAccount?.chainId !== Number(getNativeNetwork(active.networkId, catalogueEvmNetworks(record)).chainId)) return invalid();
  if (utxo) {
    const identity = parseUtxoPublicIdentifier(account.xpub, utxo);
    if (identity.kind !== (account.xpub === account.address ? 'address' : 'account') ||
        identity.identifier !== account.xpub || identity.address !== account.address)
      return invalid();
  }
  return Object.freeze({
    ...record,
    networks: Object.freeze(networks),
    active: Object.freeze({ ...active }),
  });
}
function publicAccounts(group: RecoveryAccountGroup, chainId?: number): NativeCatalogueAccount[] {
  const slip44 = group.activeNetwork.slip44;
  const accounts: NativeCatalogueAccount[] = (['HDAccount', 'Imported', 'Ledger'] as const).flatMap((type) =>
    Object.values(group.accounts[type]).map((account) => Object.freeze({
      id: nativeAccountId(type, account.id, slip44), type, index: account.id, slip44,
      address: account.address, label: account.label,
      ...(group.activeNetwork.kind === 'syscoin' && type === 'Imported' && account.xpub !== account.address ? { utxoExtended: true as const } : {}),
    }))
  );
  for (const account of Object.values(group.accounts.SmartAccount)) {
    const metadata = account.smartAccount!;
    if (chainId !== undefined && metadata.chainId !== chainId) continue;
    const managementAddress = /^pali:eip155:\d+:(0x[0-9a-f]{40}):smart-account-v1$/.exec(metadata.descriptor!.anchor)![1]!;
    accounts.push(Object.freeze({ id: nativeAccountId('SmartAccount', account.id), type: 'SmartAccount', index: account.id,
      slip44: 60, address: account.address, label: account.label,
      smartAccount: Object.freeze({ chainId: metadata.chainId, isDeployed: metadata.isDeployed === true, localEcdsa: (metadata.auth?.module ?? metadata.auth?.scheme) === 'ecdsa', managementAddress }),
    }));
  }
  return accounts;
}
function projection(record: NativeAccountRecord): NativeWalletCatalogueSnapshot {
  const group = catalogueAccountGroup(record) ?? invalid();
  return Object.freeze({
    revision: record.revision,
    accounts: Object.freeze(publicAccounts(group, group.activeNetwork.kind === 'ethereum' ? Number(getNativeNetwork(record.active.networkId, catalogueEvmNetworks(record)).chainId) : undefined)),
    networks: Object.freeze(catalogueEvmNetworks(record)),
    utxoNetworks: catalogueUtxoNetworks(record.networks),
    active: record.active,
  });
}
export function createNativeAccountRecord(
  staged: StagedAccountRecovery,
  walletFingerprint: string,
  networks: readonly NativeNetworkRegistration[] = NATIVE_NETWORKS
): NativeAccountRecord {
  const groups = staged.groups.map((group) => ({
    ...group,
    key: String(group.activeNetwork.slip44),
  }));
  const network =
    networks.find(
      (network) => network.chainId === String(groups[0]!.activeNetwork.chainId)
    ) ?? invalid();
  return decode(
    {
      version: 1,
      revision: 0,
      walletFingerprint,
      groups,
      recovery: [],
      networks,
      active: {
        accountId: nativeAccountId('HDAccount', 0),
        networkId: network.id,
      },
    },
    walletFingerprint
  );
}
export function recoveryVerificationRecords(
  value: unknown,
  binding: string
): NativeAccountRecord {
  return decode(value, binding);
}
export function inspectRecoveryCatalogue(value: unknown, binding: string) {
  const record = decode(value, binding),
    group = softwareGroup(record),
    first = group.accounts.HDAccount[0]!;
  return Object.freeze({
    root: publicIdentity({ address: first.address, publicKey: first.xpub }),
    accounts: Object.freeze(record.groups.flatMap((group) => publicAccounts(group))),
    importedProfiles: Object.freeze(
      record.recovery.map((entry) => entry.envelope.profileId)
    ),
  });
}
export function replaceRecoveredAccountRecords(
  value: unknown,
  binding: string,
  groups: readonly RecoveryAccountGroup[]
): NativeAccountRecord {
  const before = decode(value, binding);
  return decode({ ...before, revision: before.revision + 1, groups }, binding);
}
function guardFor(assertCurrent: () => void): () => void {
  return () => {
    if (assertCurrent() !== undefined) changed();
  };
}

/** One private persisted SDK map; unknown records remain intact and fail closed. */
export class NativeWalletCatalogue {
  private busy = false;
  private uncertain = false;
  private record: NativeAccountRecord | null = null;
  private stored: unknown;
  private root: NativeWalletCatalogueIdentity | null = null;
  private readonly storage: KeyringStoragePort;
  constructor(storage: KeyringStoragePort) {
    this.storage = storage;
  }
  get requiresReopen(): boolean {
    return this.uncertain;
  }
  get privateRecords(): NativeAccountRecord {
    if (!this.record) return changed();
    return snapshot(this.record);
  }
  async reconcile(
    value: NativeWalletCatalogueIdentity,
    assertCurrent: () => void
  ): Promise<NativeWalletCatalogueSnapshot> {
    if (this.busy) throw new WalletCatalogueError('CATALOGUE_BUSY');
    if (this.uncertain)
      throw new WalletCatalogueError('CATALOGUE_REOPEN_REQUIRED');
    this.busy = true;
    const guard = guardFor(assertCurrent);
    try {
      guard();
      const raw = await this.storage.get(WALLET_CATALOGUE_KEY);
      guard();
      const record = decode(raw, value.walletFingerprint);
      const first = softwareGroup(record).accounts.HDAccount[0]!;
      const root = publicIdentity({
        address: first.address,
        publicKey: first.xpub,
      });
      if (
        root.address !== value.address ||
        root.publicKey !== value.publicKey.toLowerCase()
      )
        return invalid();
      this.root = value;
      this.record = record;
      this.stored = snapshot(raw);
      return projection(record);
    } finally {
      this.busy = false;
    }
  }
  mutate(
    expectedRevision: number,
    input: Exclude<CatalogueMutation, { kind: 'remove' }>,
    assertCurrent: () => void
  ): Promise<NativeWalletCatalogueSnapshot>;
  mutate(
    expectedRevision: number,
    input: Extract<CatalogueMutation, { kind: 'remove' }>,
    assertCurrent: () => void,
    commitRemoval: CatalogueRemovalCommit
  ): Promise<NativeWalletCatalogueSnapshot>;
  async mutate(
    expectedRevision: number,
    input: CatalogueMutation,
    assertCurrent: () => void,
    commitRemoval?: CatalogueRemovalCommit
  ): Promise<NativeWalletCatalogueSnapshot> {
    if (input.kind === 'remove' && typeof commitRemoval !== 'function')
      return invalid();
    if (this.busy) throw new WalletCatalogueError('CATALOGUE_BUSY');
    if (this.uncertain)
      throw new WalletCatalogueError('CATALOGUE_REOPEN_REQUIRED');
    this.busy = true;
    const guard = guardFor(assertCurrent);
    let writing = false;
    try {
      guard();
      const record = this.record;
      if (
        !record ||
        !this.root ||
        record.revision !== expectedRevision ||
        record.revision === Number.MAX_SAFE_INTEGER
      )
        return changed();
      const next = snapshot(record) as NativeAccountRecord;
      const group = catalogueAccountGroup(next) ?? invalid();
      const mutation = snapshot(input);
      let active = next.active,
        networks = [...next.networks],
        recovery = [...next.recovery],
        groups = [...next.groups],
        guardianRecoveryIntents = next.guardianRecoveryIntents ? [...next.guardianRecoveryIntents] : undefined;
      if (mutation.kind === 'create' || mutation.kind === 'create-smart' || mutation.kind === 'import' || mutation.kind === 'import-ledger') {
        const type =
          mutation.kind === 'create' ? KeyringAccountType.HDAccount
            : mutation.kind === 'create-smart' ? KeyringAccountType.SmartAccount : mutation.kind === 'import-ledger' ? KeyringAccountType.Ledger : KeyringAccountType.Imported;
        if (type === KeyringAccountType.SmartAccount && (group.activeNetwork.kind !== 'ethereum' || mutation.account.smartAccount?.chainId !== Number(getNativeNetwork(active.networkId, catalogueEvmNetworks(next)).chainId))) return invalid();
        assertAccountCreationAvailable(
          group.accounts,
          type,
          mutation.account.id
        );
        createAccountRecord(
          group.accounts,
          mutation.account,
          type,
          group.activeNetwork.slip44
        );
        setActiveAccountRecord(
          group as { activeAccount: typeof group.activeAccount },
          { id: mutation.account.id, type }
        );
        active = {
          accountId: nativeAccountId(type, mutation.account.id, group.activeNetwork.slip44),
          networkId: active.networkId,
        };
        if (mutation.kind === 'import')
          recovery.push(snapshotImportedRecoveryEntry(mutation.recovery));
      } else if (mutation.kind === 'save-network') {
        const registration = snapshotNativeNetwork(mutation.registration),
          same = networks.find((network) => network.id === registration.id);
        if (
          (same && (same.kind !== 'evm' || same.chainId !== registration.chainId)) ||
          networks.some(
            (network) =>
              network.kind === 'evm' && network.id !== registration.id &&
              network.chainId === registration.chainId
          ) ||
          (!same && networks.length >= 256)
        )
          return invalid();
        networks = [
          ...networks.filter((network) => network.id !== registration.id),
          registration,
        ];
      } else if (mutation.kind === 'add-utxo-network') {
        const network = projectUtxoRegistration(mutation.registration);
        const existing = catalogueUtxoNetworks(networks);
        if (!isCustomUtxoNetworkId(network.id) || !supportsUtxoSoftwareCustody(network) ||
            networks.length >= 256 || networks.some(({ id }) => id === network.id) ||
            existing.some(({ chainId, slip44 }) => chainId === network.chainId || slip44 === network.slip44))
          return invalid();
        networks.push(Object.freeze({ kind: 'utxo', ...utxoRegistrationData(network) }));
      } else if (mutation.kind === 'edit-utxo-network') {
        const network = projectUtxoRegistration(mutation.registration);
        const index = networks.findIndex(({ id }) => id === network.id);
        const saved = networks[index];
        if (!saved || saved.kind !== 'utxo' || !isCustomUtxoNetworkId(network.id) ||
            saved.chainId !== network.chainId || saved.slip44 !== network.slip44 ||
            saved.backendChain !== network.backendChain || saved.explorer !== network.explorer)
          return invalid();
        networks[index] = Object.freeze({ kind: 'utxo', ...utxoRegistrationData(network) });
      } else if (mutation.kind === 'remove-utxo-network') {
        const saved = networks.find(({ id }) => id === mutation.id);
        if (!saved || saved.kind !== 'utxo' || !isCustomUtxoNetworkId(saved.id) ||
            active.networkId === saved.id || catalogueAccountGroup(record, saved.id))
          return invalid();
        networks = networks.filter(({ id }) => id !== saved.id);
      } else if (mutation.kind === 'remove-network') {
        if (mutation.id === active.networkId || catalogueEvmNetworks(next).length <= 1)
          return invalid();
        getNativeNetwork(mutation.id, catalogueEvmNetworks(next));
        networks = networks.filter((network) => network.id !== mutation.id);
      } else if (mutation.kind === 'select-network') {
        const utxo = findUtxoNetwork(mutation.id, catalogueUtxoNetworks(networks));
        if (!utxo) getNativeNetwork(mutation.id, catalogueEvmNetworks(next));
        let target = catalogueAccountGroup(next, mutation.id);
        if (mutation.initialGroup) {
          if (target || !utxo || mutation.initialGroup.key !== String(utxo.slip44) ||
              mutation.initialGroup.activeNetwork.chainId !== utxo.chainId)
            return invalid();
          target = mutation.initialGroup;
          groups.push(target);
        }
        if (!target) return invalid();
        let selection = target === group ? parseNativeAccountId(active.accountId) : { type: target.activeAccount.type, index: target.activeAccount.id };
        if (!utxo) {
          const network = { kind: 'ethereum' as INetworkType, chainId: Number(getNativeNetwork(mutation.id, catalogueEvmNetworks(next)).chainId), slip44: 60 };
          if (!isAccountCompatibleWithNetwork(target.accounts[selection.type][selection.index], selection.type, network)) {
            const compatible = getFirstCompatibleAccountForNetwork(target.accounts, network) ?? invalid();
            selection = { type: compatible.type, index: compatible.id };
          }
        }
        setActiveAccountRecord(target as { activeAccount: typeof target.activeAccount }, { type: selection.type as SharedAccountType, id: selection.index });
        const accountId = nativeAccountId(selection.type as 'HDAccount' | 'Imported' | 'SmartAccount', selection.index, target.activeNetwork.slip44);
        active = { accountId, networkId: mutation.id };
      } else {
        const selected = parseNativeAccountId(mutation.id),
          account = group.accounts[selected.type]?.[selected.index];
        if (!account || selected.slip44 !== group.activeNetwork.slip44) return changed();
        if (mutation.kind === 'select') {
          active = { ...active, accountId: mutation.id };
          setActiveAccountRecord(
            group as { activeAccount: typeof group.activeAccount },
            { id: selected.index, type: selected.type as SharedAccountType }
          );
        } else if (mutation.kind === 'store-guardian-recovery' || mutation.kind === 'retire-guardian-recovery' || mutation.kind === 'complete-guardian-recovery') {
          if (selected.type !== 'SmartAccount' || mutation.id !== active.accountId ||
              group.activeNetwork.kind !== 'ethereum' || !account.smartAccount ||
              account.smartAccount.chainId !== Number(getNativeNetwork(active.networkId, catalogueEvmNetworks(next)).chainId)) return invalid();
          const previous = guardianRecoveryIntents?.find(intent => intent.accountId === mutation.id);
          if (mutation.kind === 'store-guardian-recovery') {
            if ((previous?.operation.hash ?? null) !== mutation.expectedOperationHash) return changed();
            const intent = snapshotGuardianRecoveryIntent(mutation.intent, next);
            if (intent.accountId !== mutation.id) return invalid();
            if (previous) {
              if (encodeStorageValue(previous) !== encodeStorageValue(intent)) return changed();
            } else {
              guardianRecoveryIntents = [...(guardianRecoveryIntents ?? []), intent];
            }
          } else {
            if (!previous || previous.operation.hash !== mutation.operationHash) return changed();
            if (mutation.kind === 'complete-guardian-recovery') {
              const { metadata } = mutation;
              if (metadata.isDeployed !== true ||
                  Object.keys(metadata).some(key => !['auth', 'availableModules', 'isDeployed', 'installedModules'].includes(key)) ||
                  metadata.auth?.module !== previous.target.auth.module ||
                  metadata.auth?.validator?.toLowerCase() !== previous.target.auth.validator.toLowerCase() ||
                  metadata.auth?.data?.toLowerCase() !== previous.target.auth.data.toLowerCase()) return invalid();
              const smartAccount = { ...account.smartAccount, auth: metadata.auth, availableModules: metadata.availableModules,
                isDeployed: metadata.isDeployed, installedModules: metadata.installedModules };
              requireSmartAccountAddressIdentity({ ...account, smartAccount }, smartAccount.chainId);
              group.accounts.SmartAccount[selected.index] = { ...account, smartAccount };
            }
            guardianRecoveryIntents = guardianRecoveryIntents!.filter(intent => intent !== previous);
          }
        } else if (mutation.kind === 'mark-smart-deployed' || mutation.kind === 'refresh-smart-metadata') {
          if (selected.type !== 'SmartAccount' || mutation.id !== next.active.accountId ||
              group.activeNetwork.kind !== 'ethereum' || !account.smartAccount ||
              account.smartAccount.chainId !== Number(getNativeNetwork(next.active.networkId, catalogueEvmNetworks(next)).chainId)) return invalid();
          if (mutation.kind === 'refresh-smart-metadata' && (typeof mutation.metadata.isDeployed !== 'boolean' ||
              Object.keys(mutation.metadata).some(key => !['auth', 'availableModules', 'isDeployed', 'installedModules'].includes(key)))) return invalid();
          const metadata = mutation.kind === 'mark-smart-deployed'
            ? { ...account.smartAccount, isDeployed: true }
            : { ...account.smartAccount, auth: mutation.metadata.auth, availableModules: mutation.metadata.availableModules,
              isDeployed: mutation.metadata.isDeployed, installedModules: mutation.metadata.installedModules };
          requireSmartAccountAddressIdentity({ ...account, smartAccount: metadata }, account.smartAccount.chainId);
          group.accounts.SmartAccount[selected.index] = { ...account, smartAccount: metadata };
        } else if (mutation.kind === 'rename')
          setAccountRecordLabel(
            group.accounts,
            selected.type as SharedAccountType,
            selected.index,
            mutation.label
          );
        else if (mutation.kind === 'remove') {
          if (
            (selected.type === 'HDAccount' && selected.index === 0) ||
            active.accountId === mutation.id ||
            projection(record).accounts.length <= 1 ||
            guardianRecoveryIntents?.some(intent => intent.accountId === mutation.id ||
              intent.guardian.id === mutation.id || intent.replacement.id === mutation.id)
          )
            throw new WalletCatalogueError('CATALOGUE_NOT_REMOVABLE');
          removeAccountRecord(
            group.accounts,
            selected.type as SharedAccountType,
            selected.index
          );
          recovery = recovery.filter(
            (entry) =>
              !(
                entry.identity.slip44 === group.activeNetwork.slip44 &&
                entry.identity.id === selected.index &&
                selected.type === 'Imported'
              )
          );
        } else return invalid();
      }
      const validated = decode(
        { ...next, revision: next.revision + 1, active, networks, recovery, groups,
          ...(guardianRecoveryIntents === undefined ? {} : { guardianRecoveryIntents }) },
        this.root.walletFingerprint
      );
      guard();
      writing = true;
      const committed = mutation.kind === 'remove'
        ? await commitRemoval!(WALLET_CATALOGUE_KEY, this.stored, validated, guard)
        : await this.storage.compareAndSet(
            WALLET_CATALOGUE_KEY,
            this.stored,
            validated,
            undefined,
            guard
          );
      if (typeof committed !== 'boolean') return invalid();
      if (!committed) {
        writing = false;
        this.record = null;
        guard();
        return changed();
      }
      guard();
      const raw = await this.storage.get(WALLET_CATALOGUE_KEY);
      guard();
      if (encodeStorageValue(raw) !== encodeStorageValue(validated))
        return invalid();
      this.record = validated;
      this.stored = snapshot(raw);
      return projection(validated);
    } catch (error) {
      if (writing) this.uncertain = true;
      throw error;
    } finally {
      this.busy = false;
    }
  }
}
