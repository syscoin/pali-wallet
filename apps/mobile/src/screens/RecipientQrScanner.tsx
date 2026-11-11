import React from 'react';
import { parseEvmRecipientQr } from '../core/recipientQr';
import { QrScanner } from './QrScanner';
export function RecipientQrScanner({ onScan, onClose }: { onScan(address: string): void; onClose(): void }) {
  return <QrScanner parse={parseEvmRecipientQr} onScan={onScan} onClose={onClose} copy={{
    title: 'Scan recipient address',
    instructions: 'Scan the recipient’s EVM address. Check the address and network before sending.',
    unavailable: 'Paste or enter the recipient address instead.',
    permission: 'Allow camera access in Settings to scan recipient addresses.',
    invalidTitle: 'Recipient address needed', invalidBody: 'This QR code does not contain a valid EVM address.',
    manualAction: 'Enter address manually',
    webUnavailable: 'The native app can scan recipient addresses. Enter the address in this browser preview.',
  }} />;
}
