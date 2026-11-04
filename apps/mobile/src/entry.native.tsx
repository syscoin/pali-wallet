import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { ensureNativeCryptoReady } from './platform/cryptoBootstrap';
import { loadAfterNativeCrypto } from './startup/loadAfterCrypto';

/** Register immediately, but evaluate no wallet/ethers graph before crypto. */
function NativeEntry() {
  const [Application, setApplication] = useState<React.ComponentType | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void loadAfterNativeCrypto(ensureNativeCryptoReady, () => {
      // A static App import would let noble snapshot an absent/old RNG before
      // native qualification. Metro keeps this require behind the awaited gate.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require('../App') as typeof import('../App')).default;
    }).then((component) => {
      if (current) setApplication(() => component);
    }).catch(() => {
      if (current) setFailed(true);
    });
    return () => { current = false; };
  }, []);
  if (Application) return <Application />;
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#07121f', padding: 28 }}>
    {!failed && <ActivityIndicator color="#70c6ff" />}
    <Text accessibilityLiveRegion="polite" style={{ color: 'white', marginTop: 20, textAlign: 'center' }}>
      {failed ? 'Pali could not start. Please reopen the app.' : 'Preparing your secure wallet…'}
    </Text>
  </View>;
}

registerRootComponent(NativeEntry);
