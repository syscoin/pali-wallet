import React, { useLayoutEffect, useRef, useState } from 'react';
import { DisplayCurrency } from './DisplayCurrency';
import { BalancePrivacySetting } from './BalancePrivacySetting';
import { HelpAbout } from './HelpAbout';
import { WalletUpdatePanel } from './WalletUpdatePanel';
import { NativePreferences } from './NativePreferences';
import { WalletBackupBadge } from './WalletBackupBadge';
import { ActivityNotifications, type NotificationSettingsTarget } from './ActivityNotifications';
import { useNativeTranslation } from '../platform/localization';
import type { ShellLeafNavigation } from './RealAppShell';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, Header, Notice, Row, Screen, Text } from '../ui';

export type ActivityResetTarget = Readonly<{
  scope: string;
  networkLabel: string;
  reset(assertCurrent: () => void): Promise<void>;
}>;

function ResetActivity({ accountLabel, target, onBack }: {
  accountLabel: string; target: ActivityResetTarget; onBack(): void;
}) {
  const { t } = useNativeTranslation();
  const attempt = useRef(0);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useLayoutEffect(() => () => { attempt.current++; }, []);
  const reset = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const captured = ++attempt.current;
    const assertCurrent = () => { if (attempt.current !== captured) throw new Error('CANCELLED'); };
    setBusy(true); setError(false);
    try {
      await target.reset(assertCurrent);
      assertCurrent();
      onBack();
    } catch {
      if (attempt.current === captured) setError(true);
    } finally {
      if (attempt.current === captured) { busyRef.current = false; setBusy(false); }
    }
  };
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen gap={16} footer={<>
    <Button title={busy ? t('mobile.resetActivity.working') : t('mobile.resetActivity.title')} variant="danger" disabled={busy} onPress={() => void reset()} />
    <Button title={t('buttons.back')} variant="secondary" onPress={onBack} />
  </>}>
    <Header title={t('mobile.resetActivity.title')} subtitle={`${accountLabel} · ${target.networkLabel}`} onBack={onBack} />
    <Notice title={t('mobile.resetActivity.question')} body={t('mobile.resetActivity.description')} />
    <Notice title={t('mobile.resetActivity.pendingTitle')} body={t('mobile.resetActivity.pendingBody')} tone="amber" />
    {error && <Notice title={t('mobile.resetActivity.failedTitle')} body={t('mobile.resetActivity.failedBody')} tone="amber" />}
  </Screen></SafeAreaView>;
}

