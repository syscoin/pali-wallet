import { INetworkType, KeyringAccountType } from '../types/network';

import {
  createDappSigningApproval,
  type DappSigningScope,
} from './dappSigningApproval';

function fixture() {
  const grant = {
    accountId: 0,
    accountType: KeyringAccountType.HDAccount,
    chain: INetworkType.Ethereum,
    chainId: 1,
    date: 1,
    host: 'https://dapp.invalid',
  };
  let scope: DappSigningScope = {
    grant,
    account: { id: 0, type: 'HDAccount', address: '0x01', xpub: 'public' },
    network: {
      kind: 'ethereum',
      chainId: 1,
      url: 'https://rpc.invalid',
      slip44: 60,
    },
    isBitcoinBased: false,
    sessionGeneration: 1,
  };
  const listeners = new Set<() => void>();
  const approval = createDappSigningApproval({
    readScope: () => scope,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  return {
    approval,
    listeners,
    get scope() {
      return scope;
    },
    change(next: DappSigningScope) {
      scope = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('shared message signing authority', () => {
  it.each(['grant', 'account', 'network', 'session'] as const)(
    'does not regain authority after a transient %s change',
    (change) => {
      const f = fixture();
      const original = f.scope;
      f.change(
        change === 'grant'
          ? { ...original, grant: undefined }
          : change === 'account'
          ? { ...original, account: { ...original.account, id: 1 } }
          : change === 'network'
          ? {
              ...original,
              network: { ...original.network, url: 'https://other.invalid' },
            }
          : { ...original, sessionGeneration: 2 }
      );
      f.change(original);
      expect(() => f.approval.assertCurrent()).toThrow('no longer current');
    }
  );

  it('removes its state subscription and retires on disposal', () => {
    const f = fixture();
    expect(f.listeners.size).toBe(1);
    f.approval.dispose();
    expect(f.listeners.size).toBe(0);
    expect(f.approval.isCurrent()).toBe(false);
  });

  it('retains smart signer checks through later shared scope observations', () => {
    const f = fixture();
    let ownerCurrent = true;
    f.approval.bindSigner('owner', () => ownerCurrent);
    ownerCurrent = false;
    f.change(f.scope);
    ownerCurrent = true;
    expect(() => f.approval.assertCurrent()).toThrow('no longer current');
    f.approval.dispose();
  });
});
