import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, KeyboardAvoidingView, Platform, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ISmartAccountMetadata, SmartAccountValidatorModule } from '../../../../source/types/network';
import { listCompositeChildCandidates, type CustomValidatorPreflightResult } from '../../../../source/utils/smartAccount/custom';
import { canRemoveValidatorModule } from '../../../../source/utils/smartAccount/moduleCommands';
import { useNativeTranslation } from '../platform/localization';
import type { NativeSmartModuleManagement } from '../smartAccount/moduleManagement';
import type { NativeSmartModuleDraft } from '../smartAccount/modules';
import type { NativeSmartAccountOperation } from '../smartAccount/operation';
import { Button, Card, colors, Header, Icon, Notice, Screen, Text } from '../ui';
import { NativeSendInput } from './NativeSend';
import { NativeSmartAccountOperationScreen } from './NativeSmartAccountOperation';

type Props = { ledgerConnection?: NativeLedgerConnectionView; open(signal: AbortSignal, assertCurrent: () => void): Promise<NativeSmartModuleManagement>; onBack(): void };
type Owner = { live: boolean; busy: boolean; abort: AbortController; work?: Promise<void>; closing?: Promise<void>; manager?: NativeSmartModuleManagement; operation?: NativeSmartAccountOperation };
function retire(owner: Owner) {
  owner.live = false; owner.abort.abort();
  owner.closing ??= Promise.allSettled([owner.work, owner.operation?.dispose()]).then(() => undefined);
  return owner.closing;
}

