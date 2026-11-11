import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNativeTranslation } from '../platform/localization';
import { formatBaseUnits } from '../core/amounts';
import type { NativePsbtReview as Review } from '../connections/psbtRequests';
import type { NativeConnectionsView } from '../connections/types';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { DappSiteStatus } from './DappSiteStatus';
import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { useDappLedgerConnection } from './useDappLedgerConnection';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

/** Only the common engine's verified public review enters this screen. */
export function NativePsbtReview({ review, controller, ledgerConnection }: { review: Review; controller: Pick<NativeConnectionsView, 'approvePsbt' | 'rejectPsbt' | 'getSnapshot' | 'backgroundSigning' | 'isRequestAuthenticating'>; ledgerConnection?: NativeLedgerConnectionView }) {
  const ledger = useDappLedgerConnection({ review, controller, ledgerConnection });
  const { t } = useNativeTranslation();
  const requestId = review.id;
  const authentication = useMemo(() => ({ isAuthenticating: () => controller.isRequestAuthenticating(requestId) }), [controller, requestId]);
  const identity = `${review.id}:${review.expiresAt}`, details = review.details;
  const [retired, setRetired] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const owner = useRef<{ identity: string; details: Review['details']; active: boolean }>({ identity, details, active: true });
  const busy = useRef(false), attempt = useRef<object | null>(null);
  useLayoutEffect(() => {
    if (owner.current.identity !== identity) owner.current = { identity, details, active: true };
    else owner.current.details = details;
  }, [identity, details]);
  const reject = useCallback(() => {
    if (owner.current.identity === identity) { owner.current.active = false; attempt.current = null; }
    setRetired(identity);
    void controller.rejectPsbt(review.id).catch(() => undefined);
  }, [controller, review.id, identity]);
  useEffect(() => {
    const retained = owner.current;
    retained.active = true; busy.current = false; attempt.current = null;
    const timer = setTimeout(reject, Math.max(0, review.expiresAt - Date.now()));
    const interrupt = (state: string) => { if (!allowsPrivateAuthenticationInterruption(authentication, state)) {
      if (owner.current.identity === identity) { owner.current.active = false; attempt.current = null; }
      setRetired(identity); controller.backgroundSigning();
    } };
    const app = AppState.addEventListener('change', state => { if (state !== 'active') interrupt(state); });
    const blur = AppState.addEventListener('blur', () => interrupt('blur'));
    const back = BackHandler.addEventListener('hardwareBackPress', () => { reject(); return true; });
    return () => {
      retained.active = false; attempt.current = null;
      clearTimeout(timer); app.remove(); blur.remove(); back.remove();
      if (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState)) controller.backgroundSigning();
      else void controller.rejectPsbt(review.id).catch(() => undefined);
    };
  }, [controller, review.id, review.expiresAt, reject, identity, authentication]);
  const unavailable = !details || !!review.error || retired === identity;
  const blocked = unavailable || ledger.blocked || review.busy || review.attempted || submitting === identity;
  const approve = async () => {
    if (blocked || !ledger.canApprove() || busy.current || !owner.current.active || owner.current.identity !== identity || owner.current.details !== details ||
        Date.now() >= review.expiresAt || AppState.currentState !== 'active') return;
    const ticket = {}; attempt.current = ticket; busy.current = true;
    setSubmitting(identity); setFailed(null);
    try { await controller.approvePsbt(review.id, review.revision); }
    catch { if (owner.current.active && attempt.current === ticket && owner.current.identity === identity) setFailed(identity); }
    finally {
      if (attempt.current === ticket) {
        attempt.current = null; busy.current = false;
        if (owner.current.active && owner.current.identity === identity) setSubmitting(null);
      }
    }
  };
  const action = review.method === 'sys_sign' ? t('mobile.connections.psbt.signTitle') : t('mobile.connections.psbt.sendTitle');
  const errorText = review.error === 'DELIVERY_UNCERTAIN'
    ? { title: t('mobile.connections.psbt.deliveryTitle'), body: t('mobile.connections.psbt.deliveryBody') }
    : review.error === 'SUBMISSION_UNCERTAIN'
    ? { title: t('mobile.connections.psbt.submissionTitle'), body: t('mobile.connections.psbt.submissionBody') }
    : { title: t('mobile.connections.psbt.unavailableTitle'), body: t('mobile.connections.psbt.unavailableBody') };
  return <SafeAreaView edges={['top', 'bottom']} style={s.root}><Screen footer={<>
    {ledger.showConnect && <Button title={t('mobile.accounts.connectLedger')} variant="secondary" onPress={ledger.connect} />}
    <Button title={review.busy || submitting === identity ? t('send.signing') : action} disabled={blocked} onPress={approve} testID="native-psbt-approve" />
    <Button title={review.attempted ? t('buttons.close') : t('buttons.reject')} variant="secondary" onPress={reject} />
  </>}>
    <Header title={action} onBack={reject} />
    <Card style={s.card}>
      <Text style={s.heading}>{review.appName}</Text>
      <Text style={s.muted}>{t('mobile.connections.reportedWebsite')}</Text><Text selectable style={s.value}>{review.origin}</Text>
      <DappSiteStatus verification={review.verification} />
      <Text style={s.muted}>{review.accountLabel} · {review.networkLabel}</Text><Text selectable style={s.value}>{review.address}</Text>
    </Card>
    {details && <>
      {review.method === 'sys_sign' && <Text style={s.body}>{t('mobile.connections.psbt.partialBody')}</Text>}
      <Card style={s.card}>
        <Text style={s.muted}>{t('mobile.connections.psbt.transactionType')}</Text><Text style={s.value}>{details.transactionType}</Text>
        <Text style={s.muted}>{t('send.networkFee')}</Text><Text testID="native-psbt-fee">{formatBaseUnits(details.feeSatoshis, review.decimals)} {review.symbol}</Text>
        <Text>{t('send.inputs')}: {details.inputs.length}</Text>
        <Text>{t('transactions.rbfLabel')} {details.transactionOptions.rbf ? t('components.enabled') : t('components.disabled')}</Text>
      </Card>
      {details.sentry && <Card style={s.card} testID="native-psbt-sentry-fee">
        <Text style={s.heading}>{t('sentry.feeTitle')}</Text><Text>{t('sentry.feeHelp')}</Text>
        <Text>{t(`sentry.feeOperations.${details.sentry.operation}`)}</Text>
        {details.sentry.proTxHash && <Text selectable style={s.value}>{t('sentry.registeredNode')}: {details.sentry.proTxHash}</Text>}
        <Text style={s.heading}>{t('sentry.feeChanges')}</Text>
        {'changes' in details.sentry ? Object.entries(details.sentry.changes).map(([name, change]) => <React.Fragment key={name}>
          <Text>{t(`sentry.${{ service: 'service', operatorPayoutScript: 'operatorPayoutScript', nevmAddress: 'nEVMAddress' }[name]}`)}</Text>
          <Text selectable style={s.value}>{t('sentry.current')}: {change.previous || t('sentry.notSet')}</Text>
          <Text selectable style={s.value}>{t('sentry.proposed')}: {change.next || t('sentry.notSet')}</Text>
        </React.Fragment>) : Object.entries(details.sentry.fields).map(([name, value]) => {
          const previous = name.startsWith('previous') && name.length > 8;
          const suffix = previous ? name.slice(8) : name;
          const field = previous ? suffix.startsWith('PQ') ? `pq${suffix.slice(2)}` : suffix.charAt(0).toLowerCase() + suffix.slice(1) : suffix;
          const label = field === 'collateral' ? t('sentry.collateralOutpoint') : field === 'service' ? t('sentry.service') : t(`sentry.managementFields.${field}`);
          return <React.Fragment key={name}><Text>{previous ? `${t('sentry.current')}: ` : ''}{label}</Text><Text selectable style={s.value}>{value || t('sentry.notSet')}</Text></React.Fragment>;
        })}
      </Card>}
      <Text style={s.heading}>{t('transactions.outputsHeading')}</Text>
      {details.outputs.map(output => <Card key={output.index} style={s.card}>
        <Text style={s.heading}>{t('transactions.outputNumber', { index: output.index + 1 })}</Text>
        <Text>{formatBaseUnits(output.valueSatoshis, review.decimals)} {review.symbol}</Text>
        {output.address && <Text selectable style={s.value}>{output.address}</Text>}
        <Text style={s.muted}>{t('transactions.outputScript')}</Text><Text selectable style={s.value}>{output.scriptHex}</Text>
        {output.assets.map(asset => <React.Fragment key={asset.assetGuid}>
          <Text>{asset.amount} {asset.symbol}</Text><Text style={s.muted}>{t('send.assetGuid')}: {asset.assetGuid}</Text>
        </React.Fragment>)}
      </Card>)}
    </>}
    {!details && !review.error && <Text accessibilityLiveRegion="polite">{t('mobile.connections.psbt.checking')}</Text>}
    {review.error === 'BLOCKED_SITE' && !review.verification.isScam && <Notice title={t('mobile.connections.blocked')} body={t('mobile.connections.blocked')} />}
    {review.error === 'SITE_MISMATCH' && review.verification.validation !== 'INVALID' && <Notice title={t('mobile.connections.mismatch')} body={t('mobile.connections.mismatch')} />}
    {(review.error && review.error !== 'BLOCKED_SITE' && review.error !== 'SITE_MISMATCH' || failed === identity && !review.error) && <Notice
      title={errorText.title} body={errorText.body} />}
    {review.txid && <Text selectable style={s.value}>{review.txid}</Text>}
  </Screen>{ledger.modal}</SafeAreaView>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, card: { padding: 20, gap: 10 },
  heading: { fontSize: 18, fontWeight: '700' }, muted: { color: colors.muted }, body: { marginVertical: 12 },
  value: { flexShrink: 1, fontSize: 13, fontFamily: 'monospace' } });
