import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, Header, Notice, Screen } from '../ui';
import type { QrScannerProps } from './QrScanner.types';
export function QrScanner<T>({ copy, onClose }: QrScannerProps<T>) {
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title={copy.title} onBack={onClose} />
    <Notice title="Use Pali on your phone" body={copy.webUnavailable} />
    <Button title={copy.manualAction} onPress={onClose} />
  </Screen></SafeAreaView>;
}