/** Public module configuration. The shared operation flow owns both authorizations. */
export function NativeSmartAccountModulesScreen({ open, onBack, ledgerConnection }: Props) {
  const { t } = useNativeTranslation();
  const selected = useRef<Owner | undefined>(undefined), mounted = useRef(false), callbacks = useRef({ onBack });
  const [epoch, setEpoch] = useState(0), [manager, setManager] = useState<NativeSmartModuleManagement>(), [metadata, setMetadata] = useState<ISmartAccountMetadata>();
  const [operation, setOperation] = useState<NativeSmartAccountOperation>(), [busy, setBusy] = useState(false), [failure, setFailure] = useState<string>(), [closing, setClosing] = useState(false);
  const [mode, setMode] = useState<'installed' | 'custom' | 'composite'>('installed');
  const modeRef = useRef(mode);
  useLayoutEffect(() => { modeRef.current = mode; }, [mode]);
  const [address, setAddress] = useState(''), [name, setName] = useState(''), [initData, setInitData] = useState('0x');
  const [preflight, setPreflight] = useState<{ address: string; result: CustomValidatorPreflightResult }>();
  const [children, setChildren] = useState<readonly string[]>([]), [threshold, setThreshold] = useState('1');
  useLayoutEffect(() => { callbacks.current = { onBack }; }, [onBack]);
  const current = useCallback((owner: Owner) => mounted.current && selected.current === owner && owner.live && !owner.abort.signal.aborted && AppState.currentState === 'active', []);
  const check = useCallback((owner: Owner) => { if (!current(owner)) throw Error('CANCELLED'); }, [current]);
  const back = useCallback((owner: Owner) => {
    if (!mounted.current || selected.current !== owner || !owner.live) return;
    setClosing(true);
    void retire(owner).then(() => { if (mounted.current && selected.current === owner) callbacks.current.onBack(); });
  }, []);
  const navigateBack = useCallback((owner: Owner) => {
    if (!owner.busy && !owner.operation && modeRef.current !== 'installed') { setMode('installed'); return; }
    back(owner);
  }, [back]);
  const load = useCallback(async (owner: Owner) => {
    check(owner); const value = await owner.manager!.read(); check(owner);
    setMetadata(value); setPreflight(undefined);
    const installed = value.installedModules?.find(module => module.type === 'validator' && module.id === 'composite');
    setChildren(installed?.id === 'composite' ? [...installed.config.childValidators] : []);
    setThreshold(String(installed?.id === 'composite' ? installed.config.threshold : 1));
  }, [check]);
  const run = useCallback((owner: Owner, task: () => Promise<void>) => {
    if (!current(owner) || owner.busy) return;
    owner.busy = true; setBusy(true); setFailure(undefined);
    owner.work = Promise.resolve().then(() => { check(owner); return task(); }).catch(error => {
      if (current(owner)) setFailure(error?.code === 'COMPOSITE_LOCKOUT' ? 'smartAccountHub.compositeLockout' : error?.code === 'COMPOSITE_UNAVAILABLE' ? 'smartAccountHub.compositeUnavailable' : error?.code === 'INVALID_COMPOSITE' ? 'smartAccountHub.compositeInvalid' : 'mobile.smartAccountModules.unavailable');
    }).finally(() => { owner.busy = false; if (current(owner)) setBusy(false); });
  }, [check, current]);
  useEffect(() => {
    mounted.current = true;
    const owner: Owner = { live: true, busy: false, abort: new AbortController() };
    selected.current = owner;
    void Promise.resolve().then(() => run(owner, async () => {
      setManager(undefined); setMetadata(undefined); setOperation(undefined); setClosing(false); setFailure(undefined); setMode('installed');
      setAddress(''); setName(''); setInitData('0x'); setPreflight(undefined);
      const value = await open(owner.abort.signal, () => check(owner)); check(owner);
      owner.manager = value; setManager(value); await load(owner);
    }));
    const change = AppState.addEventListener('change', state => { if (state !== 'active') back(owner); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => back(owner)) : undefined;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => { navigateBack(owner); return true; });
    return () => { mounted.current = false; void retire(owner); change.remove(); blur?.remove(); hardware.remove(); };
  }, [back, check, epoch, load, navigateBack, open, run]);
  const returnToStatus = useCallback((owner: Owner, expected: NativeSmartAccountOperation) => {
    if (!current(owner) || owner.operation !== expected) return;
    setClosing(true);
    void retire(owner).then(() => { if (mounted.current && selected.current === owner) setEpoch(value => value + 1); });
  }, [current]);
  const shownOwner = selected.current;
  const close = () => { if (shownOwner) back(shownOwner); };
  if (operation) return <NativeSmartAccountOperationScreen ledgerConnection={ledgerConnection} controller={operation} onBack={() => { if (shownOwner) returnToStatus(shownOwner, operation); }} />;
  const action = (task: (owner: Owner, value: NativeSmartModuleManagement) => Promise<void>) => {
    const owner = shownOwner, value = manager;
    if (!owner || !value || !current(owner) || owner.manager !== value) return;
    run(owner, () => { check(owner); if (owner.manager !== value) throw Error('CANCELLED'); return task(owner, value); });
  };
  const review = (draft: NativeSmartModuleDraft) => action(async (owner, value) => {
    const next = await value.openChange(draft, owner.abort.signal, () => check(owner));
    try { check(owner); owner.operation = next; setOperation(next); }
    catch (error) { await next.dispose(); throw error; }
  });
  const validators = (metadata?.installedModules ?? []).filter((module): module is SmartAccountValidatorModule => module.type === 'validator');
  const candidates = metadata ? listCompositeChildCandidates(metadata) : [];
  const label = (module: SmartAccountValidatorModule) => module.id === 'custom' ? module.config.name || t('smartAccountHub.customModule') : t(module.id === 'composite' ? 'settings.compositeAuthenticator' : module.id === 'slh-dsa' ? 'settings.slhDsaAuthenticator' : module.id === 'p256-webauthn' ? 'settings.passkeyAuthenticator' : 'settings.ecdsaAuthenticator');
  const moduleIcon = (module: SmartAccountValidatorModule) => module.id === 'custom' ? 'settings' : module.id === 'composite' ? 'grid' : module.id === 'p256-webauthn' ? 'fingerprint' : module.id === 'slh-dsa' ? 'shield' : 'key';
  const checked = preflight?.address === address.trim() ? preflight.result : undefined;
  const validInit = /^0x(?:[0-9a-fA-F]{2})*$/.test(initData.trim());
  const validComposite = children.length > 0 && /^\d+$/.test(threshold) && Number.isSafeInteger(Number(threshold)) && Number(threshold) >= 1 && Number(threshold) <= children.length;
  const blocked = busy || closing;
  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen scrollResetKey={mode} footer={<>
{!closing && metadata && mode === 'custom' && (<Button title={t('smartAccountHub.install')} icon="plus" disabled={blocked || !checked?.ok || !validInit} onPress={() => {
            if (checked?.ok && validInit) review({ kind: 'install-custom', address: address.trim(), name: name.trim(), initData: initData.trim() });
          }} />)}
{!closing && metadata && mode === 'composite' && (<Button title={t('smartAccountHub.compositeSavePolicy')} icon="check" disabled={blocked || !validComposite} onPress={() => { if (validComposite) review({ kind: 'composite', children: [...children], threshold: Number(threshold) }); }} />)}
<Button title={t('buttons.close')} icon="close" variant="secondary" size="compact" disabled={closing} onPress={close} />
</>}>
      <Header title={t(mode === 'custom' ? 'smartAccountHub.customModule' : mode === 'composite' ? 'settings.compositeAuthenticator' : 'mobile.smartAccountModules.title')}
        onBack={() => { if (shownOwner) navigateBack(shownOwner); }} />
      {manager && <Card style={s.card}><Text>{manager.networkName}</Text><Text selectable style={s.address}>{manager.accountAddress}</Text></Card>}
      {closing ? <ActivityIndicator accessibilityLabel={t('buttons.close')} color={colors.pink} /> : <>
        {failure && <Notice title={t('settings.unavailable')} body={t(failure)} />}
        {busy && <ActivityIndicator accessibilityLabel={t('settings.smartAccountInfrastructureCheckStatus')} color={colors.pink} />}
        {metadata && mode === 'installed' && <>
          {!validators.length && <Text>{t('smartAccountHub.noModules')}</Text>}
          {validators.map(module => <Card key={module.address} style={s.card}>
            <View style={s.moduleHeading}>
              <View style={s.moduleIdentity}>
                <View style={s.moduleIcon}><Icon name={moduleIcon(module)} size={21} color={colors.blue} /></View>
                <Text style={s.moduleName}>{label(module)}</Text>
              </View>
              <View accessible accessibilityRole="text"
                accessibilityLabel={t(module.address.toLowerCase() === metadata.auth?.validator.toLowerCase() ? 'smartAccountHub.active' : 'smartAccountHub.installed')}
                style={s.statusBadge}>
                <Icon name="check" size={15} color={colors.green} />
                <Text style={s.statusText}>{t(module.address.toLowerCase() === metadata.auth?.validator.toLowerCase() ? 'smartAccountHub.active' : 'smartAccountHub.installed')}</Text>
              </View>
            </View>
            <Text selectable style={s.address}>{module.address}</Text>
            {canRemoveValidatorModule(metadata, module.address, 'all-installed-composites') && <Button title={t('smartAccountHub.uninstall')} icon="trash" variant="secondary" size="compact" disabled={blocked} onPress={() => {
              if (canRemoveValidatorModule(metadata, module.address, 'all-installed-composites')) review({ kind: 'uninstall', address: module.address });
            }} />}
          </Card>)}
          <Button title={t('smartAccountHub.customModule')} icon="plus" variant="secondary" size="compact" disabled={blocked} onPress={() => setMode('custom')} />
          <Button title={t('settings.compositeAuthenticator')} icon="grid" variant="secondary" size="compact" disabled={blocked} onPress={() => setMode('composite')} />
        </>}
        {metadata && mode === 'custom' && <Card style={s.card}>
          <Text>{t('smartAccountHub.customModuleHint')}</Text>
          <NativeSendInput label={t('smartAccountHub.moduleAddress')} value={address} busy={blocked} onChange={value => { setAddress(value); setPreflight(undefined); }} />
          <NativeSendInput label={t('smartAccountHub.moduleName')} value={name} busy={blocked} max={120} placeholder={t('smartAccountHub.moduleNamePlaceholder')} onChange={setName} />
          <NativeSendInput label={t('smartAccountHub.moduleInitData')} value={initData} busy={blocked} max={131074} onChange={setInitData} />
          <Button title={t('smartAccountHub.checkModule')} icon="shield" variant="secondary" size="compact" disabled={blocked || !address.trim()} onPress={() => action(async (owner, value) => {
            const checkedAddress = address.trim(); setPreflight(undefined);
            const result = await value.preflightCustom(checkedAddress); check(owner); setPreflight({ address: checkedAddress, result });
          })} />
          {checked && <>
            {checked.ok && <View style={s.preflight}><Icon name="check" size={18} color={colors.green} /><Text style={s.preflightText}>{t('smartAccountHub.preflightPassed')}</Text></View>}
            {checked.failures.map(failure => <Text key={failure}>{t(failure === 'already-installed' ? 'smartAccountHub.preflightAlreadyInstalled' : failure === 'no-contract-code' ? 'smartAccountHub.preflightNoCode' : 'smartAccountHub.preflightNotValidator')}</Text>)}
          </>}
          {!validInit && <Text>{t('smartAccountHub.invalidInitData')}</Text>}

        </Card>}
        {metadata && mode === 'composite' && <Card style={s.card}>
          <Text>{t('smartAccountHub.compositeBuilderHint')}</Text><Text>{t('smartAccountHub.compositeMethods')}</Text>
          {candidates.map(module => <View key={module.address} style={s.candidate}>
            <View style={s.choice}><Icon name={moduleIcon(module)} size={21} color={colors.blue} /><Text style={s.choiceText}>{label(module)}</Text><Switch accessibilityLabel={`${label(module)} ${module.address}`} value={children.some(child => child.toLowerCase() === module.address.toLowerCase())} disabled={blocked} onValueChange={value => setChildren(previous => value ? [...previous, module.address] : previous.filter(child => child.toLowerCase() !== module.address.toLowerCase()))} /></View>
            <Text selectable style={s.address}>{module.address}</Text>
          </View>)}
          {!candidates.length && <Text>{t('smartAccountHub.compositeSelectMethods')}</Text>}
          <NativeSendInput label={t('smartAccountHub.compositeThreshold')} keyboardType="number-pad" max={3} value={threshold} busy={blocked} onChange={setThreshold} />
          {validComposite ? <Text>{t('smartAccountHub.compositeThresholdSummary', { required: Number(threshold), total: children.length })}</Text> : <Text>{t('smartAccountHub.compositeInvalid')}</Text>}
          <Text>{t('smartAccountHub.compositeLockout')}</Text><Text>{t('smartAccountHub.compositeOnchainHint')}</Text>

        </Card>}
        {metadata && mode !== 'installed' && <Button title={t('smartAccountHub.installedModules')} icon="grid" variant="secondary" size="compact" disabled={blocked} onPress={() => setMode('installed')} />}
        {manager && <Button title={t('settings.smartAccountInfrastructureCheckStatus')} icon="refresh" variant="secondary" size="compact" disabled={blocked} onPress={() => action(owner => load(owner))} />}
      </>}
    </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, card: { padding: 16, gap: 12 }, address: { fontFamily: 'monospace', fontSize: 12, color: colors.muted }, choice: { flexDirection: 'row', alignItems: 'center', gap: 12 }, choiceText: { flex: 1 }, candidate: { gap: 6 },
  moduleHeading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  moduleIdentity: { flex: 1, minWidth: 130, flexDirection: 'row', alignItems: 'center', gap: 10 },
  moduleIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  moduleName: { flex: 1, fontWeight: '600', fontSize: 17 },
  preflight: { flexDirection: 'row', alignItems: 'center', gap: 8 }, preflightText: { flex: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#12312d' },
  statusText: { color: colors.green, fontSize: 12, fontWeight: '600' },
});
