import { EvmTransferReadRpc } from './evmTransferReadRpc.ts';
import type { NativeCustodyAuthority } from './authority.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import { getNativeSendContext } from './networkContext.ts';
import { snapshotNativeNetwork, nativeSigningEnabled, type EvmNetworkId } from './networkContext.ts';

/** Public network-selection capability. No SDK, endpoint or signing handle crosses it. */
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
  }>[];
}>;

export interface NativeNetworkView<Id extends string = string> {
  getSnapshot(): NativeNetworkSnapshot<Id> | null;
  getContextRevision(): number;
  subscribe(listener: () => void): () => void;
  select(id: Id, expectedContextRevision: number, expectedCatalogueRevision: number): Promise<void>;
  save?(registration: import('./networkContext.ts').NativeNetworkRegistration, expectedContextRevision: number, expectedCatalogueRevision: number): Promise<void>;
  remove?(id: Id, expectedContextRevision: number, expectedCatalogueRevision: number): Promise<void>;
  cancel(): void;
}



/** Narrow projection: network selection still reserves the custody authority. */
export function createNativeNetworkView(authority: Pick<NativeCustodyAuthority,
  'getSnapshot' | 'getCatalogue' | 'subscribe' | 'selectNetwork' | 'cancelAccountOperation'> & Partial<Pick<NativeCustodyAuthority, 'manageNetwork'>>, options: { fetch?: (url: string, init: RequestInit) => Promise<Response> } = {}): NativeNetworkView<EvmNetworkId> {
  let checking: AbortController | null = null;
  let cachedCatalogue: NativeWalletCatalogueSnapshot | null = null;
  let cached: NativeNetworkSnapshot<EvmNetworkId> | null = null;
  return Object.freeze({
    getSnapshot() {
      const catalogue = authority.getCatalogue();
      if (!catalogue) { cachedCatalogue = null; cached = null; return null; }
      if (catalogue !== cachedCatalogue) {
        cached = Object.freeze({
          revision: catalogue.revision,
          selectedId: catalogue.active.networkId,
          networks: Object.freeze(catalogue.networks.map((registration) => Object.freeze({
            id: registration.id,
            name: getNativeSendContext(registration).name,
            symbol: registration.symbol,
            testnet: registration.testnet,
            canSign: nativeSigningEnabled(registration.id), registration,
          }))),
        });
        cachedCatalogue = catalogue;
      }
      return cached;
    },
    getContextRevision: () => authority.getSnapshot().revision,
    subscribe: (listener: () => void) => authority.subscribe(() => listener()),
    select: (id: EvmNetworkId, revision: number, catalogueRevision: number) => authority.selectNetwork(id, revision, catalogueRevision),
    ...(authority.manageNetwork ? { save: async (registration: import('./networkContext.ts').NativeNetworkRegistration, revision: number, catalogueRevision: number) => {
      const selected = snapshotNativeNetwork(registration);
      checking?.abort(); const signal = new AbortController(); checking = signal;
      const guard = () => { if (signal.signal.aborted || authority.getSnapshot().revision !== revision || authority.getCatalogue()?.revision !== catalogueRevision) throw new Error('CANCELLED'); };
      try {
        await new EvmTransferReadRpc(selected, options).verifyNetwork(signal.signal, guard);
        guard();
        await authority.manageNetwork!({ kind: 'save-network', registration: selected }, revision, catalogueRevision);
      } finally { if (checking === signal) checking = null; signal.abort(); }
    },
    remove: (id: EvmNetworkId, revision: number, catalogueRevision: number) => authority.manageNetwork!({ kind: 'remove-network', id }, revision, catalogueRevision) } : {}),
    cancel: () => { checking?.abort(); checking = null; authority.cancelAccountOperation(); },
  });
}
