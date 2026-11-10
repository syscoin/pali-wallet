import { id } from 'ethers/hash';
import { parseNativeAccountId } from './accountIdentity.ts';
import type { NativeCustodyAuthority } from './authority.ts';
import { isUtxoAccountPrivateKey, isUtxoWifText } from './importedAccounts.ts';
import { getNativeNetwork } from './networkContext.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import { CustodyRuntimeError } from './types.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import { normalizeUtxoAddress } from '../core/utxoAddresses.ts';
import { findUtxoNetwork, getUtxoSdkNetwork, type UtxoNetwork } from '../core/utxoNetworks.ts';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';

/** Selected key expectation, never caller-granted SDK authority. */
export type HdKeyExportScope = Readonly<{
  authorityRevision: number;
  catalogueRevision: number;
  accountId: string;
  index: number;
  address: string;
  networkId: string;
  registrationHash: string;
}>;

export interface NativeHdKeyExportRuntime {
  readSelected(scope: HdKeyExportScope, password: string, assertCurrent: () => void): Promise<string>;
}

export type HdKeyExportPresentation = Readonly<{
  id: string;
  accountId: string;
  address: string;
  privateKey: string;
}>;

export function keyExportRegistrationHash(networkId: string, catalogue: Pick<NativeWalletCatalogueSnapshot, 'networks' | 'utxoNetworks'>): string {
  const utxo = findUtxoNetwork(networkId, catalogue.utxoNetworks);
  if (!utxo) return getNativeNetwork(networkId, catalogue.networks).registrationHash;
  const sdk = getUtxoSdkNetwork(utxo);
  return id(JSON.stringify([utxo.id, sdk.kind, sdk.chainId, sdk.slip44, sdk.currency, sdk.utxoBackendChain, sdk.url, utxo.genesisHash]));
}

/** Reject accessors, extra fields and coercion before using a caller's expectation. */
export function snapshotHdKeyExportScope(input: HdKeyExportScope, utxos: readonly UtxoNetwork[]): HdKeyExportScope {
  try {
    const value = decodeStorageValue(encodeStorageValue(input)) as HdKeyExportScope;
    const fields = ['authorityRevision', 'catalogueRevision', 'accountId', 'index', 'address', 'networkId', 'registrationHash'];
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== fields.length || Object.keys(value).some((key) => !fields.includes(key)) ||
        !Number.isSafeInteger(value.authorityRevision) || value.authorityRevision < 0 ||
        !Number.isSafeInteger(value.catalogueRevision) || value.catalogueRevision < 0 ||
        !Number.isSafeInteger(value.index) || value.index < 0 ||
        typeof value.address !== 'string' || typeof value.networkId !== 'string' || typeof value.registrationHash !== 'string' ||
        !/^0x[0-9a-f]{64}$/.test(value.registrationHash))
      throw new Error('INVALID_INPUT');
    const selected = parseNativeAccountId(value.accountId);
    const utxo = findUtxoNetwork(value.networkId, utxos);
    if ((selected.type !== 'HDAccount' && selected.type !== 'Imported') || selected.index !== value.index || selected.slip44 !== (utxo?.slip44 ?? 60) ||
        (utxo ? normalizeUtxoAddress(value.address, utxo) !== value.address
          : normalizePublicAddress(value.address, 'ethereum') !== value.address)) throw new Error('INVALID_INPUT');
    return Object.freeze(value);
  } catch { throw new CustodyRuntimeError('INVALID_INPUT'); }
}

function capture(authority: NativeCustodyAuthority): HdKeyExportScope {
  const state = authority.getSnapshot();
  const catalogue = authority.getCatalogue();
  const selected = catalogue?.accounts.find((account) => account.id === catalogue.active.accountId);
  const utxo = catalogue && findUtxoNetwork(catalogue.active.networkId, catalogue.utxoNetworks);
  if ((selected?.type !== 'HDAccount' && selected?.type !== 'Imported') || state.phase !== 'ready' || state.backup !== 'confirmed' || !state.account || !catalogue || !selected ||
      selected.type !== parseNativeAccountId(selected.id).type || selected.slip44 !== (utxo?.slip44 ?? 60) ||
      state.account.address !== selected.address ||
      state.account.network !== catalogue.active.networkId) throw new Error('NOT_READY');
  return snapshotHdKeyExportScope({ authorityRevision: state.revision, catalogueRevision: catalogue.revision,
    accountId: selected.id, index: selected.index, address: selected.address,
    networkId: catalogue.active.networkId, registrationHash: keyExportRegistrationHash(catalogue.active.networkId, catalogue) }, catalogue.utxoNetworks);
}

