import React, { useLayoutEffect, useRef, useState } from 'react';
import { DisplayCurrency } from './DisplayCurrency';
import { HelpAbout } from './HelpAbout';
import { NativePreferences } from './NativePreferences';
import { useNativeTranslation } from '../platform/localization';
import type { ShellLeafNavigation } from './RealAppShell';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, Header, Notice, Row, Screen } from '../ui';

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
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title={t('mobile.resetActivity.title')} subtitle={`${accountLabel} · ${target.networkLabel}`} onBack={onBack} />
    <Notice title={t('mobile.resetActivity.question')} body={t('mobile.resetActivity.description')} />
    <Notice title={t('mobile.resetActivity.pendingTitle')} body={t('mobile.resetActivity.pendingBody')} tone="amber" />
    {error && <Notice title={t('mobile.resetActivity.failedTitle')} body={t('mobile.resetActivity.failedBody')} tone="amber" />}
    <Button title={busy ? t('mobile.resetActivity.working') : t('mobile.resetActivity.title')} variant="danger" disabled={busy} onPress={() => void reset()} />
    <Button title={t('buttons.back')} variant="secondary" onPress={onBack} />
  </Screen></SafeAreaView>;
}

export function RealSettings({ accountLabel, watchOnly, onSecurity, onAutoLock, activityReset, onLock, onBack, navigation }: {
  accountLabel: string; watchOnly: boolean; navigation: ShellLeafNavigation; onSecurity?: () => void; onAutoLock?: () => void; onLock(): void; onBack(): void;
  activityReset?: ActivityResetTarget;
}) {
  const { t } = useNativeTranslation();
  const [opened, setOpened] = useState<Readonly<{ leaf: 'about' | 'currency' | 'activity' | 'language'; scope?: string }> | null>(null);
  const languageOwner = useRef<typeof opened>(null);
  const leaf = opened?.leaf === 'activity' && opened.scope !== activityReset?.scope ? null : opened?.leaf ?? null;
  const back = () => { languageOwner.current = null; if (leaf) setOpened(null); else onBack(); };
  useLayoutEffect(() => () => { languageOwner.current = null; }, []);
  useLayoutEffect(() => navigation.registerBack(() => { back(); return true; }));
  useLayoutEffect(() => { navigation.setImmersive(leaf !== null); return () => navigation.setImmersive(false); }, [navigation, leaf]);
  if (leaf === 'about') return <HelpAbout onBack={back} />;
  if (leaf === 'currency') return <DisplayCurrency onBack={back} />;
  if (leaf === 'language') return <NativePreferences onBack={back} assertCurrent={() => {
    if (languageOwner.current !== opened) throw new Error('CANCELLED');
  }} />;
  if (leaf === 'activity' && activityReset) return <ResetActivity key={activityReset.scope} accountLabel={accountLabel} target={activityReset} onBack={back} />;
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title={t('mobile.settings.title')} subtitle={accountLabel} onBack={onBack} />
    {onSecurity && <Card><Row title={t('mobile.settings.securityTitle')} subtitle={t('mobile.settings.securitySubtitle')} icon="shield" onPress={onSecurity} last /></Card>}
    {onAutoLock && <Card><Row title={t('mobile.settings.autoLockTitle')} subtitle={t('mobile.settings.autoLockSubtitle')} icon="lock" onPress={onAutoLock} last /></Card>}
    {activityReset && <Card><Row title={t('mobile.settings.activityTitle')} subtitle={t('mobile.settings.activitySubtitle')} icon="activity" onPress={() => setOpened({ leaf: 'activity', scope: activityReset.scope })} last /></Card>}
    {watchOnly && <Notice title={t('mobile.settings.watchTitle')} body={t('mobile.settings.watchBody')} />}
    <Notice title={t('mobile.settings.deviceTitle')} body={t('mobile.settings.deviceBody')} />
    <Card>
      <Row title={t('generalMenu.languages')} subtitle={t('settings.currentLanguage')} icon="globe" onPress={() => {
        const next = { leaf: 'language' as const }; languageOwner.current = next; setOpened(next);
      }} />
      <Row title={t('mobile.settings.currencyTitle')} subtitle={t('mobile.settings.currencySubtitle')} icon="globe" onPress={() => setOpened({ leaf: 'currency' })} />
      <Row title={t('mobile.settings.helpTitle')} subtitle={t('mobile.settings.helpSubtitle')} icon="info" onPress={() => setOpened({ leaf: 'about' })} last />
    </Card>
    <Button title={watchOnly ? t('mobile.settings.hide') : t('mobile.settings.lock')} icon="lock" variant="secondary" onPress={onLock} />
  </Screen></SafeAreaView>;
}
