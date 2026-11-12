import { useNativeTranslation } from '../platform/localization';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, CameraView } from 'expo-camera';
import type { PermissionResponse } from 'expo';
import { Button, colors, Header, IconButton, Notice, Screen, Text } from '../ui';
import type { QrScannerProps } from './QrScanner.types';
import { requestNativeCameraPermission } from '../platform/cameraPermission';

/** Camera ownership and permission are scoped to this explicitly opened scanner. */
export function QrScanner<T>({ parse, copy, onScan, onClose }: QrScannerProps<T>) {
  const { t } = useNativeTranslation();
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const [failure, setFailure] = useState(false);
  const [invalidCode, setInvalidCode] = useState(false);
  const [torch, setTorch] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const owner = useRef({ active: true, completed: false, enabled: false, foreground: AppState.currentState === 'active', cameraGeneration: 0 });

  useEffect(() => {
    const current = { active: true, completed: false, enabled: false, foreground: AppState.currentState === 'active', cameraGeneration: 0 };
    owner.current = current;
    let initialPermissionPending = true, permissionRevision = 0;
    const refreshPermission = () => {
      if (initialPermissionPending || !current.active || current.completed || !current.foreground) return;
      const revision = ++permissionRevision;
      const isCurrent = () => current.active && !current.completed && current.foreground && permissionRevision === revision;
      current.enabled = false; current.cameraGeneration++;
      setPermission(null); setTorch(false); setCameraReady(false);
      void Promise.resolve().then(() => isCurrent() ? Camera.getCameraPermissionsAsync() : undefined).then(result => {
        if (result && isCurrent()) { current.enabled = result.granted; setPermission(result); setFailure(false); }
      }).catch(() => { if (isCurrent()) { current.enabled = false; setFailure(true); } });
    };
    const change = AppState.addEventListener('change', (state) => {
      const wasForeground = current.foreground;
      current.foreground = state === 'active';
      if (!current.foreground) { permissionRevision++; current.cameraGeneration++; setTorch(false); setCameraReady(false); }
      if (current.active) setForeground(current.foreground);
      if (!wasForeground && current.foreground) refreshPermission();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      current.foreground = false;
      permissionRevision++; current.cameraGeneration++;
      setTorch(false); setCameraReady(false);
      if (current.active) setForeground(false);
    }) : null;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => {
      const wasForeground = current.foreground;
      current.foreground = AppState.currentState === 'active';
      if (current.active && !current.completed) setForeground(current.foreground);
      if (!wasForeground && current.foreground) refreshPermission();
    }) : null;
    void Promise.resolve().then(() => {
      if (!current.active || current.completed) return undefined;
      return requestNativeCameraPermission(() => current.active && !current.completed);
    }).then((result) => {
      if (result && current.active && !current.completed) { current.enabled = result.granted; setPermission(result); }
    }).catch(() => {
      if (current.active && !current.completed) { current.enabled = false; setFailure(true); }
    }).finally(() => { initialPermissionPending = false; });
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
  const cameraOwner = owner.current, cameraGeneration = cameraOwner.cameraGeneration;
  const isCurrentCamera = () => owner.current === cameraOwner && cameraOwner.cameraGeneration === cameraGeneration &&
    cameraOwner.active && !cameraOwner.completed && cameraOwner.enabled && cameraOwner.foreground && AppState.currentState === 'active';
  const scan = ({ data }: { data: string }) => {
    if (!isCurrentCamera()) return;
    let value: T | null;
    try { value = parse(data); } catch { value = null; }
    if (!isCurrentCamera()) return;
    if (value === null) { setInvalidCode(true); return; }
    cameraOwner.completed = true;
    onScan(value);
  };
  const openSettings = () => { void Linking.openSettings().catch(() => {
    if (owner.current.active && !owner.current.completed) setFailure(true);
  }); };

  return <SafeAreaView edges={['top']} style={s.container}><Screen>
    <Header title={copy.title} right={<IconButton label={t('mobile.scanner.close')} icon="close" onPress={close} />} />
    {failure ? <Notice title={t('mobile.scanner.unavailable')} body={copy.unavailable} />
      : permission === null ? <ActivityIndicator color={colors.blue} accessibilityLabel={t('mobile.scanner.requesting')} />
      : permission.granted ? <>
        {foreground && <View style={s.camera}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" autofocus="on" active={foreground} enableTorch={torch}
            onCameraReady={() => { if (isCurrentCamera()) setCameraReady(true); }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scan}
            onMountError={() => {
              if (isCurrentCamera()) { cameraOwner.cameraGeneration++; cameraOwner.enabled = false; setTorch(false); setCameraReady(false); setFailure(true); }
            }} />
          <View pointerEvents="none" style={s.target} />
        </View>}
        <Text style={s.caption}>{copy.instructions}</Text>
        {foreground && cameraReady && <Button title={torch ? t('mobile.scanner.torchOff') : t('mobile.scanner.torchOn')} icon="torch" variant="secondary" size="compact" onPress={() => {
          if (isCurrentCamera()) setTorch(value => !value);
        }} />}
        <Text style={s.caption}>{t('mobile.scanner.safety')}</Text>
        {invalidCode && <Notice title={copy.invalidTitle} body={copy.invalidBody} />}
      </> : <>
        <Notice title={t('mobile.scanner.accessNeeded')} body={copy.permission} />
        <Button icon="settings" title={t('mobile.scanner.settings')} onPress={openSettings} />
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
