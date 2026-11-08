import type { INetwork } from '../../../../source/types/network.ts';
import type { NativeConnectionRepository } from './storage.ts';

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
  context(): Readonly<{
    network: INetwork;
    networkId: string;
    networkLabel: string;
    activeAccountId: string | null;
    accounts: readonly NativeConnectionAccount[];
    unlocked: boolean;
  }>;
}>;