export function RealSettings({ accountLabel, watchOnly, onSecurity, onAutoLock, onConnections, onInfrastructure, activityReset, notifications, onLock, onBack, navigation, backupRequired = false, onBackup }: {
  accountLabel: string; watchOnly: boolean; navigation?: ShellLeafNavigation; onSecurity?: () => void; onAutoLock?: () => void; onConnections?: () => void; onInfrastructure?: () => void; onLock(): void; onBack(): void;
  backupRequired?: boolean; onBackup?(): void;
  activityReset?: ActivityResetTarget;
  notifications?: NotificationSettingsTarget;
}) {
  const { t } = useNativeTranslation();
  const [opened, setOpened] = useState<Readonly<{ leaf: 'about' | 'updates' | 'currency' | 'activity' | 'language' | 'notifications'; scope?: string }> | null>(null);
  const languageOwner = useRef<typeof opened>(null);
  const notificationsOwner = useRef<typeof opened>(null);
  const leaf = opened?.leaf === 'activity' && opened.scope !== activityReset?.scope || opened?.leaf === 'notifications' && opened.scope !== notifications?.scope ? null : opened?.leaf ?? null;
  const back = () => { languageOwner.current = null; notificationsOwner.current = null; if (leaf === 'updates') setOpened({ leaf: 'about' }); else if (leaf) setOpened(null); else onBack(); };
  useLayoutEffect(() => () => { languageOwner.current = null; notificationsOwner.current = null; }, []);
  useLayoutEffect(() => navigation?.registerBack(() => { back(); return true; }));
  useLayoutEffect(() => { navigation?.setImmersive(leaf !== null); return () => navigation?.setImmersive(false); }, [navigation, leaf]);
  if (leaf === 'about') return <HelpAbout onBack={back} onUpdates={() => setOpened({ leaf: 'updates' })} />;
  if (leaf === 'updates') return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
    <Screen footer={<Button title="Done" variant="secondary" onPress={back} />}>
      <Header title="App updates" onBack={back} /><WalletUpdatePanel allowInstall={watchOnly} onLock={onLock} />
    </Screen></SafeAreaView>;
  if (leaf === 'currency') return <DisplayCurrency onBack={back} />;
  if (leaf === 'language') return <NativePreferences onBack={back} assertCurrent={() => {
    if (languageOwner.current !== opened) throw new Error('CANCELLED');
  }} />;
  if (leaf === 'activity' && activityReset) return <ResetActivity key={activityReset.scope} accountLabel={accountLabel} target={activityReset} onBack={back} />;
  if (leaf === 'notifications' && notifications) return <ActivityNotifications key={notifications.scope} target={{ ...notifications,
    assertCurrent() { if (notificationsOwner.current !== opened) throw Error('CANCELLED'); notifications.assertCurrent(); },
  }} onBack={back} />;
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen gap={16} footer={
    <Button title={watchOnly ? t('mobile.settings.hide') : t('mobile.settings.lock')} icon="lock" size="compact" variant="secondary" onPress={onLock} />
  }>
    <Header title={t('mobile.settings.title')} subtitle={accountLabel} onBack={navigation ? undefined : onBack} />
    {backupRequired && onBackup && <WalletBackupBadge onPress={onBackup} />}
    {(onSecurity || onConnections || onInfrastructure || activityReset) && <Card>
      {onSecurity && <Row title={t('mobile.settings.securityTitle')} subtitle={t('mobile.settings.securitySubtitle')} icon="shield" onPress={onSecurity} dense last={!onConnections && !onInfrastructure && !activityReset} />}
      {onConnections && <Row title={t('mobile.tools.connections')} subtitle={t('mobile.tools.connectionsBody')} icon="globe" onPress={onConnections} dense last={!onInfrastructure && !activityReset} />}
      {onInfrastructure && <Row title={t('settings.smartAccountInfrastructure')} subtitle={t('settings.smartAccountInfrastructureCheckStatus')} icon="shield" onPress={onInfrastructure} dense last={!activityReset} />}
      {activityReset && <Row title={t('mobile.settings.activityTitle')} subtitle={t('mobile.settings.activitySubtitle')} icon="activity" onPress={() => setOpened({ leaf: 'activity', scope: activityReset.scope })} dense last />}
    </Card>}
    <Card>
      {notifications && <Row title={t('mobile.notifications.title')} subtitle={t('mobile.notifications.description')} icon="activity" onPress={() => {
        const next = { leaf: 'notifications' as const, scope: notifications.scope }; notificationsOwner.current = next; setOpened(next);
      }} dense />}
      {watchOnly && onAutoLock && <Row title="Auto-lock" subtitle="Choose when watch accounts hide" icon="clock" onPress={onAutoLock} dense />}
      {watchOnly && <BalancePrivacySetting />}
      <Row title={t('generalMenu.languages')} subtitle={t('settings.currentLanguage')} icon="globe" dense onPress={() => {
        const next = { leaf: 'language' as const }; languageOwner.current = next; setOpened(next);
      }} />
      <Row title={t('mobile.settings.currencyTitle')} subtitle={t('mobile.settings.currencySubtitle')} icon="globe" onPress={() => setOpened({ leaf: 'currency' })} dense />
      <Row title={t('mobile.settings.helpTitle')} subtitle={t('mobile.settings.helpSubtitle')} icon="info" onPress={() => setOpened({ leaf: 'about' })} dense last />
    </Card>
    {watchOnly && <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>{t('mobile.settings.watchBody')}</Text>}
    <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>{t('mobile.settings.deviceBody')}</Text>
  </Screen></SafeAreaView>;
}
