import { useNativeTranslation } from '../platform/localization';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import type { NativeConnectionError, NativeConnectionsView, NativeConnectionsSnapshot } from '../connections/types';
import { Button, Card, colors, Header, Icon, Notice, Screen, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';
import { DappSiteStatus } from './DappSiteStatus';
import { ConnectionQrScanner } from './ConnectionQrScanner';
import type { NativePairingEntry } from '../connections/pairingLinks';

const ERRORS: Record<NativeConnectionError, string> = {
  INVALID_LINK: 'mobile.connections.invalidLink',
  REQUEST_EXPIRED: 'mobile.connections.expired',
  CONTEXT_CHANGED: 'mobile.connections.contextChanged',
  UNSUPPORTED_REQUEST: 'mobile.connections.unsupported',
  CONNECTION_UNAVAILABLE: 'mobile.connections.unavailable',
  BUSY: 'mobile.connections.busy',
  BLOCKED_SITE: 'mobile.connections.blocked',
  SITE_MISMATCH: 'mobile.connections.mismatch',
  DELIVERY_UNCERTAIN: 'mobile.connections.deliveryUncertain',
};

export function NativeCallsStatus({
  view,
  controller,
}: {
  view: NonNullable<NativeConnectionsSnapshot['callsStatus']>;
  controller: NativeConnectionsView;
}) {
  const { t } = useNativeTranslation();
  const close = useCallback(
    () => controller.dismissCallsStatus(view.id),
    [controller, view.id]
  );
  useEffect(() => {
    void controller.callsStatusShown(view.id).catch(() => undefined);
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        close();
        return true;
      }
    );
    return () => subscription.remove();
  }, [controller, view.id, close]);
  const status = view.status;
  const label =
    (
      {
        100: t('mobile.connections.pending'),
        200: t('mobile.connections.confirmed'),
        400: t('mobile.connections.notSubmitted'),
        500: t('mobile.connections.reverted'),
        600: t('mobile.connections.partiallyReverted'),
      } as Record<number, string>
    )[status.status] ?? String(status.status);
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={['top', 'bottom']}
    >
      <Screen>
        <Header title={t('mobile.connections.bundleStatus')} onBack={close} />
        <Text>{view.origin}</Text>
        <Card style={{ padding: 20, gap: 12 }}>
          <Text>{label}</Text>
          <Text>{t('mobile.connections.chain', { chainId: BigInt(status.chainId).toString() })}</Text>
          <Text>{status.atomic ? t('mobile.connections.atomic') : t('mobile.connections.sequential')}</Text>
          <Text selectable>{status.id}</Text>
        </Card>
        {status.receipts?.map((receipt) => (
          <Card key={receipt.transactionHash} style={{ padding: 20, gap: 12 }}>
            <Text>
              {receipt.status === '0x1'
                ? t('mobile.connections.transactionConfirmed')
                : t('mobile.connections.transactionReverted')}
            </Text>
            <Text selectable>{receipt.transactionHash}</Text>
            <Text>{t('mobile.connections.block', { blockNumber: BigInt(receipt.blockNumber).toString() })}</Text>
          </Card>
        ))}
        <Button title={t('buttons.close')} variant="quiet" onPress={close} />
      </Screen>
    </SafeAreaView>
  );
}

