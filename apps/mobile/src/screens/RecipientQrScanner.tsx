import { useNativeTranslation } from '../platform/localization';
import React from 'react';
import { parseEvmRecipientQr } from '../core/recipientQr';
import { QrScanner } from './QrScanner';
export function RecipientQrScanner({ onScan, onClose }: { onScan(address: string): void; onClose(): void }) {
  const { t } = useNativeTranslation();
  return <QrScanner parse={parseEvmRecipientQr} onScan={onScan} onClose={onClose} copy={{
    title: t('mobile.scanner.recipientTitle'),
    instructions: t('mobile.scanner.evmInstructions'),
    unavailable: t('mobile.scanner.recipientUnavailable'),
    permission: t('mobile.scanner.recipientPermission'),
    invalidTitle: t('mobile.scanner.recipientInvalidTitle'), invalidBody: t('mobile.scanner.evmInvalid'),
    manualAction: t('mobile.scanner.manualAddress'),
    webUnavailable: t('mobile.scanner.recipientWeb'),
  }} />;
}
