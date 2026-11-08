import { createDappApprovalLifetime } from '../utils/dappApprovalLifetime.ts';

import type { DappGrant } from '../shared/dappTypes.ts';

export type DappSigningScope = Readonly<{
  account: Readonly<{
    address?: string;
    id: number;
    type: string;
    xpub?: string;
  }>;
  grant: DappGrant | undefined;
  isBitcoinBased: boolean;
  network: Readonly<{
    chainId: number;
    kind: string;
    slip44?: number;
    url?: string;
  }>;
  sessionGeneration: number;
}>;

export const dappSigningApprovalExpired = () =>
  Object.assign(
    new Error('This site approval is no longer current. Request it again.'),
    { code: 4001 }
  );

/** One irreversible account, network and session approval for dapp signing. */
export function createDappSigningApproval({
  readScope,
  subscribe,
  signal,
}: {
  readScope: () => DappSigningScope;
  signal?: AbortSignal;
  subscribe: (changed: () => void) => () => void;
}) {
  const original = readScope();
  const captured = {
    ...original,
    account: { ...original.account },
    network: { ...original.network },
  };
  const signers = new Map<string, () => boolean>();
  const lifetime = createDappApprovalLifetime(() => {
    const current = readScope();
    return (
      captured.grant !== undefined &&
      captured.grant.chain === 'ethereum' &&
      captured.grant.accountId === captured.account.id &&
      captured.grant.accountType === captured.account.type &&
      captured.account.address !== undefined &&
      current.grant === captured.grant &&
      current.account.id === captured.account.id &&
      current.account.type === captured.account.type &&
      current.account.address === captured.account.address &&
      current.account.xpub === captured.account.xpub &&
      !current.isBitcoinBased &&
      current.network.kind === 'ethereum' &&
      current.network.chainId === captured.network.chainId &&
      current.network.url === captured.network.url &&
      current.network.slip44 === captured.network.slip44 &&
      current.sessionGeneration === captured.sessionGeneration &&
      [...signers.values()].every((isCurrent) => isCurrent() === true)
    );
  }, signal);
  const assertCurrent = () => {
    if (!lifetime.isCurrent()) throw dappSigningApprovalExpired();
  };
  assertCurrent();
  const unsubscribe = subscribe(lifetime.isCurrent);
  return {
    assertCurrent,
    isCurrent: lifetime.isCurrent,
    retire: lifetime.retire,
    signal: lifetime.signal,
    bindSigner(key: string, isCurrent: () => boolean) {
      assertCurrent();
      signers.set(key, isCurrent);
      assertCurrent();
    },
    dispose() {
      unsubscribe();
      lifetime.dispose();
    },
  };
}
