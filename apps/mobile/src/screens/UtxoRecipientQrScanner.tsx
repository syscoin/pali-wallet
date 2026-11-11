import React, { useCallback } from 'react';
import { normalizeUtxoAddress } from '../core/utxoAddresses';
import type { UtxoNetwork } from '../core/utxoNetworks';
import { QrScanner } from './QrScanner';

/** A recipient scan cannot select a network, change an amount, or submit a transfer. */
export function UtxoRecipientQrScanner({ network, onScan, onClose }: {
  network: UtxoNetwork;
  onScan(address: string): void;
  onClose(): void;
}) {
  const parse = useCallback((value: string) => {
    try { return normalizeUtxoAddress(value, network); }
    catch { return null; }
  }, [network]);
  return <QrScanner parse={parse} onScan={onScan} onClose={onClose} copy={{
    title: 'Scan recipient address',
    instructions: `Scan a public address on ${network.name}. Check the address before sending.`,
    unavailable: 'Paste or enter the recipient address instead.',
    permission: 'Allow camera access in Settings to scan recipient addresses.',
    invalidTitle: 'Recipient address needed',
    invalidBody: `This QR code does not contain a valid address on ${network.name}.`,
    manualAction: 'Enter address manually',
    webUnavailable: 'The native app can scan recipient addresses. Enter the address in this browser preview.',
  }} />;
}
