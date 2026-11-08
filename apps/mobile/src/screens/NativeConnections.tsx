import React, { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import type { NativeConnectionError, NativeConnectionsView } from '../connections/types';
import { Button, Card, colors, Header, Icon, Notice, Screen, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';
import { DappSiteStatus } from './DappSiteStatus';

const ERRORS: Record<NativeConnectionError, string> = {
  INVALID_LINK: 'Copy a WalletConnect link from the app you want to connect to.',
  REQUEST_EXPIRED: 'This connection request expired. Request a new connection from the app.',
  CONTEXT_CHANGED: 'Your wallet context changed. Review the connection again.',
  UNSUPPORTED_REQUEST: 'This app requested an action that is unavailable for this connection.',
  CONNECTION_UNAVAILABLE: 'The connection service is unavailable. Try again.',
  BUSY: 'Finish the current connection request first.',
  BLOCKED_SITE: 'This website is on a known phishing list. The connection was blocked.',
  SITE_MISMATCH: 'The requesting website does not match the app’s claimed address. The connection was blocked.',
  DELIVERY_UNCERTAIN: 'The signature was handed to WalletConnect, but delivery could not be confirmed. Check the requesting app before trying again.',
};

/** Receives public state only. Transport keys and signing handles stay in custody. */
export function NativeConnections({ controller, onBack }: {
  controller: NativeConnectionsView;
  onBack(): void;
}) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const snapshot = useSyncExternalStore(subscribe, controller.getSnapshot, controller.getSnapshot);
  const [selection, setSelection] = useState<{ controller: NativeConnectionsView; accountId: string } | null>(null);
  const [clipboardError, setClipboardError] = useState(false);
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

  const close = () => { lifetime.current.revision++; controller.cancel(); onBack(); };
  const paste = async () => {
    if (busy) return;
    const current = lifetime.current;
    const revision = current.revision;
    setClipboardError(false);
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

  return <SafeAreaView edges={['top']} style={s.container}><Screen>
    <Header title="Connected apps" onBack={close} />
    {snapshot.status === 'locked' ? <Notice title="Unlock to connect" body="Unlock your wallet to manage app connections." /> : <>
      {proposal ? <Card style={s.card}>
        <View style={s.requestIcon}><Icon name="globe" size={26} color={colors.blue} /></View>
        <Text accessibilityRole="header" style={s.title}>Connect to {proposal.name}</Text>
        <Text style={s.label}>Reported website</Text>
        <Text selectable style={s.origin}>{proposal.origin}</Text>
        <DappSiteStatus verification={proposal.verification} />
        <Text style={s.body}>Share the selected account with this app.</Text>
        {snapshot.network && <Text style={s.network}>{snapshot.network.label} · Chain ID {snapshot.network.chainId}</Text>}
        <View accessibilityRole="radiogroup" accessibilityLabel="Connection account" style={s.accounts}>
          {snapshot.accounts.map((account) => <IdlePressable key={account.id} accessibilityRole="radio"
            accessibilityLabel={`${account.label}, ${account.address}`} accessibilityState={{ checked: account.id === selectedAccountId, disabled: busy }}
            disabled={busy} onPress={() => setSelection({ controller, accountId: account.id })}
            style={({ pressed }) => [s.account, account.id === selectedAccountId && s.selected, pressed && s.pressed]}>
            <View style={s.accountText}><Text style={s.accountLabel}>{account.label}</Text>
              <Text numberOfLines={1} ellipsizeMode="middle" style={s.address}>{account.address}</Text></View>
            {account.id === selectedAccountId && <Icon name="check" color={colors.blue} size={20} />}
          </IdlePressable>)}
        </View>
        {!proposal.canApprove && proposal.verification.validation !== 'INVALID' && !proposal.verification.isScam && <Notice title="Unsupported request" body="This app requested actions that are unavailable for this connection." />}
        <Button title={snapshot.status === 'approving' ? 'Connecting…' : 'Connect'}
          disabled={busy || !proposal.canApprove || !selectedAccountId || !snapshot.network}
          onPress={() => {
            if (selectedAccountId && snapshot.network) invoke(() => controller.approve(proposal.id, selectedAccountId, snapshot.network!.id, snapshot.revision));
          }} />
        <Button title="Reject" variant="quiet" onPress={() => invoke(() => controller.reject(proposal.id))} />
      </Card> : <Card style={s.card}>
        <View style={s.requestIcon}><Icon name="globe" size={26} color={colors.blue} /></View>
        <Text style={s.title}>{busy ? 'Waiting for the app' : 'Connect with WalletConnect'}</Text>
        <Text style={s.body}>{busy ? 'Review the connection request when it arrives.' : 'Copy a connection link from an app, then paste it here.'}</Text>
        {busy ? <><ActivityIndicator color={colors.blue} accessibilityLabel="Waiting for a connection request" />
          <Button title="Cancel" variant="secondary" onPress={() => controller.cancel()} /></>
          : snapshot.status === 'unavailable'
          ? <Button title="Try again" onPress={() => invoke(() => controller.retry())} />
          : <Button title="Paste connection link" icon="copy" disabled={!snapshot.network} onPress={paste} />}
      </Card>}
      {(snapshot.error || clipboardError) && <Notice title="Connection unavailable"
        body={snapshot.error ? ERRORS[snapshot.error] : 'The clipboard could not be read. Copy the connection link and try again.'} />}
      {snapshot.status === 'ready' && !snapshot.network && <Notice title="Choose a network"
        body="Select an EVM network in Wallet to connect to an app." />}
      {snapshot.sessions.length > 0 && <View style={s.sessions}>
        <Text accessibilityRole="header" style={s.sectionTitle}>Your connections</Text>
        {snapshot.sessions.map((session) => <Card key={session.id} style={s.card}>
          <Text style={s.accountLabel}>{session.name}</Text>
          <Text selectable style={s.origin}>{session.origin}</Text>
          <Text style={s.body}>{session.accountLabel} · {session.networkLabel}</Text>
          <Button title={`Disconnect ${session.name}`} variant="quiet" onPress={() => invoke(() => controller.disconnect(session.id))} />
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
