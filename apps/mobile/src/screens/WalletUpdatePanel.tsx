import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Linking, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PALI_STORES } from '../../../../source/shared/walletStores';
import { checkAppUpdate, completeAppUpdate, startAppUpdate, subscribeAppUpdates, type AppUpdateState } from '../platform/appUpdates';
import { mobileUpdates } from '../updates/service';
import type { MobileUpdateService } from '../updates/types';
import { useNativeTranslation } from '../platform/localization';
import { Button, Card, colors, Header, Icon, Notice, Screen, Text } from '../ui';

function updateInProgress(store: AppUpdateState | null): boolean {
  return !!store && !['failed', 'cancelled', 'installed'].includes(store.installStatus) &&
    (store.availability === 'in-progress' || ['pending', 'downloading', 'installing'].includes(store.installStatus));
}

export function WalletUpdatePanel({ allowInstall = false, onCloseWallet, service = mobileUpdates }: {
  allowInstall?: boolean; onCloseWallet?(): void; service?: MobileUpdateService;
}) {
  const { t } = useNativeTranslation();
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
    catch { if (life.active && owner.current === life && !request.signal.aborted) setError(t('mobile.shellViews.walletUpdatePanel.couldNotCompleteTheUpdateActionPleaseTry')); }
    finally { if (life.request === request) { life.request = null; if (life.active && owner.current === life) setOperation(null); } }
  };
  const release = update.release;
  const downloaded = store?.installStatus === 'downloaded';
  const inProgress = updateInProgress(store);
  const interrupted = store?.installStatus === 'failed' || store?.installStatus === 'cancelled';
  const installed = store?.installStatus === 'installed';
  const playAvailable = !installed && store?.storeAvailable && store.availability === 'available';
  const progress = store?.installStatus === 'failed' ? t('mobile.shellViews.walletUpdatePanel.theUpdateDownloadFailedCheckForUpdatesOr')
    : store?.installStatus === 'cancelled' ? t('mobile.shellViews.walletUpdatePanel.theUpdateDownloadWasCancelledCheckForUpdates')
      : installed ? t('mobile.shellViews.walletUpdatePanel.theUpdateWasInstalled') : downloaded ? t('mobile.shellViews.walletUpdatePanel.yourUpdateIsReadyToInstall') : store?.installStatus === 'installing' ? t('mobile.shellViews.walletUpdatePanel.installingUpdate')
    : store?.installStatus === 'downloading' ? store.totalBytesToDownload > 0 ? t('mobile.shellViews.update.downloadingProgress', { percent: Math.min(100, Math.floor(store.bytesDownloaded / store.totalBytesToDownload * 100)) }) : t('mobile.shellViews.update.downloading')
      : store?.installStatus === 'pending' ? t('mobile.shellViews.walletUpdatePanel.updateDownloadPending') : inProgress ? t('mobile.shellViews.walletUpdatePanel.anUpdateIsInProgress') : null;
  const storeUrl = Platform.OS === 'ios' ? PALI_STORES.ios : Platform.OS === 'android' ? PALI_STORES.android : null;
  return <Card style={{ padding: 18, gap: 14 }}>
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Icon name={release?.severity === 'critical' ? 'shield' : 'refresh'} color={colors.blue} />
      <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '600', flex: 1 }}>{t('mobile.generalViews.appUpdates')}</Text>
      {(release || playAvailable || downloaded || inProgress || interrupted || installed) && <Text style={{ color: colors.blue }}>{interrupted ? store?.installStatus === 'failed' ? t('mobile.shellViews.walletUpdatePanel.downloadFailed') : t('send.canceled') : installed ? t('settings.installed') : downloaded ? t('mobile.shellViews.walletUpdatePanel.readyToInstall') : inProgress ? t('mobile.shellViews.walletUpdatePanel.inProgress') : t('mobile.smartSendViews.available')}</Text>}
    </View>
    {progress && <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, lineHeight: 22 }}>{progress}</Text>}
    {release ? <>
      <Text style={{ fontSize: 17, fontWeight: '600' }}>{release.title}</Text>
      <Text style={{ color: colors.muted, lineHeight: 21 }}>{t('mobile.generalViews.version', { version: release.version })} · {release.severity === 'critical' ? t('mobile.shellViews.walletUpdatePanel.securityUpdate') : release.severity === 'important' ? t('updates.severity.important') : t('settings.smartAccountGuardianRecoveryUpdate')}</Text>
      <Text style={{ lineHeight: 22 }}>{release.summary}</Text>
      <Button title={t('updates.releaseNotes')} icon="external" variant="secondary" disabled={busy} onPress={() => void act(() => Linking.openURL(release.releaseNotesUrl))} />
    </> : !progress && <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, lineHeight: 22 }}>
      {playAvailable ? t('mobile.shellViews.walletUpdatePanel.aNewPaliVersionIsAvailableOnGoogle') :
        update.status === 'checking' ? t('updates.checking') : update.status === 'error' ? t('mobile.shellViews.walletUpdatePanel.updatesCouldNotBeCheckedTryAgainLater') :
          update.status === 'ready' ? t('mobile.shellViews.walletUpdatePanel.noNewerPublishedReleaseWasFound') : t('mobile.shellViews.walletUpdatePanel.checkForTheLatestPublishedPaliRelease')}
    </Text>}
    {allowInstall && Platform.OS === 'android' && (downloaded || !inProgress && playAvailable && store?.flexibleAllowed) ?
      <Button title={downloaded ? t('mobile.shellViews.walletUpdatePanel.restartAndInstall') : t('mobile.shellViews.walletUpdatePanel.downloadUpdate')} icon="refresh" disabled={busy} onPress={() => void act(async signal => {
        const current = owner.current;
        if (downloaded) await completeAppUpdate(signal);
        else {
          const result = await startAppUpdate('flexible', signal);
          if (result === 'unavailable') throw Error();
        }
        const next = await checkAppUpdate();
        if (!signal.aborted && current.active && owner.current === current) setStore(next);
      }, true)} /> : !allowInstall && (release || playAvailable || downloaded || inProgress || interrupted) && onCloseWallet ?
      <Button title={t('mobile.nativeUpdate.closeWallet')} icon="close" disabled={busy} onPress={onCloseWallet} /> :
      !inProgress && storeUrl && (release || playAvailable || interrupted) && <Button title={t('mobile.shellViews.walletUpdatePanel.viewInAppStore')} icon="external" disabled={busy} onPress={() => void act(() => Linking.openURL(storeUrl))} />}
    <Button title={update.status === 'checking' ? t('privacy.checking') : t('updates.check')} variant="secondary" disabled={busy || update.status === 'checking'} onPress={() => void act(async () => {
      const current = owner.current;
      await service.check(true); const next = await checkAppUpdate();
      if (current.active && owner.current === current) setStore(next);
    })} />
    <Button title={update.alertsEnabled && update.permission === 'granted' ? t('mobile.shellViews.walletUpdatePanel.turnOffUpdateAlerts') : t('mobile.shellViews.walletUpdatePanel.enableUpdateAlerts')} variant="secondary" icon="shield" disabled={busy}
      onPress={() => void act(() => service.setAlerts(!(update.alertsEnabled && update.permission === 'granted')))} />
    <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>{t('mobile.shellViews.walletUpdatePanel.importantUpdatesCanNotifyYouWhenPaliChecks')}</Text>
    {update.alertsEnabled && update.permission === 'denied' && <Text style={{ color: colors.muted }}>{t('mobile.shellViews.walletUpdatePanel.allowPaliNotificationsInYourPhoneSSettings')}</Text>}
    {release && update.status === 'error' && <Text accessibilityRole="alert">{t('mobile.shellViews.walletUpdatePanel.theLatestCheckFailedShowingTheLastKnown')}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.red }}>{error}</Text>}
  </Card>;
}

