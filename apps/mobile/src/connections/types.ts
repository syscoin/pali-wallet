export type NativeConnectionError =
  | 'INVALID_LINK'
  | 'REQUEST_EXPIRED'
  | 'CONTEXT_CHANGED'
  | 'UNSUPPORTED_REQUEST'
  | 'CONNECTION_UNAVAILABLE'
  | 'BUSY';

export type NativeConnectionsSnapshot = Readonly<{
  revision: number;
  status: 'locked' | 'ready' | 'pairing' | 'approving' | 'unavailable';
  selectedAccountId: string | null;
  accounts: readonly Readonly<{ id: string; label: string; address: string }>[];
  network: Readonly<{ id: string; label: string; chainId: string }> | null;
  proposals: readonly Readonly<{
    id: number;
    name: string;
    origin: string;
    requiredMethods: readonly string[];
    canApprove: boolean;
  }>[];
  sessions: readonly Readonly<{
    id: string;
    name: string;
    origin: string;
    accountLabel: string;
    networkLabel: string;
  }>[];
  error: NativeConnectionError | null;
}>;

/** Public view commands carry identifiers only, never transport or keyring handles. */
export type NativeConnectionsView = Readonly<{
  getSnapshot(): NativeConnectionsSnapshot;
  subscribe(listener: () => void): () => void;
  pair(uri: string): Promise<void>;
  approve(
    proposalId: number,
    accountId: string,
    networkId: string,
    revision: number
  ): Promise<void>;
  reject(proposalId: number): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  retry(): Promise<void>;
  cancel(): void;
}>;
