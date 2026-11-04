import type { NativeCustodyAuthority } from './authority.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import { getNetwork } from '../core/networks.ts';
import { nativeSigningEnabled, type EvmNetworkId } from './networkContext.ts';

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
  }>[];
}>;

export interface NativeNetworkView<Id extends string = string> {
  getSnapshot(): NativeNetworkSnapshot<Id> | null;
  getContextRevision(): number;
  subscribe(listener: () => void): () => void;
  select(id: Id, expectedContextRevision: number, expectedCatalogueRevision: number): Promise<void>;
  cancel(): void;
}



/** Narrow projection: network selection still reserves the custody authority. */
export function createNativeNetworkView(authority: Pick<NativeCustodyAuthority,
  'getSnapshot' | 'getCatalogue' | 'subscribe' | 'selectNetwork' | 'cancelAccountOperation'>): NativeNetworkView<EvmNetworkId> {
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
            name: getNetwork(registration.id).name,
            symbol: registration.symbol,
            testnet: registration.testnet,
            canSign: nativeSigningEnabled(registration.id),
          }))),
        });
        cachedCatalogue = catalogue;
      }
      return cached;
    },
    getContextRevision: () => authority.getSnapshot().revision,
    subscribe: (listener: () => void) => authority.subscribe(() => listener()),
    select: (id: EvmNetworkId, revision: number, catalogueRevision: number) => authority.selectNetwork(id, revision, catalogueRevision),
    cancel: () => authority.cancelAccountOperation(),
  });
}
