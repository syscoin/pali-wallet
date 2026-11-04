import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';

/** UI requests contain no SDK records, private keys or arbitrary method names. */
export type NativeAccountRequest =
  | Readonly<{ kind: 'create'; label: string; password: string }>
  | Readonly<{ kind: 'restore'; index: number; label: string; password: string }>
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

/** Durable network selection consumed by the native network picker. */
export interface NativeNetworkRuntime {
  reserve(id: string, expectedCatalogueRevision: number): {
    execute(assertCurrent: () => void): Promise<void>;
    cancel(): void;
  };
  getSelectedId(): import('./networkContext.ts').EvmNetworkId | null;
}