/** An update entry does not itself authorize installation or close custody. */
export function LockedWalletUpdate({ disabled = false, onOpen }: { disabled?: boolean; onOpen(): void }) {
  const { t } = useNativeTranslation();
  const update = useSyncExternalStore(mobileUpdates.subscribe, mobileUpdates.getSnapshot, mobileUpdates.getSnapshot);
  const [store, setStore] = useState<AppUpdateState | null>(null);
  useEffect(() => {
    let active = true;
    const stop = subscribeAppUpdates(next => { if (active) setStore(next); });
    void checkAppUpdate().then(next => { if (active) setStore(next); }).catch(() => undefined);
    return () => { active = false; stop(); };
  }, []);
  const downloaded = store?.installStatus === 'downloaded', inProgress = updateInProgress(store);
  if (!update.release && !(store?.storeAvailable && store.availability === 'available') && !downloaded && !inProgress) return null;
  return <Button title={downloaded ? t('mobile.shellViews.walletUpdatePanel.updateReadyToInstall') : inProgress ? t('mobile.shellViews.walletUpdatePanel.updateInProgress') : update.release ? t('mobile.generalViews.updateAvailable', { version: update.release.version }) : t('updates.available')} variant="secondary" icon="refresh" disabled={disabled} onPress={onOpen} />;
}

/** The owner enables installation only after the complete wallet close has settled. */
export function WalletUpdateScreen({ phase, onBack }: { phase: 'closing' | 'ready' | 'failed'; onBack(): void }) {
  const { t } = useNativeTranslation();
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><Screen footer={<Button title={t('privacy.deposit.done')} variant="secondary" disabled={phase === 'closing'} onPress={onBack} />}>
    <Header title={t('mobile.nativeUpdate.title')} />
    {phase === 'closing' ? <Notice title={t('mobile.nativeUpdate.closingTitle')} body={t('mobile.nativeUpdate.closingBody')} /> :
      phase === 'failed' ? <Notice title={t('mobile.nativeUpdate.failedTitle')} body={t('mobile.nativeUpdate.failedBody')} tone="amber" /> :
      <><Notice title={t('mobile.nativeUpdate.readyTitle')} body={t('mobile.nativeUpdate.readyBody')} /><WalletUpdatePanel allowInstall /></>}
  </Screen></SafeAreaView>;
}
