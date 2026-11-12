import { useNativeTranslation } from '../platform/localization';
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
  const { t } = useNativeTranslation();
  const parse = useCallback((value: string) => {
    try { return normalizeUtxoAddress(value, network); }
    catch { return null; }
  }, [network]);
  return <QrScanner parse={parse} onScan={onScan} onClose={onClose} copy={{
    title: t('mobile.scanner.recipientTitle'),
    instructions: t('mobile.scanner.utxoInstructions', { network: network.name }),
    unavailable: t('mobile.scanner.recipientUnavailable'),
    permission: t('mobile.scanner.recipientPermission'),
    invalidTitle: t('mobile.scanner.recipientInvalidTitle'),
    invalidBody: t('mobile.scanner.utxoInvalid', { network: network.name }),
    manualAction: t('mobile.scanner.manualAddress'),
    webUnavailable: t('mobile.scanner.recipientWeb'),
  }} />;
}
