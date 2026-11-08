import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, Header, Notice, Screen } from '../ui';
import type { ConnectionQrScannerProps } from './ConnectionQrScanner.types';

export function ConnectionQrScanner({ onClose }: ConnectionQrScannerProps) {
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title="Scan connection code" onBack={onClose} />
    <Notice title="Use Pali on your phone" body="The native app can scan WalletConnect QR codes. Use a pasted link in this browser preview." />
    <Button title="Use pasted link" onPress={onClose} />
  </Screen></SafeAreaView>;
}
