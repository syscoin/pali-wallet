import type { INetwork } from '../../../../source/types/network.ts';
import type { NativeConnectionRepository } from './storage.ts';
import type { DappMessageRequest } from '../../../../source/shared/dappMessageRequest.ts';
import type { createDappMessageApproval } from '../../../../source/wallet/dappMessageApproval.ts';

export type NativeConnectionMessageSigning = Readonly<{
  accountId: string;
  networkId: string;
  request: DappMessageRequest;
  approval: ReturnType<typeof createDappMessageApproval>;
}>;

export type NativeConnectionAccount = Readonly<{
  id: string;
  index: number;
  type: 'HDAccount' | 'Imported';
  address: string;
  xpub: string;
  label: string;
}>;

/** Internal public-account projection. This capability never belongs in React state. */
export type NativeConnectionHost = Readonly<{
  repository: NativeConnectionRepository;
  walletBindingId: string;
  /** Stable wallet/runtime lifetime, deliberately independent of lock state. */
  assertOwner(): void;
  sessionGeneration(): number;
  signMessage(input: NativeConnectionMessageSigning): Promise<string>;
  context(): Readonly<{
    network: INetwork;
    networkId: string;
    networkLabel: string;
    activeAccountId: string | null;
    accounts: readonly NativeConnectionAccount[];
    unlocked: boolean;
  }>;
}>;
