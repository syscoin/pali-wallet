import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNativeTranslation } from '../platform/localization';
import type { NativeSlhDsaManagement } from '../smartAccount/slhDsaManagement';
import type { NativeSlhPublicState } from '../smartAccount/slhDsaRuntime';
import type { NativeSmartAccountOperation } from '../smartAccount/operation';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { NativeSmartAccountOperationScreen } from './NativeSmartAccountOperation';

type Props = { ledgerConnection?: NativeLedgerConnectionView; open(signal: AbortSignal, assertCurrent: () => void): Promise<NativeSlhDsaManagement>; onBack(): void };
type Snapshot = { prepared: readonly NativeSlhPublicState[]; installed: readonly { keyId: string; state: NativeSlhPublicState | null }[] };
type Owner = { live: boolean; busy: boolean; abort: AbortController; work?: Promise<void>; closing?: Promise<void>; manager?: NativeSlhDsaManagement; operation?: NativeSmartAccountOperation };
function retire(owner: Owner) {
  owner.live = false; owner.abort.abort();
  owner.closing ??= Promise.allSettled([owner.work, owner.operation?.dispose()]).then(() => undefined);
  return owner.closing;
}

/** Local setup and status; the existing operation screen owns on-chain consent. */
export function NativeSlhDsaManagementScreen({ open, onBack, ledgerConnection }: Props) {
  const { t } = useNativeTranslation();
  const selected = useRef<Owner | undefined>(undefined), mounted = useRef(false), callbacks = useRef({ onBack });
  const [epoch, setEpoch] = useState(0), [manager, setManager] = useState<NativeSlhDsaManagement>(), [snapshot, setSnapshot] = useState<Snapshot>();
  const [operation, setOperation] = useState<NativeSmartAccountOperation>(), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<number | null>(null), [closing, setClosing] = useState(false);
  useLayoutEffect(() => { callbacks.current = { onBack }; }, [onBack]);
  const current = useCallback((owner: Owner) => mounted.current && selected.current === owner && owner.live && !owner.abort.signal.aborted && AppState.currentState === 'active', []);
  const check = useCallback((owner: Owner) => { if (!current(owner)) throw Error('CANCELLED'); }, [current]);
  const back = useCallback((owner: Owner) => {
    if (!mounted.current || selected.current !== owner || !owner.live) return;
    setClosing(true);
    void retire(owner).then(() => { if (mounted.current && selected.current === owner) callbacks.current.onBack(); });
  }, []);
  const load = useCallback(async (owner: Owner) => {
    check(owner);
    const value = owner.manager!;
    const prepared = await value.readPrepared(); check(owner);
    const installed: Snapshot['installed'][number][] = [];
    for (const key of value.installedKeys) {
      try { const state = await value.hydrateInstalled(key.keyId); check(owner); installed.push({ keyId: key.keyId, state }); }
      catch { check(owner); installed.push({ keyId: key.keyId, state: null }); }
    }
    check(owner); setSnapshot({ prepared, installed });
  }, [check]);
  const run = useCallback((owner: Owner, task: () => Promise<void>) => {
    if (!current(owner) || owner.busy) return;
    owner.busy = true; setBusy(true); setFailed(false);
    const work = Promise.resolve().then(() => { check(owner); return task(); }).catch(() => {
      if (current(owner)) setFailed(true);
    }).finally(() => { owner.busy = false; if (current(owner)) { setBusy(false); setProgress(null); } });
    owner.work = work;
  }, [check, current]);
  useEffect(() => {
    mounted.current = true;
    const owner: Owner = { live: true, busy: false, abort: new AbortController() };
    selected.current = owner;
    void Promise.resolve().then(() => run(owner, async () => {
      setManager(undefined); setSnapshot(undefined); setOperation(undefined); setClosing(false); setFailed(false);
      const value = await open(owner.abort.signal, () => check(owner)); check(owner);
      owner.manager = value; setManager(value); await load(owner);
    }));
    const change = AppState.addEventListener('change', state => { if (state !== 'active') back(owner); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => back(owner)) : undefined;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => { back(owner); return true; });
    return () => { mounted.current = false; void retire(owner); change.remove(); blur?.remove(); hardware.remove(); };
  }, [back, check, epoch, load, open, run]);
  const returnToStatus = useCallback((owner: Owner, expected: NativeSmartAccountOperation) => {
    if (!current(owner) || owner.operation !== expected) return;
    setClosing(true);
    void retire(owner).then(() => { if (mounted.current && selected.current === owner) setEpoch(value => value + 1); });
  }, [current]);
  const shownOwner = selected.current;
  const close = () => { if (shownOwner) back(shownOwner); };
  if (operation) return <NativeSmartAccountOperationScreen ledgerConnection={ledgerConnection} controller={operation} onBack={() => { if (shownOwner) returnToStatus(shownOwner, operation); }} />;
  const action = (task: (owner: Owner, manager: NativeSlhDsaManagement) => Promise<void>) => {
    const owner = shownOwner, capturedManager = manager;
    if (!owner || !capturedManager || !current(owner) || owner.manager !== capturedManager) return;
    run(owner, () => {
      check(owner);
      if (owner.manager !== capturedManager) throw Error('CANCELLED');
      return task(owner, capturedManager);
    });
  };
  const reportProgress = (owner: Owner) => (value: { completed: number; total: number }) => { check(owner); setProgress(Math.floor(value.completed * 100 / value.total)); };
  const install = (keyId: string) => action(async (owner, value) => {
    const next = await value.openInstall(keyId, owner.abort.signal, () => check(owner));
    try { check(owner); owner.operation = next; setOperation(next); }
    catch (error) { await next.dispose(); throw error; }
  });
  const keyCard = (keyId: string, state: NativeSlhPublicState | null, installed: boolean) => <Card key={keyId} style={s.card}>
    <Text>{t(installed ? 'settings.installed' : 'settings.smartAccountInfrastructureReadyStatus')}</Text>
    <Text selectable style={s.key}>{state?.pkRoot ?? keyId}</Text>
    {state && <Text accessibilityLabel={`SLH-DSA ${state.signatureCount} / ${state.signatureLimit}`}>SLH-DSA · {state.signatureCount} / {state.signatureLimit}</Text>}
    {!state && <Text>{t('settings.slhDsaLocalSignerMissing')}</Text>}
    {state && <View style={s.actions}>
      <Button title={t('settings.useSmartAccountValidator')} disabled={busy || closing || !manager?.isDeployed} onPress={() => install(keyId)} />
      <Button title={t('settings.slhDsaRegenerateLocalSigner')} variant="secondary" disabled={busy || closing} onPress={() => action(async (owner, value) => {
        if (installed) await value.rebuildInstalled(keyId, reportProgress(owner)); else await value.rebuildPrepared(keyId, reportProgress(owner));
        check(owner); await load(owner);
      })} />
    </View>}
  </Card>;
  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
    <Screen footer={<Button title={t('buttons.close')} variant="secondary" disabled={closing} onPress={close} />}>
      <Header title={t('settings.slhDsaAuthenticator')} onBack={close} />
      {manager && <Card style={s.card}><Text>{manager.networkName}</Text><Text selectable style={s.key}>{manager.accountAddress}</Text><Text>{t('settings.slhDsaModuleHint')}</Text>{!manager.isDeployed && <Text>{t('settings.smartAccountUndeployedNotice')}</Text>}</Card>}
      {closing ? <ActivityIndicator accessibilityLabel={t('buttons.close')} color={colors.pink} /> : <>
        {failed && <Notice title={t('settings.unavailable')} body={t('settings.smartAccountAuthenticatorUpdateFailed')} />}
        {progress !== null && <Card style={s.card}><Text>{t('settings.slhDsaSetupInProgress')}</Text><Text>{progress}%</Text></Card>}
        {busy && <ActivityIndicator accessibilityLabel={t('settings.slhDsaSetupInProgress')} color={colors.pink} />}
        {snapshot?.installed.map(key => keyCard(key.keyId, key.state, true))}
        {snapshot?.prepared.map(key => keyCard(key.keyId, key, false))}
        {snapshot && !snapshot.installed.length && !snapshot.prepared.length && <Button title={t('buttons.create')} disabled={busy} onPress={() => action(async (owner, value) => {
          await value.prepareFresh(reportProgress(owner)); check(owner); await load(owner);
        })} />}
        {manager && <Button title={t('settings.smartAccountInfrastructureCheckStatus')} variant="secondary" disabled={busy} onPress={() => action(owner => load(owner))} />}
      </>}
    </Screen>
  </SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, card: { padding: 16, gap: 12 }, key: { fontFamily: 'monospace', fontSize: 12, color: colors.muted }, actions: { gap: 8 } });
