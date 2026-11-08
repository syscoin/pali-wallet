import type { NativePreparedConnectionTransaction } from './transactionRuntime.ts';
import type { INetwork } from '../../../../source/types/network.ts';
import type { NativeConnectionRepository } from './storage.ts';
import type { DappMessageRequest } from '../../../../source/shared/dappMessageRequest.ts';
import type { createDappSigningApproval } from '../../../../source/wallet/dappSigningApproval.ts';

export type NativeConnectionMessageSigning = Readonly<{
  accountId: string;
  networkId: string;
  request: DappMessageRequest;
  approval: ReturnType<typeof createDappSigningApproval>;
}>;

export type NativeConnectionTransactionSigning = Readonly<{
  accountId: string;
  networkId: string;
  transaction: unknown;
  approval: ReturnType<typeof createDappSigningApproval>;
}>;

export type NativeConnectionAccount = Readonly<{
  id: string;
  index: number;
  type: 'HDAccount' | 'Imported';
  address: string;
  xpub: string;
  label: string;
}>;

/** Internal connection capabilities. This host never belongs in React state. */
export type NativeConnectionHost = Readonly<{
  repository: NativeConnectionRepository;
  walletBindingId: string;
  /** Stable wallet/runtime lifetime, deliberately independent of lock state. */
  assertOwner(): void;
  sessionGeneration(): number;
  signMessage(input: NativeConnectionMessageSigning): Promise<string>;
  prepareTransaction(input: NativeConnectionTransactionSigning, assertCurrent: () => void): Promise<NativePreparedConnectionTransaction>;
  context(): Readonly<{
    network: INetwork;
    networkId: string;
    networkLabel: string;
    activeAccountId: string | null;
    accounts: readonly NativeConnectionAccount[];
    unlocked: boolean;
  }>;
}>;
