import React from 'react';
import { Button, Header, Notice, Screen } from '../ui';

export function NativeWalletScreen({ onExit }: { onExit: () => void }) {
  return <Screen><Header title="Native wallet" />
    <Notice title="Open the native app" body="Wallet setup is available in the iOS and Android development builds." />
    <Button title="Back" onPress={onExit} />
  </Screen>;
}
