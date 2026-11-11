import './notifications/backgroundTask';
import './updates/backgroundTask';
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
    let stopNotifications: (() => void) | undefined;
    let stopUpdates: (() => void) | undefined;
    void loadAfterNativeCrypto(ensureNativeCryptoReady, () => {
      // Locale resources and protected preferences stay behind the same gate.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      void (require('./platform/localization') as typeof import('./platform/localization')).initializeNativeLanguage();
      // A static App import would let noble snapshot an absent/old RNG before
      // native qualification. Metro keeps this require behind the awaited gate.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require('../App') as typeof import('../App')).default;
    }).then((component) => {
      if (current) {
        // Public activity monitoring never opens the spending vault.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        stopNotifications = (require('./notifications/service.native') as typeof import('./notifications/service.native')).startNativeNotificationLifecycle();
        // Public release notices do not depend on wallet/account state.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        stopUpdates = (require('./updates/service.native') as typeof import('./updates/service.native')).startMobileUpdateLifecycle();
        setApplication(() => component);
      }
    }).catch(() => {
      if (current) setFailed(true);
    });
    return () => { current = false; stopNotifications?.(); stopUpdates?.(); };
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
