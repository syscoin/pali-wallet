import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Linking, Modal, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PALI_STORES } from '../../../../source/shared/walletStores';
import { checkAppUpdate, completeAppUpdate, startAppUpdate, subscribeAppUpdates, type AppUpdateState } from '../platform/appUpdates';
import { mobileUpdates } from '../updates/service';
import type { MobileUpdateService } from '../updates/types';
import { Button, Card, colors, Header, Icon, Notice, Screen, Text } from '../ui';

export function WalletUpdatePanel({ allowInstall = false, onLock, service = mobileUpdates }: {
  allowInstall?: boolean; onLock?(): void; service?: MobileUpdateService;
}) {
  const update = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const [store, setStore] = useState<AppUpdateState | null>(null);
  const [error, setError] = useState('');
  const generation = useMemo(() => ({ service, allowInstall }), [service, allowInstall]);
  const [operation, setOperation] = useState<object | null>(null);
  const busy = operation === generation;
  const owner = useRef<{ active: boolean; install: boolean; request: AbortController | null }>({ active: false, install: false, request: null });
  useLayoutEffect(() => {
    const life = { active: true, install: allowInstall, request: null as AbortController | null }; owner.current = life;
    const stop = subscribeAppUpdates(next => { if (life.active) setStore(next); });
    void checkAppUpdate().then(next => { if (life.active) setStore(next); }).catch(() => undefined);
    void service.check().catch(() => undefined);
    return () => { life.active = false; life.request?.abort(); stop(); };
  }, [service, allowInstall]);
  const act = async (action: (signal: AbortSignal) => Promise<unknown>, install = false) => {
    const life = owner.current;
    if (!life.active || life.request || install && !life.install || AppState.currentState !== 'active') return;
    const request = new AbortController(); life.request = request; setOperation(generation); setError('');
    try { await action(request.signal); }
    catch { if (life.active && owner.current === life && !request.signal.aborted) setError('Could not complete the update action. Please try again.'); }
    finally { if (life.request === request) { life.request = null; if (life.active && owner.current === life) setOperation(null); } }
  };
  const release = update.release;
  const downloaded = store?.installStatus === 'downloaded';
  const playAvailable = store?.storeAvailable && store.availability === 'available';
  const storeUrl = Platform.OS === 'ios' ? PALI_STORES.ios : Platform.OS === 'android' ? PALI_STORES.android : null;
  return <Card style={{ padding: 18, gap: 14 }}>
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Icon name={release?.severity === 'critical' ? 'shield' : 'refresh'} color={colors.blue} />
      <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '600', flex: 1 }}>App updates</Text>
      {(release || playAvailable || downloaded) && <Text style={{ color: colors.blue }}>Available</Text>}
    </View>
    {release ? <>
      <Text style={{ fontSize: 17, fontWeight: '600' }}>{release.title}</Text>
      <Text style={{ color: colors.muted, lineHeight: 21 }}>Version {release.version} · {release.severity === 'critical' ? 'Security update' : release.severity === 'important' ? 'Important update' : 'Update'}</Text>
      <Text style={{ lineHeight: 22 }}>{release.summary}</Text>
      <Button title="Release notes" icon="external" variant="secondary" disabled={busy} onPress={() => void act(() => Linking.openURL(release.releaseNotesUrl))} />
    </> : <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, lineHeight: 22 }}>
      {downloaded ? 'Your update is ready to install.' : playAvailable ? 'A new Pali version is available on Google Play.' :
        update.status === 'checking' ? 'Checking for updates…' : update.status === 'error' ? 'Updates could not be checked. Try again later.' :
          update.status === 'ready' ? 'No newer published release was found.' : 'Check for the latest published Pali release.'}
    </Text>}
    {store?.installStatus === 'downloading' && <Text accessibilityLiveRegion="polite">Downloading update{store.totalBytesToDownload > 0 ? ` · ${Math.min(100, Math.floor(store.bytesDownloaded / store.totalBytesToDownload * 100))}%` : '…'}</Text>}
    {allowInstall && Platform.OS === 'android' && (downloaded || playAvailable && store?.flexibleAllowed) ?
      <Button title={downloaded ? 'Restart and install' : 'Download update'} icon="refresh" disabled={busy} onPress={() => void act(async signal => {
        const current = owner.current;
        if (downloaded) await completeAppUpdate(signal);
        else {
          const result = await startAppUpdate('flexible', signal);
          if (result === 'unavailable') throw Error();
        }
        const next = await checkAppUpdate();
        if (!signal.aborted && current.active && owner.current === current) setStore(next);
      }, true)} /> : !allowInstall && (release || playAvailable || downloaded) && onLock ?
      <Button title="Lock Pali to update" icon="lock" disabled={busy} onPress={onLock} /> :
      storeUrl && (release || playAvailable) && <Button title="View in app store" icon="external" disabled={busy} onPress={() => void act(() => Linking.openURL(storeUrl))} />}
    <Button title={update.status === 'checking' ? 'Checking…' : 'Check for updates'} variant="secondary" disabled={busy || update.status === 'checking'} onPress={() => void act(async () => {
      const current = owner.current;
      await service.check(true); const next = await checkAppUpdate();
      if (current.active && owner.current === current) setStore(next);
    })} />
    <Button title={update.alertsEnabled && update.permission === 'granted' ? 'Turn off update alerts' : 'Enable update alerts'} variant="secondary" icon="shield" disabled={busy}
      onPress={() => void act(() => service.setAlerts(!(update.alertsEnabled && update.permission === 'granted')))} />
    <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>Important updates can notify you when Pali checks for releases. Delivery while Pali is closed depends on your phone’s background and notification settings.</Text>
    {update.alertsEnabled && update.permission === 'denied' && <Text style={{ color: colors.muted }}>Allow Pali notifications in your phone’s settings to receive alerts.</Text>}
    {release && update.status === 'error' && <Text accessibilityRole="alert">The latest check failed. Showing the last known release.</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.red }}>{error}</Text>}
  </Card>;
}

/** The installation surface exists only while no wallet operation is open. */
export function LockedWalletUpdate({ disabled = false }: { disabled?: boolean }) {
  const update = useSyncExternalStore(mobileUpdates.subscribe, mobileUpdates.getSnapshot, mobileUpdates.getSnapshot);
  const [store, setStore] = useState<AppUpdateState | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    const stop = subscribeAppUpdates(next => { if (active) setStore(next); });
    void checkAppUpdate().then(next => { if (active) setStore(next); }).catch(() => undefined);
    return () => { active = false; stop(); };
  }, []);
  if (!update.release && !(store?.storeAvailable && (store.availability === 'available' || store.installStatus === 'downloaded'))) return null;
  return <>
    <Button title={update.release ? `Update available · ${update.release.version}` : 'Update available'} variant="secondary" icon="refresh" disabled={disabled} onPress={() => setOpen(true)} />
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><Screen footer={<Button title="Done" variant="secondary" onPress={() => setOpen(false)} />}>
        <Header title="Update Pali" />
        <Notice title="Install when you’re ready" body="Pali stays locked during the update. Your wallet and saved recovery data remain on this phone." />
        {open && <WalletUpdatePanel allowInstall />}
      </Screen></SafeAreaView>
    </Modal>
  </>;
}
