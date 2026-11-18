import React, { useState } from 'react';
import { AppState, Keyboard, StyleSheet, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { parseSecretQr } from '../../../../source/utils/secretQr';
import { useNativeTranslation } from '../platform/localization';
import { Button } from '../ui';
import { QrScanner } from './QrScanner';

export function SecretQrReveal({ value, children, isCurrent }: {
  value: string; children: React.ReactNode; isCurrent(): boolean;
}) {
  const { t } = useNativeTranslation();
  const [visible, setVisible] = useState(false);
  const { width } = useWindowDimensions();
  if (visible && (AppState.currentState !== 'active' || !isCurrent())) return null;
  return <>
    {visible ? <View style={s.code} accessible accessibilityRole="image" accessibilityLabel={t('secretQr.visible')}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <QRCode value={value} size={Math.max(120, Math.min(232, width - 96))} quietZone={18} />
      </View>
    </View> : children}
    <Button title={t(visible ? 'secretQr.hide' : 'secretQr.show')} icon="qr" size="compact" variant="secondary"
      onPress={() => { if (AppState.currentState === 'active' && isCurrent()) setVisible(!visible); }} />
  </>;
}

export function SecretScanButton({ onPress, disabled }: { onPress(): void; disabled?: boolean }) {
  const { t } = useNativeTranslation();
  return <Button title={t('secretQr.scan')} icon="scan" size="compact" variant="secondary" disabled={disabled}
    onPress={() => { Keyboard.dismiss(); onPress(); }} />;
}

export function SecretQrScanner({ kind, onScan, onClose }: {
  kind: Parameters<typeof parseSecretQr>[1]; onScan(value: string): void; onClose(): void;
}) {
  const { t } = useNativeTranslation();
  return <QrScanner showSigningNotice={false} parse={text => parseSecretQr(text, kind)} onScan={onScan} onClose={onClose} copy={{
    title: t('secretQr.scan'), instructions: t('secretQr.scanHelp'),
    permission: t('secretQr.cameraPermission'), unavailable: t('secretQr.cameraUnavailable'),
    invalidTitle: t('secretQr.scanInvalid'),
    invalidBody: t('secretQr.scanHelp'),
    manualAction: t('buttons.back'), webUnavailable: t('secretQr.cameraUnavailable'),
  }} />;
}

const s = StyleSheet.create({ code: { alignItems: 'center' } });
