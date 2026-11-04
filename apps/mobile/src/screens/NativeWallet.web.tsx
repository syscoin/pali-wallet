import React from 'react';
import { Button, Header, Notice, Screen } from '../ui';

import type { NativeWalletProps } from './NativeWallet.native';

export function NativeWalletScreen({ onExit }: NativeWalletProps) {
  return <Screen><Header title="Native wallet" />
    <Notice title="Open the native app" body="Wallet setup is available in the iOS and Android development builds." />
    <Button title="Back" onPress={onExit} />
  </Screen>;
}
