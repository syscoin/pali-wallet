import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, CameraView } from 'expo-camera';
import type { PermissionResponse } from 'expo';
import { extractPairingUri } from '../connections/pairingLinks';
import { Button, colors, Header, Notice, Screen, Text } from '../ui';
import type { ConnectionQrScannerProps } from './ConnectionQrScanner.types';

/** The camera opens only after the user chooses Scan in Connected apps. */
export function ConnectionQrScanner({ onScan, onClose }: ConnectionQrScannerProps) {
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const [failure, setFailure] = useState(false);
  const [invalidCode, setInvalidCode] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const owner = useRef({ active: true, completed: false, enabled: false, foreground: AppState.currentState === 'active' });

  useEffect(() => {
    const current = { active: true, completed: false, enabled: false, foreground: AppState.currentState === 'active' };
    owner.current = current;
    const change = AppState.addEventListener('change', (state) => {
      current.foreground = state === 'active';
      if (current.active) setForeground(current.foreground);
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      current.foreground = false;
      if (current.active) setForeground(false);
    }) : null;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => {
      current.foreground = AppState.currentState === 'active';
      if (current.active && !current.completed) setForeground(current.foreground);
    }) : null;
    void Promise.resolve().then(() => {
      if (!current.active || current.completed) return undefined;
      return Camera.requestCameraPermissionsAsync();
    }).then((result) => {
      if (result && current.active && !current.completed) { current.enabled = result.granted; setPermission(result); }
    }).catch(() => {
      if (current.active && !current.completed) { current.enabled = false; setFailure(true); }
    });
    return () => { current.active = false; change.remove(); blur?.remove(); focus?.remove(); };
  }, []);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      owner.current.completed = true;
      onClose();
      return true;
    });
    return () => back.remove();
  }, [onClose]);

  const close = () => { owner.current.completed = true; onClose(); };
  const scan = ({ data }: { data: string }) => {
    const current = owner.current;
    if (!current.active || current.completed || !current.enabled || !current.foreground || AppState.currentState !== 'active') return;
    const uri = extractPairingUri(data);
    if (!uri) { setInvalidCode(true); return; }
    current.completed = true;
    onScan(uri);
  };
  const openSettings = () => { void Linking.openSettings().catch(() => {
    if (owner.current.active && !owner.current.completed) setFailure(true);
  }); };

  return <SafeAreaView edges={['top']} style={s.container}><Screen>
    <Header title="Scan connection code" onBack={close} />
    {failure ? <Notice title="Camera unavailable" body="Use a copied WalletConnect link to connect instead." />
      : permission === null ? <ActivityIndicator color={colors.blue} accessibilityLabel="Requesting camera access" />
      : permission.granted ? <>
        {foreground && <View style={s.camera}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" autofocus="on" active={foreground}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scan}
            onMountError={() => {
              const current = owner.current;
              if (current.active && !current.completed) { current.enabled = false; setFailure(true); }
            }} />
          <View pointerEvents="none" style={s.target} />
        </View>}
        <Text style={s.caption}>Scan the WalletConnect QR code shown by the app you want to connect to.</Text>
        {invalidCode && <Notice title="Connection code needed" body="This code is not a WalletConnect link." />}
      </> : <>
        <Notice title="Camera access needed" body="Allow camera access in Settings to scan connection codes." />
        <Button title="Open Settings" onPress={openSettings} />
      </>}
    <Button title="Use pasted link" variant="quiet" onPress={close} />
  </Screen></SafeAreaView>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  camera: { aspectRatio: 1, width: '100%', overflow: 'hidden', borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  target: { width: '70%', height: '70%', borderWidth: 2, borderColor: colors.blue, borderRadius: 18 },
  caption: { fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center' },
});
