export type NetworkId =
  | 'syscoin'
  | 'bitcoin'
  | 'syscoin-nevm'
  | 'ethereum'
  | 'base'
  | 'arbitrum';

export type WalletNetwork = Readonly<{
  id: NetworkId;
  name: string;
  symbol: string;
  decimals: number;
  kind: 'evm' | 'utxo';
  chainId?: number;
  color: string;
  canWatch: boolean;
}>;

/** Intentionally excludes keys, phrases, xpubs and keyring state. */
export type PublicAccount = Readonly<{
  id: string;
  name: string;
  addresses: Readonly<Partial<Record<NetworkId, string>>>;
}>;

export type PublicBalance =
  | Readonly<{ status: 'unknown' }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'available'; units: string; updatedAt: number }>
  | Readonly<{ status: 'error'; message: string }>;

export type WalletCapabilities = Readonly<{
  watchOnly: true;
  receive: boolean;
  send: false;
  createWallet: false;
  importRecoveryPhrase: false;
  biometrics: false;
  walletConnect: false;
}>;

export type PublicSnapshot = Readonly<{
  status: 'empty' | 'locked' | 'ready';
  accounts: readonly PublicAccount[];
  selectedAccountId: string | null;
  selectedNetworkId: NetworkId;
  generation: number;
  balance: PublicBalance;
  capabilities: WalletCapabilities;
}>;

export type ReviewContext = Readonly<{
  accountId: string;
  address: string;
  networkId: NetworkId;
  chainId: number;
  endpoint: string;
  generation: number;
}>;

export type TransferIntent = Readonly<{
  recipient: string;
  amount: string;
}>;

/** This is a review model, never an authorization token or an unsigned tx. */
export type TransferReview = Readonly<{
  context: ReviewContext;
  recipient: string;
  amountUnits: string;
  maximumFeeUnits: string;
  totalUnits: string;
  expiresAt: number;
}>;

export type SubmissionStatus =
  | Readonly<{ status: 'not-submitted' }>
  | Readonly<{ status: 'submitted'; hash: string }>
  | Readonly<{ status: 'unknown'; hash?: string; message: string }>
  | Readonly<{ status: 'confirmed'; hash: string }>;

export interface WalletAuthority {
  getSnapshot(): PublicSnapshot;
  subscribe(listener: (snapshot: PublicSnapshot) => void): () => void;
  unlock(): void;
  lock(): void;
  selectAccount(id: string): void;
  selectNetwork(id: NetworkId): void;
  refresh(): Promise<void>;
  prepareTransfer(intent: TransferIntent): Promise<TransferReview>;
  confirmTransfer(review: TransferReview): Promise<SubmissionStatus>;
}
