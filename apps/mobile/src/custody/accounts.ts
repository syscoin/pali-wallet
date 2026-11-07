import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';

/** UI requests contain no SDK records, private keys or arbitrary method names. */
export type NativeAccountRequest =
  | Readonly<{ kind: 'create'; label: string; password: string }>
  | Readonly<{ kind: 'select'; id: string }>
  | Readonly<{ kind: 'rename'; id: string; label: string }>
  | Readonly<{ kind: 'remove'; id: string; password: string }>;

export interface NativeAccountRuntime {
  /** Synchronous admission excludes SDK authentication/signing before UI revocation. */
  reserve(request: NativeAccountRequest, expectedCatalogueRevision: number): {
    execute(assertCurrent: () => void): Promise<void>;
    cancel(): void;
  };
  supported(): boolean;
  getSnapshot(): NativeWalletCatalogueSnapshot | null;
}

export interface NativeAccountView {
  getSnapshot(): NativeWalletCatalogueSnapshot | null;
  getContextRevision(): number;
  subscribe(listener: () => void): () => void;
  execute(request: NativeAccountRequest, contextRevision: number, catalogueRevision: number): Promise<void>;
  cancel(): void;
}

export type NativeUtxoNetworkDraft = Readonly<{ endpoint: string; name: string; explorer: string }>;
export type NativeUtxoNetworkEditDraft = Readonly<Pick<NativeUtxoNetworkDraft, 'endpoint' | 'name'>>;
export type NativeUtxoNetworkChange =
  | Readonly<{ kind: 'edit-utxo-network'; id: string; draft: NativeUtxoNetworkEditDraft }>
  | Readonly<{ kind: 'remove-utxo-network'; id: string }>;
export type NativeUtxoNetworkApproval =
  | Readonly<{ kind: 'add-utxo-network' }>
  | Readonly<{ kind: 'edit-utxo-network' }>
  | Readonly<{ kind: 'remove-utxo-network' }>;

export type NativeNetworkRequest =
  | Readonly<{ kind: 'select-network'; id: string }>
  | Readonly<{ kind: 'save-network'; registration: import('./networkContext.ts').NativeNetworkRegistration;
    }>
  | NativeUtxoNetworkApproval
  | Readonly<{ kind: 'remove-network'; id: string }>;

/** Durable network selection consumed by the native network picker. */
export interface NativeNetworkRuntime {
  prepareUtxo?(draft: NativeUtxoNetworkDraft, expectedCatalogueRevision: number, signal: AbortSignal,
    assertCurrent: () => void): Promise<NativeUtxoNetworkApproval>;
  withUtxoChangeApproval?(request: NativeUtxoNetworkChange, expectedCatalogueRevision: number,
    signal: AbortSignal, assertCurrent: () => void, commit: (proof: NativeUtxoNetworkApproval) => Promise<void>): Promise<void>;
  reserve(id: string | NativeNetworkRequest, expectedCatalogueRevision: number): {
    execute(assertCurrent: () => void): Promise<void>;
    cancel(): void;
  };
  getSelectedId(): import('./networkContext.ts').EvmNetworkId | null;
}