/** Receives public state only. Transport keys and signing handles stay in custody. */
export function NativeConnections({ controller, onBack, incomingPairing, onPairingHandled, initialScan = false, onScanStarted, onScanFinished }: {
  controller: NativeConnectionsView;
  onBack(): void;
  incomingPairing?: NativePairingEntry | null;
  onPairingHandled?(id: string): void;
  initialScan?: boolean;
  onScanStarted?(): void;
  onScanFinished?(): void;
}) {
  const { t } = useNativeTranslation();
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const snapshot = useSyncExternalStore(subscribe, controller.getSnapshot, controller.getSnapshot);
  const [selection, setSelection] = useState<{ controller: NativeConnectionsView; accountId: string } | null>(null);
  const [clipboardError, setClipboardError] = useState(false);
  const [scanning, setScanning] = useState(initialScan);
  const [entryExpired, setEntryExpired] = useState(false);
  const handledEntry = useRef<string | null>(null);
  const lifetime = useRef({ active: true, revision: 0 });
  const proposal = snapshot.proposals[0];
  const busy = snapshot.status === 'pairing' || snapshot.status === 'approving';
  const selectedAccountId = selection?.controller === controller && snapshot.accounts.some((account) => account.id === selection.accountId)
    ? selection.accountId : snapshot.selectedAccountId;

  useLayoutEffect(() => {
    const current = lifetime.current;
    current.active = true;
    current.revision++;
    return () => {
      current.active = false;
      current.revision++;
      controller.cancel();
    };
  }, [controller]);

  useEffect(() => {
    if (!incomingPairing || !onPairingHandled || handledEntry.current === incomingPairing.id ||
        scanning || snapshot.status !== 'ready' || !snapshot.network || proposal || snapshot.preparationReview || snapshot.signingReview || snapshot.psbtReview) return;
    const current = lifetime.current;
    const revision = ++current.revision;
    let active = true;
    queueMicrotask(() => {
      const latest = controller.getSnapshot();
      if (!active || !current.active || current.revision !== revision || latest.status !== 'ready' ||
          !latest.network || latest.proposals.length || latest.preparationReview || latest.signingReview || latest.psbtReview) return;
      handledEntry.current = incomingPairing.id;
      onPairingHandled(incomingPairing.id);
      const expired = incomingPairing.expiresAt <= Date.now();
      setEntryExpired(expired);
      if (!expired) void controller.pair(incomingPairing.uri).catch(() => undefined);
    });
    return () => { active = false; };
  }, [controller, incomingPairing, onPairingHandled, proposal, scanning, snapshot.preparationReview, snapshot.signingReview, snapshot.psbtReview, snapshot.network, snapshot.status]);

  const close = () => { lifetime.current.revision++; onScanFinished?.(); controller.cancel(); onBack(); };
  const finishScan = () => { setScanning(false); onScanFinished?.(); };
  const paste = async () => {
    if (busy) return;
    const current = lifetime.current;
    const revision = ++current.revision;
    setClipboardError(false);
    setEntryExpired(false);
    let uri: string;
    try {
      uri = await Clipboard.getStringAsync();
    } catch {
      if (current.active && current.revision === revision) setClipboardError(true);
      return;
    }
    if (!current.active || current.revision !== revision) return;
    await controller.pair(uri).catch(() => undefined);
  };
  const invoke = (operation: () => Promise<void>) => { void operation().catch(() => undefined); };

  if (scanning && snapshot.status === 'ready') return <ConnectionQrScanner
    onClose={finishScan} onScan={(uri) => {
      if (!lifetime.current.active || controller.getSnapshot().status !== 'ready') return;
      finishScan();
      setEntryExpired(false);
      invoke(() => controller.pair(uri));
    }} />;

  return <SafeAreaView edges={['top']} style={s.container}><Screen>
    <Header title={t('mobile.connections.title')} onBack={close} />
    {snapshot.status === 'locked' ? <Notice title={t('mobile.connections.unlockTitle')} body={t('mobile.connections.unlockBody')} /> : <>
      {proposal ? <Card style={s.card}>
        <View style={s.requestIcon}><Icon name="globe" size={26} color={colors.blue} /></View>
        <Text accessibilityRole="header" style={s.title}>{t('mobile.connections.connectTo', { name: proposal.name })}</Text>
        <Text style={s.label}>{t('mobile.connections.reportedWebsite')}</Text>
        <Text selectable style={s.origin}>{proposal.origin}</Text>
        <DappSiteStatus verification={proposal.verification} />
        <Text style={s.body}>{t('mobile.connections.shareAccount')}</Text>
        {snapshot.network && <Text style={s.network}>{t('mobile.connections.network', { network: snapshot.network.label, chainId: snapshot.network.chainId })}</Text>}
        <View accessibilityRole="radiogroup" accessibilityLabel={t('mobile.connections.account')} style={s.accounts}>
          {snapshot.accounts.map((account) => <IdlePressable key={account.id} accessibilityRole="radio"
            accessibilityLabel={`${account.label}, ${account.address}`} accessibilityState={{ checked: account.id === selectedAccountId, disabled: busy }}
            disabled={busy} onPress={() => setSelection({ controller, accountId: account.id })}
            style={({ pressed }) => [s.account, account.id === selectedAccountId && s.selected, pressed && s.pressed]}>
            <View style={s.accountText}><Text style={s.accountLabel}>{account.label}</Text>
              <Text numberOfLines={1} ellipsizeMode="middle" style={s.address}>{account.address}</Text></View>
            {account.id === selectedAccountId && <Icon name="check" color={colors.blue} size={20} />}
          </IdlePressable>)}
        </View>
        {!proposal.canApprove && proposal.verification.validation !== 'INVALID' && !proposal.verification.isScam && <Notice title={t('mobile.connections.unsupportedTitle')} body={t('mobile.connections.unsupportedBody')} />}
        <Button title={snapshot.status === 'approving' ? t('mobile.connections.connecting') : t('buttons.connect')}
          disabled={busy || !proposal.canApprove || !selectedAccountId || !snapshot.network}
          onPress={() => {
            if (selectedAccountId && snapshot.network) invoke(() => controller.approve(proposal.id, selectedAccountId, snapshot.network!.id, snapshot.revision));
          }} />
        <Button title={t('buttons.reject')} variant="quiet" onPress={() => invoke(() => controller.reject(proposal.id))} />
      </Card> : <Card style={s.card}>
        <View style={s.requestIcon}><Icon name="globe" size={26} color={colors.blue} /></View>
        <Text style={s.title}>{busy ? t('mobile.connections.waiting') : t('mobile.connections.connectWalletConnect')}</Text>
        <Text style={s.body}>{busy ? t('mobile.connections.reviewArrival') : t('mobile.connections.scanOrPaste')}</Text>
        {busy ? <><ActivityIndicator color={colors.blue} accessibilityLabel={t('mobile.connections.waitingRequest')} />
          <Button title={t('buttons.cancel')} variant="secondary" onPress={() => controller.cancel()} /></>
          : snapshot.status === 'unavailable'
          ? <Button title={t('mobile.connections.tryAgain')} onPress={() => invoke(() => controller.retry())} />
          : <><Button title={t('mobile.connections.scan')} icon="scan" disabled={!snapshot.network}
            onPress={() => { lifetime.current.revision++; onScanStarted?.(); setScanning(true); }} />
            <Button title={t('mobile.connections.paste')} icon="copy" variant="secondary" disabled={!snapshot.network} onPress={paste} /></>}
      </Card>}
      {(snapshot.error || clipboardError) && <Notice title={t('mobile.connections.unavailableTitle')}
        body={snapshot.error ? t(ERRORS[snapshot.error]) : t('mobile.connections.clipboard')} />}
      {entryExpired && <Notice title={t('mobile.connections.linkExpiredTitle')} body={t('mobile.connections.linkExpired')} />}
      {snapshot.status === 'ready' && !snapshot.network && <Notice title={t('mobile.connections.chooseNetwork')}
        body={t('mobile.connections.chooseNetworkBody')} />}
      {snapshot.sessions.length > 0 && <View style={s.sessions}>
        <Text accessibilityRole="header" style={s.sectionTitle}>{t('mobile.connections.yourConnections')}</Text>
        {snapshot.sessions.map((session) => <Card key={session.id} style={s.card}>
          <Text style={s.accountLabel}>{session.name}</Text>
          <Text selectable style={s.origin}>{session.origin}</Text>
          <Text style={s.body}>{session.accountLabel} · {session.networkLabel}</Text>
          {session.returnTarget && <Button title={t('mobile.connections.openWebsite')} variant="secondary" onPress={() => invoke(() => controller.returnToDapp(session.id, snapshot.revision))} />}
          <Button title={t('mobile.connections.disconnect', { name: session.name })} variant="quiet" onPress={() => invoke(() => controller.disconnect(session.id))} />
        </Card>)}
      </View>}
    </>}
  </Screen></SafeAreaView>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: { gap: 14, padding: 20 },
  requestIcon: { width: 54, height: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  title: { fontSize: 22, lineHeight: 29, fontWeight: '700' },
  label: { fontSize: 12, lineHeight: 17, color: colors.muted },
  origin: { fontSize: 16, lineHeight: 23, color: colors.blue },
  body: { fontSize: 14, lineHeight: 21, color: colors.muted },
  network: { fontSize: 14, lineHeight: 21, color: colors.text },
  accounts: { gap: 8 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14 },
  accountText: { flex: 1, minWidth: 0, gap: 3 },
  accountLabel: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  address: { fontSize: 12, lineHeight: 18, color: colors.muted },
  selected: { borderColor: colors.blue, backgroundColor: colors.raised },
  pressed: { opacity: 0.7 },
  sessions: { gap: 12 },
  sectionTitle: { fontSize: 18, lineHeight: 25, fontWeight: '600' },
});