/** Owns short-lived presentations only; no secret-bearing observable snapshot. */
export class HdKeyExportFlow {
  private presentation: HdKeyExportPresentation | null = null;
  private scope: HdKeyExportScope | null = null;
  private operation = 0;
  private busy = false;
  private disposed = false;
  private cancelling = false;
  private readonly authority: NativeCustodyAuthority;
  private readonly runtime: () => NativeHdKeyExportRuntime | undefined;
  private readonly unsubscribe: () => void;
  private readonly clearListeners = new Set<() => void>();

  constructor(authority: NativeCustodyAuthority, runtime: () => NativeHdKeyExportRuntime | undefined) {
    this.authority = authority;
    this.runtime = runtime;
    this.unsubscribe = authority.subscribe(() => {
      if (this.scope && !this.contextCurrent(this.scope)) this.cancel();
    });
  }

  private contextCurrent(scope: HdKeyExportScope): boolean {
    try {
      const now = capture(this.authority);
      return !this.disposed && Object.keys(scope).every((key) =>
        now[key as keyof HdKeyExportScope] === scope[key as keyof HdKeyExportScope]);
    } catch { return false; }
  }

  onClear(listener: () => void): () => void {
    this.clearListeners.add(listener);
    return () => this.clearListeners.delete(listener);
  }

  isCurrent(id: string): boolean {
    return !!this.presentation && this.presentation.id === id && !!this.scope && this.contextCurrent(this.scope);
  }

  cancel(): void {
    if (this.cancelling) return;
    this.cancelling = true;
    this.operation++;
    this.presentation = null;
    this.scope = null;
    for (const listener of [...this.clearListeners]) {
      try { listener(); } catch { /* Observers cannot retain authority. */ }
    }
    this.cancelling = false;
  }

  async begin(password: string): Promise<HdKeyExportPresentation> {
    if (this.disposed) throw new Error('KEY_EXPORT_EXPIRED');
    if (this.busy || this.cancelling) throw new Error('BUSY');
    // Reserve before injected callbacks or clear observers can reenter.
    this.busy = true;
    let scope: HdKeyExportScope | undefined;
    let runtime: NativeHdKeyExportRuntime | undefined;
    try {
      scope = capture(this.authority);
      runtime = this.runtime();
      if (!runtime) throw new Error('NOT_READY');
      const expected = scope, owner = runtime;
      this.cancel();
      this.scope = expected;
      const operation = this.operation;
      const current = () => {
        if (operation !== this.operation || !this.contextCurrent(expected) || this.runtime() !== owner)
          throw new Error('CANCELLED');
      };
      current();
      const privateKey = await owner.readSelected(expected, password, current);
      current();
      const catalogue = this.authority.getCatalogue();
      const utxo = findUtxoNetwork(expected.networkId, catalogue?.utxoNetworks);
      const accountType = parseNativeAccountId(expected.accountId).type;
      const selected = catalogue?.accounts.find(({ id }) => id === expected.accountId);
      const extended = accountType === 'HDAccount' || selected?.utxoExtended === true;
      const keyMatchesFormat = utxo
        ? extended ? isUtxoAccountPrivateKey(privateKey, utxo.testnet) : isUtxoWifText(privateKey)
        : typeof privateKey === 'string' && /^0x[0-9a-f]{64}$/.test(privateKey);
      if (!keyMatchesFormat) throw new Error('UNAVAILABLE');
      const id = globalThis.crypto.randomUUID();
      current();
      const presentation = Object.freeze({ id, accountId: expected.accountId, address: expected.address, privateKey });
      this.presentation = presentation;
      return presentation;
    } catch (error) {
      this.cancel();
      const refusal = error instanceof CustodyRuntimeError &&
        (error.code === 'INVALID_CREDENTIAL' || error.code === 'AUTH_THROTTLED' || error.code === 'DEVICE_UNLOCK_UNAVAILABLE');
      // A failing current runtime may have already cleared its catalogue. Use
      // its captured public authority identity to reflect that lock, but never
      // revoke a replacement context when obsolete work eventually settles.
      const now = this.authority.getSnapshot();
      let sameRuntime = false;
      try { sameRuntime = !!runtime && this.runtime() === runtime; } catch { /* No authority over an unavailable replacement. */ }
      if (!refusal && !this.disposed && scope && sameRuntime &&
          now.revision === scope.authorityRevision && now.phase === 'ready' &&
          now.account?.address === scope.address && now.account.network === scope.networkId)
        this.authority.lock();
      if (error instanceof Error && error.message === 'CANCELLED') throw new Error('CANCELLED');
      if (refusal)
        throw new Error(error.code);
      throw new Error('KEY_EXPORT_UNAVAILABLE');
    } finally { this.busy = false; }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
    this.clearListeners.clear();
  }
}
