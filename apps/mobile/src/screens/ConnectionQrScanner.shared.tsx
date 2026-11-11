import React from 'react';
import { extractPairingUri } from '../connections/pairingLinks';
import { QrScanner } from './QrScanner';
import type { ConnectionQrScannerProps } from './ConnectionQrScanner.types';
export function ConnectionQrScanner(props: ConnectionQrScannerProps) {
  return <QrScanner {...props} parse={extractPairingUri} copy={{
    title: 'Scan connection code',
    instructions: 'Scan the WalletConnect QR code shown by the app you want to connect to.',
    unavailable: 'Use a copied WalletConnect link to connect instead.',
    permission: 'Allow camera access in Settings to scan connection codes.',
    invalidTitle: 'Connection code needed', invalidBody: 'This code is not a WalletConnect link.',
    manualAction: 'Use pasted link',
    webUnavailable: 'The native app can scan WalletConnect QR codes. Use a pasted link in this browser preview.',
  }} />;
}
