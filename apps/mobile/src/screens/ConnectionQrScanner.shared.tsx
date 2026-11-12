import { useNativeTranslation } from '../platform/localization';
import React from 'react';
import { extractPairingUri } from '../connections/pairingLinks';
import { QrScanner } from './QrScanner';
import type { ConnectionQrScannerProps } from './ConnectionQrScanner.types';
export function ConnectionQrScanner(props: ConnectionQrScannerProps) {
  const { t } = useNativeTranslation();
  return <QrScanner {...props} parse={extractPairingUri} copy={{
    title: t('mobile.scanner.connectionTitle'),
    instructions: t('mobile.scanner.connectionInstructions'),
    unavailable: t('mobile.scanner.connectionUnavailable'),
    permission: t('mobile.scanner.connectionPermission'),
    invalidTitle: t('mobile.scanner.connectionInvalidTitle'), invalidBody: t('mobile.scanner.connectionInvalid'),
    manualAction: t('mobile.scanner.manualLink'),
    webUnavailable: t('mobile.scanner.connectionWeb'),
  }} />;
}
