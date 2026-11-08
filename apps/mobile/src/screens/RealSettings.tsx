import React, { useLayoutEffect, useRef, useState } from 'react';
import { DisplayCurrency } from './DisplayCurrency';
import { HelpAbout } from './HelpAbout';
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
    <Header title="Reset activity" subtitle={`${accountLabel} · ${target.networkLabel}`} onBack={onBack} />
    <Notice title="Clear local activity and nonce data?" body="Pali will remove locally saved transactions and nonce tracking for this account on this network, then refresh its activity." />
    <Notice title="Pending transactions can still execute" body="Transactions already held by the network remain pending and may still confirm." tone="amber" />
    {error && <Notice title="Activity reset incomplete" body="Try again. If your wallet locked, unlock it first." tone="amber" />}
    <Button title={busy ? 'Resetting activity…' : 'Reset activity'} variant="danger" disabled={busy} onPress={() => void reset()} />
    <Button title="Back" variant="secondary" onPress={onBack} />
  </Screen></SafeAreaView>;
}

export function RealSettings({ accountLabel, watchOnly, onSecurity, onAutoLock, activityReset, onLock, onBack, navigation }: {
  accountLabel: string; watchOnly: boolean; navigation: ShellLeafNavigation; onSecurity?: () => void; onAutoLock?: () => void; onLock(): void; onBack(): void;
  activityReset?: ActivityResetTarget;
}) {
  const [opened, setOpened] = useState<Readonly<{ leaf: 'about' | 'currency' | 'activity'; scope?: string }> | null>(null);
  const leaf = opened?.leaf === 'activity' && opened.scope !== activityReset?.scope ? null : opened?.leaf ?? null;
  const back = () => { if (leaf) setOpened(null); else onBack(); };
  useLayoutEffect(() => navigation.registerBack(() => { back(); return true; }));
  useLayoutEffect(() => { navigation.setImmersive(leaf !== null); return () => navigation.setImmersive(false); }, [navigation, leaf]);
  if (leaf === 'about') return <HelpAbout onBack={back} />;
  if (leaf === 'currency') return <DisplayCurrency onBack={back} />;
  if (leaf === 'activity' && activityReset) return <ResetActivity key={activityReset.scope} accountLabel={accountLabel} target={activityReset} onBack={back} />;
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title="Settings" subtitle={accountLabel} onBack={onBack} />
    {onSecurity && <Card><Row title="Security & backups" subtitle="Recovery phrase and account private key" icon="shield" onPress={onSecurity} last /></Card>}
    {onAutoLock && <Card><Row title="Auto-lock" subtitle="Foreground inactivity" icon="lock" onPress={onAutoLock} last /></Card>}
    {activityReset && <Card><Row title="Reset activity" subtitle="Clear local activity and nonce data" icon="activity" onPress={() => setOpened({ leaf: 'activity', scope: activityReset.scope })} last /></Card>}
    {watchOnly && <Notice title="Watch-only account" body="This account contains a public address, not its private key or recovery phrase. Keep backups in the wallet that controls it." />}
    <Notice title="Device privacy" body="Pali hides and locks the current session when the app leaves the foreground. Public blockchain activity remains public." />
    <Card>
      <Row title="Display currency" subtitle="Estimated wallet values" icon="globe" onPress={() => setOpened({ leaf: 'currency' })} />
      <Row title="Help & about" subtitle="Support, documentation and version" icon="info" onPress={() => setOpened({ leaf: 'about' })} last />
    </Card>
    <Button title={watchOnly ? 'Hide accounts' : 'Lock wallet'} icon="lock" variant="secondary" onPress={onLock} />
  </Screen></SafeAreaView>;
}
