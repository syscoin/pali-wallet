import {
  SENTRY_NETWORKS,
  type SentryNetwork,
} from '../../../../source/shared/sentryNetworks.ts';
import type { SentryLinkedNode } from '../../../../source/shared/sentryNodeLookup.ts';
import {
  inspectSentryCollateral,
  type SentryCollateralReservation,
} from '../../../../source/wallet/sentryCollateral.ts';
import {
  decodeBoundedStorageValue,
  encodeBoundedStorageValue,
} from './json.ts';
import { WalletStorageError, type SentryStorageScope } from './types.ts';

export const SENTRY_NODE_SLOTS = Object.freeze({
  mainnet: 'pali-native-sentry-nodes-v1:mainnet',
  testnet: 'pali-native-sentry-nodes-v1:testnet',
});
export const SENTRY_NODE_LIMITS = Object.freeze({
  valueBytes: 1024 * 1024,
  depth: 12,
  nodes: 32000,
});
export type SentryNodeStore = Readonly<{
  version: 1;
  network: SentryNetwork;
  genesisHash: string;
  profileId: string;
  walletBindingId: string;
  vaultId: string;
  collateral: readonly SentryCollateralReservation[];
  linkedNodes: readonly SentryLinkedNode[];
}>;
export interface SentryNodeStorage {
  read(): Promise<SentryNodeStore | undefined>;
  compareAndSet(
    expected: SentryNodeStore | undefined,
    next: SentryNodeStore,
    check: () => void
  ): Promise<void>;
}
export function sentryNodeSlotNetwork(key: string): SentryNetwork | undefined {
  return (Object.keys(SENTRY_NODE_SLOTS) as SentryNetwork[]).find(
    (network) => SENTRY_NODE_SLOTS[network] === key
  );
}
export function emptySentryNodeStore(
  scope: SentryStorageScope
): SentryNodeStore {
  return {
    version: 1,
    network: scope.network,
    genesisHash: SENTRY_NETWORKS[scope.network].genesisHash,
    profileId: scope.profileId,
    walletBindingId: scope.walletBindingId,
    vaultId: scope.vaultId,
    collateral: [],
    linkedNodes: [],
  };
}
const failure = () => new WalletStorageError('STORAGE_CORRUPT');
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const exact = (value: object, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
export function inspectSentryNodeStore(
  value: unknown,
  network: SentryNetwork,
  scope?: Pick<SentryStorageScope, 'profileId' | 'walletBindingId' | 'vaultId'>
): SentryNodeStore {
  const store = value as SentryNodeStore;
  if (
    !Object.hasOwn(SENTRY_NETWORKS, network) ||
    !store ||
    store.version !== 1 ||
    store.network !== network ||
    store.genesisHash !== SENTRY_NETWORKS[network].genesisHash ||
    !hash(store.vaultId) ||
    !hash(store.walletBindingId) ||
    typeof store.profileId !== 'string' ||
    !/^0x[0-9a-f]{64}$/.test(store.profileId) ||
    (scope &&
      (scope.vaultId !== store.vaultId ||
        scope.walletBindingId !== store.walletBindingId ||
        scope.profileId !== store.profileId)) ||
    !Array.isArray(store.collateral) ||
    !Array.isArray(store.linkedNodes) ||
    store.linkedNodes.length > 1000 ||
    !exact(store, [
      'collateral',
      'genesisHash',
      'linkedNodes',
      'network',
      'profileId',
      'vaultId',
      'version',
      'walletBindingId',
    ])
  )
    throw failure();
  let collateral: SentryCollateralReservation[];
  try {
    collateral = inspectSentryCollateral(store.collateral);
  } catch {
    throw failure();
  }
  const points = new Set<string>(),
    registrations = new Map<string, SentryCollateralReservation>();
  for (const entry of collateral) {
    const keys = [
      'txid',
      'vout',
      ...(entry.proTxHash === undefined ? [] : ['proTxHash']),
      ...(entry.pendingRegistration === undefined
        ? []
        : ['pendingRegistration']),
    ];
    const point = `${entry.txid}:${entry.vout}`;
    if (
      !exact(entry, keys) ||
      (entry.pendingRegistration !== undefined &&
        entry.pendingRegistration !== true) ||
      points.has(point) ||
      (entry.proTxHash && registrations.has(entry.proTxHash))
    )
      throw failure();
    points.add(point);
    if (entry.proTxHash) registrations.set(entry.proTxHash, entry);
  }
  const nodes = new Set<string>();
  for (const node of store.linkedNodes) {
    if (
      !node ||
      !hash(node.proTxHash) ||
      nodes.has(node.proTxHash) ||
      !node.collateralOutpoint ||
      !hash(node.collateralOutpoint.txid) ||
      !exact(node, [
        'proTxHash',
        'collateralOutpoint',
        'service',
        'nevmAddress',
      ]) ||
      !exact(node.collateralOutpoint, ['txid', 'vout']) ||
      !Number.isSafeInteger(node.collateralOutpoint.vout) ||
      node.collateralOutpoint.vout < 0 ||
      node.collateralOutpoint.vout > 0xffffffff ||
      typeof node.service !== 'string' ||
      !/^[\x21-\x7e]{0,128}$/.test(node.service) ||
      typeof node.nevmAddress !== 'string' ||
      (node.nevmAddress !== '' && !/^0x[0-9a-fA-F]{40}$/.test(node.nevmAddress))
    )
      throw failure();
    const reservation = registrations.get(node.proTxHash);
    if (
      reservation &&
      (reservation.txid !== node.collateralOutpoint.txid ||
        reservation.vout !== node.collateralOutpoint.vout)
    )
      throw failure();
    nodes.add(node.proTxHash);
  }
  return store;
}
export const encodeSentryNodeStore = (value: SentryNodeStore) =>
  encodeBoundedStorageValue(value, SENTRY_NODE_LIMITS);
export const readSentryNodeStore = (
  raw: string,
  network: SentryNetwork,
  scope?: Pick<SentryStorageScope, 'profileId' | 'walletBindingId' | 'vaultId'>
) =>
  inspectSentryNodeStore(
    decodeBoundedStorageValue(raw, SENTRY_NODE_LIMITS),
    network,
    scope
  );
