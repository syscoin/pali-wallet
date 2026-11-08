import React, { useEffect, useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createEvmWatchAccount, WatchOnlyAuthority } from '../../src/core/watchOnlyAuthority';
import { WatchAccountPortfolio } from '../../src/screens/WatchAccountPortfolio';

const address = '0x52908400098527886E0F7030069857D2E4169EE7';
declare global {
  interface Window {
    __watchReceiveFixture: { lock(): void; status(): string };
  }
}

/** Keep the real Receive component mounted while its real authority locks. */
export function WatchReceiveFixture() {
  const authority = useMemo(() => {
    const value = new WatchOnlyAuthority(
      [createEvmWatchAccount('receive-fixture', 'Public fixture', address)],
      { readBalance: async () => ({ chainId: 1, units: '0' }) }
    );
    value.unlock();
    return value;
  }, []);
  useEffect(() => {
    window.__watchReceiveFixture = {
      lock: () => authority.lock(),
      status: () => authority.getSnapshot().status,
    };
    return () => authority.lock();
  }, [authority]);
  return <SafeAreaProvider><WatchAccountPortfolio authority={authority} onAccounts={() => undefined} onExit={() => undefined} onLock={() => authority.lock()} /></SafeAreaProvider>;
}
