import { EvmTransferReadRpc } from './evmTransferReadRpc.ts';
import { createNativeChainCatalogue, type NativeNetworkSuggestion } from './networkCatalogue.ts';
import { isCustomUtxoNetworkId, supportsUtxoSoftwareCustody } from '../core/utxoNetworks.ts';
import type { NativeUtxoNetworkDraft, NativeUtxoNetworkEditDraft , NativeNetworkSelectionProof, NativeNetworkSelectionReceipt } from './accounts.ts';
import type { NativeCustodyAuthority } from './authority.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import { getNativeSendContext } from './networkContext.ts';
import { snapshotNativeNetwork, nativeSigningEnabled, type EvmNetworkId } from './networkContext.ts';

/** Public network-selection and verified registration capability. No signing handle crosses it. */
export type NativeNetworkSnapshot<Id extends string = string> = Readonly<{
  revision: number;
  selectedId: Id;
  networks: readonly Readonly<{
    id: Id;
    name: string;
    symbol: string;
    testnet: boolean;
    canSign: boolean;
    registration?: import('./networkContext.ts').NativeNetworkRegistration;
    customUtxoEndpoint?: string;
  }>[];
}>;

export interface NativeNetworkView<Id extends string = string> {
  getSnapshot(): NativeNetworkSnapshot<Id> | null;
  getContextRevision(): number;
  subscribe(listener: () => void): () => void;
  select(id: Id, expectedContextRevision: number, expectedCatalogueRevision: number, onCommitted: (proof: NativeNetworkSelectionProof) => void): Promise<NativeNetworkSelectionReceipt>;
  save?(registration: import('./networkContext.ts').NativeNetworkRegistration, expectedContextRevision: number, expectedCatalogueRevision: number): Promise<void>;
  addUtxo?(draft: NativeUtxoNetworkDraft, expectedContextRevision: number, expectedCatalogueRevision: number): Promise<void>;
  editUtxo?(id: Id, draft: NativeUtxoNetworkEditDraft, expectedContextRevision: number, expectedCatalogueRevision: number): Promise<void>;
  removeUtxo?(id: Id, expectedContextRevision: number, expectedCatalogueRevision: number): Promise<void>;
  loadCatalogue?(retry?: boolean): Promise<readonly NativeNetworkSuggestion[]>;
  remove?(id: Id, expectedContextRevision: number, expectedCatalogueRevision: number): Promise<void>;
  cancel(): void;
}



/** Narrow projection: network selection still reserves the custody authority. */
export function createNativeNetworkView(authority: Pick<NativeCustodyAuthority,
  'getSnapshot' | 'getCatalogue' | 'subscribe' | 'selectNetwork' | 'cancelAccountOperation'> & Partial<Pick<NativeCustodyAuthority, 'manageNetwork' | 'addUtxoNetwork' | 'editUtxoNetwork' | 'removeUtxoNetwork'>>, options: { utxoSendAvailable: boolean; fetch: (url: string, init: RequestInit) => Promise<Response> }): NativeNetworkView<EvmNetworkId> {
  const { utxoSendAvailable, fetch } = options;
  if (typeof fetch !== 'function') throw new Error('A native network HTTP transport is required');
  let checking: AbortController | null = null;
  let cachedCatalogue: NativeWalletCatalogueSnapshot | null = null;
  let cached: NativeNetworkSnapshot<EvmNetworkId> | null = null;
  const loadCatalogue = authority.manageNetwork
    ? createNativeChainCatalogue(fetch)
    : undefined;
  async function checkUtxo(apply: (signal: AbortSignal) => Promise<void>) {
    checking?.abort();
    const controller = new AbortController();
    checking = controller;
    try { await apply(controller.signal); }
    finally { if (checking === controller) checking = null; controller.abort(); }
  }
  return Object.freeze({
    getSnapshot() {
      const catalogue = authority.getCatalogue();
      if (!catalogue) { cachedCatalogue = null; cached = null; return null; }
      if (catalogue !== cachedCatalogue) {
        cached = Object.freeze({
          revision: catalogue.revision,
          selectedId: catalogue.active.networkId,
          networks: Object.freeze([
            ...catalogue.networks.map((registration) => Object.freeze({
              id: registration.id,
              name: getNativeSendContext(registration).name,
              symbol: registration.symbol,
              testnet: registration.testnet,
              canSign: nativeSigningEnabled(registration.id, catalogue.networks), registration,
            })),
            ...catalogue.utxoNetworks.map((network) => Object.freeze({
              id: network.id, name: network.name, symbol: network.symbol,
              testnet: network.testnet, canSign: utxoSendAvailable && supportsUtxoSoftwareCustody(network),
              ...(isCustomUtxoNetworkId(network.id) ? { customUtxoEndpoint: network.endpoint } : {}),
            })),
          ]),
        });
        cachedCatalogue = catalogue;
      }
      return cached;
    },
    getContextRevision: () => authority.getSnapshot().revision,
    subscribe: (listener: () => void) => authority.subscribe(() => listener()),
    select: (id: EvmNetworkId, revision: number, catalogueRevision: number, onCommitted: (proof: NativeNetworkSelectionProof) => void) => {
      if (typeof onCommitted !== 'function') return Promise.reject(new Error('A network commit observer is required'));
      return authority.selectNetwork(id, revision, catalogueRevision, onCommitted);
    },
    ...(loadCatalogue ? { loadCatalogue } : {}),
    ...(authority.addUtxoNetwork && utxoSendAvailable ? {
      addUtxo: (draft: NativeUtxoNetworkDraft, revision: number, catalogueRevision: number) =>
        checkUtxo((signal) => authority.addUtxoNetwork!(draft, revision, catalogueRevision, signal)),
    } : {}),
    ...(authority.editUtxoNetwork && utxoSendAvailable ? {
      editUtxo: (id: EvmNetworkId, draft: NativeUtxoNetworkEditDraft, revision: number, catalogueRevision: number) =>
        checkUtxo((signal) => authority.editUtxoNetwork!(id, draft, revision, catalogueRevision, signal)),
    } : {}),
    ...(authority.removeUtxoNetwork && utxoSendAvailable ? {
      removeUtxo: (id: EvmNetworkId, revision: number, catalogueRevision: number) =>
        checkUtxo((signal) => authority.removeUtxoNetwork!(id, revision, catalogueRevision, signal)),
    } : {}),
    ...(authority.manageNetwork ? { save: async (registration: import('./networkContext.ts').NativeNetworkRegistration, revision: number, catalogueRevision: number) => {
      const selected = snapshotNativeNetwork(registration);
      checking?.abort(); const signal = new AbortController(); checking = signal;
      const guard = () => { if (signal.signal.aborted || authority.getSnapshot().revision !== revision || authority.getCatalogue()?.revision !== catalogueRevision) throw new Error('CANCELLED'); };
      try {
        await new EvmTransferReadRpc(selected, { fetch }).verifyNetwork(signal.signal, guard);
        guard();
        await authority.manageNetwork!({ kind: 'save-network', registration: selected }, revision, catalogueRevision);
      } finally { if (checking === signal) checking = null; signal.abort(); }
    },
    remove: (id: EvmNetworkId, revision: number, catalogueRevision: number) => authority.manageNetwork!({ kind: 'remove-network', id }, revision, catalogueRevision) } : {}),
    cancel: () => { checking?.abort(); checking = null; authority.cancelAccountOperation(); },
  });
}
