import { useNativeTranslation } from '../platform/localization';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, colors, Header, Notice, Row, Screen, Text } from '../ui';
import type { ShellLeafNavigation } from './RealAppShell';
import { TrustedSiteLookup } from './TrustedSiteLookup';
import { WatchGuardianRecovery, type WatchGuardianRecoveryTool } from './WatchGuardianRecovery';
import type { NativePairingEntry } from '../connections/pairingLinks';
import type { NativeConnectionsView } from '../connections/types';
import { NativeConnections } from './NativeConnections';

export function RealTools({ accountLabel, networkLabel, watchOnly, onAccounts, onNetworks, onPrivateNotes, onSentryKeys, onBack, navigation, guardianRecovery, onGuardianClose, initialGuardianScope, onGuardianOpened, connections, incomingPairing, onPairingHandled, initialScan, onScanStarted, onScanFinished }: {
  accountLabel: string; networkLabel: string; watchOnly: boolean; onAccounts(): void; onNetworks?: () => void; onPrivateNotes?: () => void; onSentryKeys?: () => void; onBack(): void;
  navigation: ShellLeafNavigation; guardianRecovery?: WatchGuardianRecoveryTool; onGuardianClose?(): void;
  initialGuardianScope?: string | null; onGuardianOpened?(): void;
  connections?: NativeConnectionsView;
  incomingPairing?: NativePairingEntry | null; onPairingHandled?(id: string): void;
  initialScan?: boolean; onScanStarted?(): void; onScanFinished?(): void;
}) {
  const { t } = useNativeTranslation();
  const [pane, setPane] = useState<{ kind: 'lookup' | 'connections' } | { kind: 'guardian'; scope: string; lifetime: AbortController; resumeRecovery?: true } | null>(() => initialGuardianScope && initialGuardianScope === guardianRecovery?.scope ? { kind: 'guardian', scope: initialGuardianScope, lifetime: new AbortController(), resumeRecovery: true } : null);
  const guardianBack = useRef<(() => void) | null>(null);
  const registerGuardianBack = useCallback((handler: () => void) => { guardianBack.current = handler; return () => { if (guardianBack.current === handler) guardianBack.current = null; }; }, []);
  const lookup = pane?.kind === 'lookup';
  const guardian = pane?.kind === 'guardian' && pane.scope === guardianRecovery?.scope ? pane : undefined;
  const connectedApps = pane?.kind === 'connections' && !!connections;
  const immersive = lookup || !!guardian || connectedApps;
  const closePane = useCallback(() => { if (pane?.kind === 'guardian') { pane.lifetime.abort(); onGuardianClose?.(); } if (pane?.kind === 'connections') onScanFinished?.(); setPane(null); }, [pane, onScanFinished, onGuardianClose]);
  useLayoutEffect(() => {
    if (!initialGuardianScope || pane?.kind !== 'guardian' || pane.scope !== initialGuardianScope) return;
    onGuardianOpened?.();
  }, [initialGuardianScope, guardianRecovery?.scope, pane, onGuardianOpened]);
  useLayoutEffect(() => navigation.registerBack(() => {
    if (guardian && guardianBack.current) guardianBack.current(); else if (immersive) closePane(); else onBack();
    return true;
  }), [closePane, guardian, immersive, navigation, onBack]);
  useLayoutEffect(() => {
    navigation.setImmersive(immersive);
    return () => navigation.setImmersive(false);
  }, [immersive, navigation]);
  if (lookup) return <TrustedSiteLookup onBack={closePane} />;
  if (connectedApps && connections) return <NativeConnections controller={connections} incomingPairing={incomingPairing} onPairingHandled={onPairingHandled}
    initialScan={initialScan} onScanStarted={onScanStarted} onScanFinished={onScanFinished} onBack={closePane} />;
  if (guardian && guardianRecovery) return <WatchGuardianRecovery key={guardian.scope} address={guardianRecovery.address}
    networkLabel={networkLabel} onBack={closePane} registerBack={registerGuardianBack} lifetime={guardian.lifetime.signal} read={guardianRecovery.read} manage={guardianRecovery.manage} recovery={guardianRecovery.recovery} initialRecovery={guardian.resumeRecovery} />;
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title={t('mobile.tools.title')} subtitle={`${accountLabel} · ${networkLabel}`} onBack={onBack} />
    <Card><Row title={t('mobile.accounts.title')} subtitle={watchOnly ? t('mobile.tools.watchAccounts') : t('mobile.tools.walletAccounts')} icon="wallet" onPress={onAccounts} />
      {onNetworks && <Row title={t('mobile.tools.network')} subtitle={t('mobile.tools.chooseNetwork')} icon="globe" onPress={onNetworks} />}
      {connections && <Row title={t('mobile.tools.connections')} subtitle={t('mobile.tools.connectionsBody')} icon="globe" onPress={() => setPane({ kind: 'connections' })} />}
      <Row title={t('mobile.tools.checkSite')} subtitle={t('mobile.tools.checkSiteBody')} icon="shield" onPress={() => setPane({ kind: 'lookup' })} last={!onPrivateNotes && !guardianRecovery && watchOnly} />
      {guardianRecovery && <Row title={t('mobile.tools.guardian')} subtitle={t('mobile.tools.guardianBody')} icon="shield" onPress={() =>
        setPane({ kind: 'guardian', scope: guardianRecovery.scope, lifetime: new AbortController() })
      } last={!onPrivateNotes && watchOnly} />}
      {onPrivateNotes && <Row title={t('mobile.tools.notes')} subtitle={t('mobile.tools.notesBody')} icon="lock" onPress={onPrivateNotes} last={watchOnly} /> }
      {!watchOnly && <Row title={t('mobile.tools.sentry')} subtitle={onSentryKeys ? t('mobile.tools.sentryBody') : t('mobile.tools.unavailable')} icon="shield" onPress={onSentryKeys} last />}</Card>
    {watchOnly && <Notice title={t('mobile.tools.publicTitle')} body={t('mobile.tools.publicBody')} />}
    <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>{t('mobile.tools.receiveHint')}</Text>
  </Screen></SafeAreaView>;
}
