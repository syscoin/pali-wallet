import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, CameraView } from 'expo-camera';
import type { PermissionResponse } from 'expo';
import { Button, colors, Header, IconButton, Notice, Screen, Text } from '../ui';
import type { QrScannerProps } from './QrScanner.types';

/** Camera ownership and permission are scoped to this explicitly opened scanner. */
export function QrScanner<T>({ parse, copy, onScan, onClose }: QrScannerProps<T>) {
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const [failure, setFailure] = useState(false);
  const [invalidCode, setInvalidCode] = useState(false);
  const [torch, setTorch] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const owner = useRef({ active: true, completed: false, enabled: false, foreground: AppState.currentState === 'active' });

  useEffect(() => {
    const current = { active: true, completed: false, enabled: false, foreground: AppState.currentState === 'active' };
    owner.current = current;
    const change = AppState.addEventListener('change', (state) => {
      current.foreground = state === 'active';
      if (!current.foreground) { setTorch(false); setCameraReady(false); }
      if (current.active) setForeground(current.foreground);
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      current.foreground = false;
      setTorch(false); setCameraReady(false);
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
    let value: T | null;
    try { value = parse(data); } catch { value = null; }
    if (!current.active || current.completed || !current.foreground || AppState.currentState !== 'active') return;
    if (value === null) { setInvalidCode(true); return; }
    current.completed = true;
    onScan(value);
  };
  const openSettings = () => { void Linking.openSettings().catch(() => {
    if (owner.current.active && !owner.current.completed) setFailure(true);
  }); };

  return <SafeAreaView edges={['top']} style={s.container}><Screen>
    <Header title={copy.title} right={<IconButton label="Close scanner" icon="close" onPress={close} />} />
    {failure ? <Notice title="Camera unavailable" body={copy.unavailable} />
      : permission === null ? <ActivityIndicator color={colors.blue} accessibilityLabel="Requesting camera access" />
      : permission.granted ? <>
        {foreground && <View style={s.camera}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" autofocus="on" active={foreground} enableTorch={torch}
            onCameraReady={() => { if (owner.current.active && !owner.current.completed && owner.current.foreground) setCameraReady(true); }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scan}
            onMountError={() => {
              const current = owner.current;
              if (current.active && !current.completed) { current.enabled = false; setTorch(false); setCameraReady(false); setFailure(true); }
            }} />
          <View pointerEvents="none" style={s.target} />
        </View>}
        <Text style={s.caption}>{copy.instructions}</Text>
        {foreground && cameraReady && <Button title={torch ? 'Turn off flashlight' : 'Turn on flashlight'} icon="torch" variant="secondary" size="compact" onPress={() => {
          if (owner.current.active && !owner.current.completed && owner.current.foreground) setTorch(value => !value);
        }} />}
        <Text style={s.caption}>Scanning never signs a transaction. You review requests before approving them.</Text>
        {invalidCode && <Notice title={copy.invalidTitle} body={copy.invalidBody} />}
      </> : <>
        <Notice title="Camera access needed" body={copy.permission} />
        <Button icon="settings" title="Open Settings" onPress={openSettings} />
      </>}
    <Button title={copy.manualAction} variant="secondary" onPress={close} />
  </Screen></SafeAreaView>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  camera: { aspectRatio: 1, width: '100%', overflow: 'hidden', borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  target: { width: '70%', height: '70%', borderWidth: 2, borderColor: colors.blue, borderRadius: 18 },
  caption: { fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center' },
});
