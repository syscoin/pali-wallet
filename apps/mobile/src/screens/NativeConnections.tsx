import { useNativeTranslation } from '../platform/localization';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import type { NativeConnectionError, NativeConnectionsView, NativeConnectionsSnapshot } from '../connections/types';
import { Button, Card, colors, Header, Icon, IconButton, Notice, Screen, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';
import { DappSiteStatus } from './DappSiteStatus';
import { ConnectionQrScanner } from './ConnectionQrScanner';
import type { NativePairingEntry } from '../connections/pairingLinks';

const appInitial = (name: string) => Array.from(name.trim())[0]?.toUpperCase() || '•';

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

/** Presentation groups only; the controller owns the methods actually granted. */
function permissionRows(methods: readonly string[]) {
  const groups = new Set<string>(['viewAddress']);
  for (const method of methods) {
    if (['eth_accounts', 'eth_requestAccounts', 'sys_requestAccounts'].includes(method)) continue;
    if (['eth_sendTransaction', 'wallet_sendCalls', 'sys_sign', 'sys_signAndSend'].includes(method)) groups.add('requestTransactions');
    else if (/^(personal_sign|eth_signTypedData(?:_v[34])?|sys_signSentryOperation|sys_signSentryVote)$/.test(method)) groups.add('requestSignatures');
    else if (['eth_getEncryptionPublicKey', 'eth_decrypt'].includes(method)) groups.add('requestEncryption');
    else if (['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_watchAsset', 'sys_switchChain', 'eth_changeUTXOEVM', 'sys_changeUTXOEVM'].includes(method)) groups.add('requestNetwork');
    else if (['wallet_prepareSmartAccount', 'wallet_requestSmartAccountModuleInstall', 'wallet_requestSmartAccountModuleUninstall', 'wallet_requestPermissions', 'wallet_revokePermissions', 'sys_linkSentryNode'].includes(method)) groups.add('requestAccount');
    else if (/^(eth_get|eth_(blockNumber|gasPrice|protocolVersion|syncing|call|estimateGas|coinbase|hashrate|mining|new|uninstall)|net_|web3_|personal_ecRecover|sys_(get|is|transaction)|wallet_(get|showCallsStatus))/.test(method)) groups.add('readNetwork');
    else groups.add('requestOther');
  }
  return Array.from(groups).map(key => ({ key, icon: key === 'viewAddress' || key === 'readNetwork' ? 'eye' : key === 'requestTransactions' ? 'arrow-up-right' : key === 'requestNetwork' ? 'globe' : key === 'requestAccount' ? 'wallet' : key === 'requestEncryption' ? 'lock' : 'edit' }));
}

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
        <Card style={{ padding: 16, gap: 12 }}>
          <Text>{label}</Text>
          <Text>{t('mobile.connections.chain', { chainId: BigInt(status.chainId).toString() })}</Text>
          <Text>{status.atomic ? t('mobile.connections.atomic') : t('mobile.connections.sequential')}</Text>
          <Text selectable>{status.id}</Text>
        </Card>
        {status.receipts?.map((receipt) => (
          <Card key={receipt.transactionHash} style={{ padding: 16, gap: 12 }}>
            <Text>
              {receipt.status === '0x1'
                ? t('mobile.connections.transactionConfirmed')
                : t('mobile.connections.transactionReverted')}
            </Text>
            <Text selectable>{receipt.transactionHash}</Text>
            <Text>{t('mobile.connections.block', { blockNumber: BigInt(receipt.blockNumber).toString() })}</Text>
          </Card>
        ))}
        <Button title={t('buttons.close')} variant="secondary" size="compact" onPress={close} />
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
  const [sessionSelection, setSessionSelection] = useState<{ controller: NativeConnectionsView; id: string } | null>(null);
  const [scopeDetails, setScopeDetails] = useState<object | null>(null);
  const [clockRevision, setClockRevision] = useState(0);
  const handledEntry = useRef<string | null>(null);
  const lifetime = useRef({ active: true, revision: 0 });
  const proposal = snapshot.proposals[0];
  const busy = snapshot.status === 'pairing' || snapshot.status === 'approving';
  const selectedAccountId = selection?.controller === controller && snapshot.accounts.some((account) => account.id === selection.accountId)
    ? selection.accountId : snapshot.selectedAccountId;
  const selectedSession = !proposal && sessionSelection?.controller === controller && snapshot.sessions.find(session => session.id === sessionSelection.id);
  const deadline = proposal ? proposal.expiresAt : snapshot.status === 'pairing' ? snapshot.pairingExpiresAt : null;
  // eslint-disable-next-line react-hooks/purity -- Display the host's live public deadline; the controller remains the expiry authority.
  const remainingSeconds = deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const expired = remainingSeconds === 0;
  const countdown = remainingSeconds === null ? null : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;

  useEffect(() => {
    if (deadline === null || deadline <= Date.now()) return;
    const timer = setTimeout(() => setClockRevision(value => value + 1), Math.min(1000, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline, clockRevision]);

  useEffect(() => {
    if (!selectedSession) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSessionSelection(null);
      return true;
    });
    return () => subscription.remove();
  }, [selectedSession]);

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

  const renderPermissions = (methods: readonly string[], owner: object) => <Card style={s.permissionCard}>
    <Text style={s.cardTitle}>{t('mobile.connections.thisAppCan')}</Text>
    {permissionRows(methods).map(({ key, icon }) => <View key={key} style={s.permissionRow}>
      <Icon name={icon} color={colors.blue} size={19} />
      <Text style={s.permissionText}>{t(`mobile.connections.${key}`)}</Text>
    </View>)}
    {methods.length > 0 && <>
      <IdlePressable accessibilityRole="button" accessibilityLabel={t('send.details')}
        accessibilityState={{ expanded: scopeDetails === owner }} onPress={() => setScopeDetails(scopeDetails === owner ? null : owner)} style={s.scopeToggle}>
        <Text style={s.scopeLabel}>{t('send.details')}</Text>
        <Icon name={scopeDetails === owner ? 'chevron-up' : 'chevron-down'} color={colors.blue} size={18} />
      </IdlePressable>
      {scopeDetails === owner && methods.map(method => <Text key={method} style={s.method}>{method}</Text>)}
    </>}
  </Card>;

  if (selectedSession) {
    const current = () => lifetime.current.active && controller.getSnapshot().sessions.some(session => session === selectedSession);
    return <SafeAreaView edges={['top']} style={s.container}><Screen gap={16} scrollResetKey={`session:${selectedSession.id}`} footer={<Button
      title={t('mobile.connections.disconnectAction')} icon="close" variant="secondary"
      onPress={() => { if (current()) invoke(() => controller.disconnect(selectedSession.id)); }} />}>
      <Header title={t('mobile.connections.connectedApp')} onBack={() => setSessionSelection(null)} />
      <View style={s.hero}>
        <View style={s.appIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={s.appInitial}>{appInitial(selectedSession.name)}</Text></View>
        <Text accessibilityRole="header" style={s.heroTitle}>{selectedSession.name}</Text>
        <Text selectable style={s.heroOrigin}>{selectedSession.origin}</Text>
        <Text style={s.connected}>{t('mobile.connections.connected')}</Text>
      </View>
      <Card style={s.facts}>
        <View style={s.fact}><Text style={s.factLabel}>{t('mobile.connections.connectionNetwork')}</Text><Text style={s.factValue}>{selectedSession.networkLabel}</Text></View>
        <View style={[s.fact, s.factBorder]}><Text style={s.factLabel}>{t('mobile.connections.connectionAccount')}</Text><View style={s.factContent}><Text style={s.factValue}>{selectedSession.accountLabel}</Text>{selectedSession.address !== null && <Text selectable accessibilityLabel={selectedSession.address} numberOfLines={1} ellipsizeMode="middle" style={s.address}>{selectedSession.address}</Text>}</View></View>
        <View style={[s.fact, s.factBorder]}><Text style={s.factLabel}>{t('settings.permissions')}</Text><View style={s.factContent}>{permissionRows(selectedSession.methods).map(({ key }) => <Text key={key} style={s.factValue}>{t(`mobile.connections.${key}`)}</Text>)}</View></View>
        <View style={[s.fact, s.factBorder]}><Text style={s.factLabel}>{t('mobile.connections.expires')}</Text><Text style={s.factValue}>{new Date(selectedSession.expiresAt).toLocaleString()}</Text></View>
      </Card>
      {selectedSession.returnTarget && <Button title={t('mobile.connections.openWebsite')} icon="external" variant="secondary" size="compact"
        onPress={() => { if (current()) invoke(() => controller.returnToDapp(selectedSession.id, snapshot.revision)); }} />}
    </Screen></SafeAreaView>;
  }

  if (scanning && snapshot.status === 'ready') return <ConnectionQrScanner
    onClose={finishScan} onScan={(uri) => {
      if (!lifetime.current.active || controller.getSnapshot().status !== 'ready') return;
      finishScan();
      setEntryExpired(false);
      invoke(() => controller.pair(uri));
    }} />;

  return <SafeAreaView edges={['top']} style={s.container}><Screen gap={14} scrollResetKey={proposal ? `proposal:${proposal.id}` : 'connections'} footer={proposal ? <View style={s.actions}>
    <Button title={t('buttons.reject')} variant="secondary" style={s.action} onPress={() => invoke(() => controller.reject(proposal.id))} />
    <Button title={snapshot.status === 'approving' ? t('mobile.connections.connecting') : t('buttons.connect')}
      style={s.action} disabled={busy || expired || !proposal.canApprove || !selectedAccountId || !snapshot.network}
      onPress={() => {
        if (selectedAccountId && snapshot.network && !expired) invoke(() => controller.approve(proposal.id, selectedAccountId, snapshot.network!.id, snapshot.revision));
      }} />
  </View> : undefined}>
    <Header title={proposal ? t('connections.connectRequest') : t('mobile.connections.title')} onBack={close} />
    {snapshot.status === 'locked' ? <Notice title={t('mobile.connections.unlockTitle')} body={t('mobile.connections.unlockBody')} /> : <>
      {proposal ? <>
        <View style={s.hero}>
          <View style={s.appIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={s.appInitial}>{appInitial(proposal.name)}</Text></View>
          <Text accessibilityRole="header" style={s.heroTitle}>{proposal.name}</Text>
          <Text selectable accessibilityLabel={`${t('mobile.connections.reportedWebsite')}: ${proposal.origin}`} style={s.heroOrigin}>{proposal.origin}</Text>
          {countdown !== null && <View style={s.countdown}><Icon name="clock" size={16} color={colors.muted} /><Text style={s.caption}>{t('mobile.connections.requestExpires', { time: countdown })}</Text></View>}
        </View>
        <Card style={s.verification}><DappSiteStatus verification={proposal.verification} /></Card>
        {snapshot.network && <Card style={s.facts}><View style={s.fact}><View style={s.inlineLabel}><Icon name="globe" size={18} color={colors.blue} /><Text style={s.factLabel}>{t('mobile.connections.connectionNetwork')}</Text></View><Text style={s.factValue}>{snapshot.network.label}</Text></View></Card>}
        <Text style={s.cardTitle}>{t('mobile.connections.account')}</Text>
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
        {renderPermissions(proposal.methodsByAccount.find(account => account.accountId === selectedAccountId)?.methods ?? [], proposal)}
        {!proposal.canApprove && proposal.verification.validation !== 'INVALID' && !proposal.verification.isScam && <Notice title={t('mobile.connections.unsupportedTitle')} body={t('mobile.connections.unsupportedBody')} />}
      </> : <Card style={s.card}>
        <View style={s.connectHeading}><Icon name={busy ? 'clock' : 'scan'} size={23} color={colors.blue} />
        <Text style={s.title}>{busy ? t('mobile.connections.waiting') : t('mobile.connections.connectWalletConnect')}</Text></View>
        <Text style={s.body}>{busy ? t('mobile.connections.reviewArrival') : t('mobile.connections.scanOrPaste')}</Text>
        {busy && snapshot.network && <View style={s.fact}><Text style={s.factLabel}>{t('mobile.connections.connectionNetwork')}</Text><Text style={s.factValue}>{snapshot.network.label}</Text></View>}
        {countdown !== null && <View style={s.countdown}><Icon name="clock" size={17} color={colors.muted} /><Text style={s.caption}>{t('mobile.connections.requestExpires', { time: countdown })}</Text></View>}
        {busy ? <><ActivityIndicator color={colors.blue} accessibilityLabel={t('mobile.connections.waitingRequest')} />
          <Button title={t('buttons.cancel')} variant="secondary" size="compact" onPress={() => controller.cancel()} /></>
          : snapshot.status === 'unavailable'
          ? <Button title={t('mobile.connections.tryAgain')} onPress={() => invoke(() => controller.retry())} />
          : <><Button title={t('mobile.connections.scan')} icon="scan" disabled={!snapshot.network}
            onPress={() => { lifetime.current.revision++; onScanStarted?.(); setScanning(true); }} />
            <Button title={t('mobile.connections.paste')} icon="copy" variant="secondary" size="compact" disabled={!snapshot.network} onPress={paste} /></>}
      </Card>}
      {(snapshot.error || clipboardError) && <Notice title={t('mobile.connections.unavailableTitle')}
        body={snapshot.error ? t(ERRORS[snapshot.error]) : t('mobile.connections.clipboard')} />}
      {entryExpired && <Notice title={t('mobile.connections.linkExpiredTitle')} body={t('mobile.connections.linkExpired')} />}
      {snapshot.status === 'ready' && !snapshot.network && <Notice title={t('mobile.connections.chooseNetwork')}
        body={t('mobile.connections.chooseNetworkBody')} />}
    </>}
    {!proposal && <View style={s.sessions}>
      <Text accessibilityRole="header" style={s.sectionTitle}>{t('mobile.connections.activeConnections')}</Text>
      {snapshot.status === 'locked' ? <Text style={s.body}>{t('mobile.connections.unlockBody')}</Text> : snapshot.sessions.length === 0 ? <Card style={s.empty}>
        <Icon name="globe" color={colors.muted} size={24} /><Text style={s.body}>{t('mobile.connections.noActiveConnections')}</Text>
      </Card> : <Card style={s.sessionCard}>{snapshot.sessions.map((session, index) => <View key={session.id} style={[s.sessionRow, index > 0 && s.factBorder]}>
        <IdlePressable accessibilityRole="button" accessibilityLabel={`${session.name}, ${session.origin}, ${session.accountLabel}, ${session.networkLabel}`}
          style={s.sessionOpen} onPress={() => { if (lifetime.current.active && controller.getSnapshot().sessions.includes(session)) setSessionSelection({ controller, id: session.id }); }}>
          <View style={s.sessionIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={s.sessionInitial}>{appInitial(session.name)}</Text></View>
          <View style={s.sessionText}><Text style={s.accountLabel}>{session.name}</Text><Text numberOfLines={1} ellipsizeMode="middle" style={s.caption}>{session.origin}</Text><Text style={s.caption}>{session.accountLabel} · {session.networkLabel}</Text></View>
          <Icon name="chevron-right" color={colors.muted} size={18} />
        </IdlePressable>
        <IconButton label={t('mobile.connections.disconnect', { name: session.name })} icon="close"
          onPress={() => { if (lifetime.current.active && controller.getSnapshot().sessions.includes(session)) invoke(() => controller.disconnect(session.id)); }} />
      </View>)}</Card>}
    </View>}
  </Screen></SafeAreaView>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: { gap: 12, padding: 16 },
  connectHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 18, lineHeight: 25, fontWeight: '600' },
  hero: { alignItems: 'center', gap: 9, paddingVertical: 12 },
  appIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pink },
  heroTitle: { fontSize: 24, lineHeight: 31, fontWeight: '700', textAlign: 'center' },
  heroOrigin: { fontSize: 14, lineHeight: 21, color: colors.muted, textAlign: 'center' },
  connected: { fontSize: 15, lineHeight: 22, color: colors.green },
  countdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  caption: { fontSize: 13, lineHeight: 19, color: colors.muted },
  body: { fontSize: 14, lineHeight: 21, color: colors.muted },
  permissionCard: { padding: 14, gap: 11 },
  cardTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  permissionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  permissionText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.muted },
  scopeToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scopeLabel: { fontSize: 13, color: colors.blue },
  method: { fontSize: 12, lineHeight: 18, color: colors.muted },
  facts: { padding: 0, overflow: 'hidden' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 49 },
  factBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  factLabel: { fontSize: 13, lineHeight: 19, color: colors.muted },
  factValue: { flex: 1, textAlign: 'right', fontSize: 13, lineHeight: 19 },
  factContent: { flex: 1, minWidth: 0, gap: 4, alignItems: 'stretch' },
  inlineLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verification: { padding: 14, gap: 6 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
  accounts: { gap: 8 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14 },
  accountText: { flex: 1, minWidth: 0, gap: 3 },
  accountLabel: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  address: { fontSize: 12, lineHeight: 18, color: colors.muted },
  selected: { borderColor: colors.blue, backgroundColor: colors.raised },
  pressed: { opacity: 0.7 },
  sessions: { gap: 12 },
  empty: { padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sessionCard: { padding: 0, overflow: 'hidden' },
  sessionRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 5 },
  sessionOpen: { flex: 1, minWidth: 0, minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  sessionIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  appInitial: { fontSize: 24, fontWeight: '600', color: colors.bg },
  sessionInitial: { fontSize: 19, fontWeight: '600', color: colors.blue },
  sessionText: { flex: 1, minWidth: 0, gap: 3 },
  sectionTitle: { fontSize: 18, lineHeight: 25, fontWeight: '600' },
});
