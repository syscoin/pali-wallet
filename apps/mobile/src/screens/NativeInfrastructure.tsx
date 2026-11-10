import React, { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, BackHandler, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatBaseUnits } from '../core/amounts';
import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { useNativeTranslation } from '../platform/localization';
import type { NativeInfrastructureController, NativeInfrastructureSnapshot } from '../smartAccount/infrastructure';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { TransactionDetails } from './NativeTransactionReview';
import { useOwnedLedgerConnection } from './useDappLedgerConnection';

type Props = {
  open(signal: AbortSignal, assertCurrent: () => void): Promise<NativeInfrastructureController>;
  onBack(): void;
  ledgerConnection?: NativeLedgerConnectionView;
};
type Scope = Readonly<{ source: Props['open'] }>;
type Owner = { scope: Scope; live: boolean; abort: AbortController; controller?: NativeInfrastructureController };
const empty: NativeInfrastructureSnapshot = Object.freeze({ phase: 'loading', revision: 0, status: null, feeReview: null, error: null });
const emptySnapshot = () => empty;
const emptySubscribe = () => () => {};

/** Each presentation owns one bounded host; no pending open can adopt a replacement mount. */
export function NativeInfrastructure({ open, onBack, ledgerConnection }: Props) {
  const { t } = useNativeTranslation();
  const scope = useMemo<Scope>(() => ({ source: open }), [open]);
  const owner = useRef<Owner | null>(null);
  const back = useRef(onBack);
  const [session, setSession] = useState<{ owner: Owner; controller: NativeInfrastructureController }>();
  const [openingError, setOpeningError] = useState<Scope>();
  const [detailsId, setDetailsId] = useState<number | null>(null);
  useLayoutEffect(() => { back.current = onBack; }, [onBack]);
  const isCurrent = useCallback((current: Owner) => owner.current === current && current.scope === scope && current.live && !current.abort.signal.aborted && AppState.currentState === 'active', [scope]);
  const close = useCallback(() => {
    const current = owner.current;
    if (!current || current.scope !== scope || !current.live) return;
    current.live = false;
    current.abort.abort();
    current.controller?.dispose();
    back.current();
  }, [scope]);
  useLayoutEffect(() => {
    const current: Owner = { scope, live: true, abort: new AbortController() };
    owner.current = current;
    const check = () => {
      if (!isCurrent(current)) throw new Error('CANCELLED');
    };
    void (async () => {
      let controller: NativeInfrastructureController | undefined;
      try {
        check();
        controller = await open(current.abort.signal, check);
        check();
        current.controller = controller;
        setSession({ owner: current, controller });
        await controller.refresh(controller.getSnapshot().revision);
      } catch {
        controller?.dispose();
        if (isCurrent(current)) setOpeningError(scope);
      }
    })();
    const change = AppState.addEventListener('change', next => { if (next !== 'active') close(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', close) : undefined;
    const hardwareBack = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => {
      current.live = false;
      current.abort.abort();
      current.controller?.dispose();
      change.remove(); blur?.remove(); hardwareBack.remove();
    };
  }, [close, isCurrent, open, scope]);
  const current = session?.owner.scope === scope ? session.owner : undefined;
  const controller = current ? session?.controller : undefined;
  const state = useSyncExternalStore(controller?.subscribe ?? emptySubscribe, controller?.getSnapshot ?? emptySnapshot, controller?.getSnapshot ?? emptySnapshot);
  const act = (action: () => Promise<void>) => {
    if (!controller || !current || current.controller !== controller || !isCurrent(current)) return;
    void action().catch(() => undefined);
  };
  const busy = ['loading', 'preparing', 'submitting'].includes(state.phase);
  const review = state.feeReview;
  const pending = state.status?.pending;
  // Adapt once for this immutable quote. Monotonic checks below remain the authority.
  const connectionDeadline = useMemo(() => review
    // eslint-disable-next-line react-hooks/purity -- Snapshot the wall-clock adapter once; the monotonic guard below owns authorization.
    ? Date.now() + Math.max(0, review.expiresAtMonotonicMilliseconds - performance.now())
    : 0, [review]);
  const isReviewCurrent = useCallback(() => {
    if (!controller || !current || !isCurrent(current) || !review || performance.now() >= review.expiresAtMonotonicMilliseconds) return false;
    const latest = controller.getSnapshot();
    return latest.revision === state.revision && latest.phase === 'review' && latest.feeReview === review &&
      !latest.status?.pending && !latest.error;
  }, [controller, current, isCurrent, review, state.revision]);
  // eslint-disable-next-line react-hooks/refs -- Hide expired/retired approvals as well as rejecting them in the event handler.
  const reviewAvailable = state.phase === 'review' && isReviewCurrent();
  const ledger = useOwnedLedgerConnection({ owner: controller ?? empty, revision: state.revision,
    expiresAt: connectionDeadline, available: reviewAvailable,
    isReviewCurrent, ledgerConnection });
  const create2Missing = state.status?.observation.create2Deployer.deployed === false;
  const canReview = !!controller && !busy && !pending && !['review', 'unknown'].includes(state.phase) &&
    !!state.status?.observation.create2Deployer.deployed && !!state.status.observation.missing.length;
  const readyToReview = (state.phase === 'ready' || state.phase === 'complete') && canReview;
  const reviewLabel = state.status?.observation.ready ? 'mobile.infrastructure.reviewOptional' : 'mobile.infrastructure.reviewNext';
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}><Screen key={review && state.phase === 'review' ? `review:${review.id}` : 'status'} footer={<>
    {review && state.phase === 'review'
      ? ledger.showConnect
        ? <Button title={t('mobile.accounts.connectLedger')} variant="secondary" size="compact" onPress={ledger.connect} />
        : <Button title={t('buttons.confirm')} disabled={busy || ledger.blocked || !reviewAvailable} onPress={() => {
          if (!ledger.blocked && isReviewCurrent() && ledger.canApprove()) act(() => controller!.confirm(review.id));
        }} />
      : readyToReview
      ? <Button title={t(reviewLabel)} onPress={() => act(() => controller!.reviewNext(state.revision))} />
      : <Button title={t('mobile.infrastructure.refresh')} variant="secondary" size="compact" disabled={!controller || busy} onPress={() => act(() => controller!.refresh(state.revision))} />}
    <Button title={t('buttons.close')} variant="quiet" size="compact" onPress={close} />
  </>}>
    <Header title={t('settings.smartAccountInfrastructure')} onBack={close} />
    {controller && <Card style={s.card}>
      <Text accessibilityRole="header">{controller.networkLabel}</Text>
      <Text style={s.label}>{t('mobile.infrastructure.feePayer')}</Text>
      <Text>{controller.payerLabel}</Text>
      <Text selectable style={s.address}>{controller.payerAddress}</Text>
    </Card>}
    {readyToReview && <Button title={t('mobile.infrastructure.refresh')} variant="quiet" size="compact" onPress={() => act(() => controller!.refresh(state.revision))} />}
    {busy && <ActivityIndicator color={colors.pink} accessibilityLabel={t('buttons.loading')} />}
    {review && state.phase === 'review' && <>
      <Card style={s.card}>
        <Text accessibilityRole="header">{review.contract.displayName}</Text>
        {review.contract.optional && <Text style={s.label}>{t('settings.optional')}</Text>}
        <Text selectable style={s.address}>{review.contract.address}</Text>
        <Text style={s.label}>{t('transactions.replay.maximumFee')}</Text>
        <Text selectable style={s.amount}>{formatBaseUnits(review.maximumFeeUnits, 18)} {controller?.currencySymbol}</Text>
        <Text style={s.label}>{t('mobile.infrastructure.maximumTotal')}</Text>
        <Text selectable style={s.amount}>{formatBaseUnits(review.maximumTotalUnits, 18)} {controller?.currencySymbol}</Text>
      </Card>
      <Button title={t(detailsId === review.id ? 'send.hideDetails' : 'send.showDetails')} variant="quiet" size="compact" expanded={detailsId === review.id}
        onPress={() => { if (current && isCurrent(current) && controller?.getSnapshot().feeReview?.id === review.id) setDetailsId(detailsId === review.id ? null : review.id); }} />
      {detailsId === review.id && <TransactionDetails key={review.id} transaction={review.transaction} />}
    </>}
    {(pending || state.phase === 'unknown') && <Notice title={t('settings.smartAccountInfrastructure')} tone="amber"
      body={t(state.phase === 'unknown' ? 'mobile.infrastructure.unknown' : 'mobile.infrastructure.pending')} />}
    {pending && <Card style={s.card}>
      <Text>{state.status?.observation.contracts.find(contract => contract.id === pending.contractId)?.displayName}</Text>
      {pending.transactionHash && <><Text style={s.label}>{t('transactions.replay.hash')}</Text><Text selectable style={s.address}>{pending.transactionHash}</Text></>}
    </Card>}
    {(create2Missing || state.phase === 'complete') && <Text accessibilityLiveRegion="polite">
      {t(create2Missing ? 'settings.smartAccountCreate2Missing' : 'settings.smartAccountInfrastructureReady')}
    </Text>}
    {(openingError === scope || state.error) && <Text accessibilityRole="alert" style={s.error}>{t(openingError === scope ? 'mobile.infrastructure.unavailable' : state.error!)}</Text>}
    {state.status && state.phase !== 'review' && <Card style={s.card}>
      <Text style={s.label}>{t('mobile.infrastructure.create2Deployer')}</Text>
      <Text selectable style={s.address}>{state.status.observation.create2Deployer.address}</Text>
      <Text>{t(state.status.observation.create2Deployer.deployed ? 'mobile.infrastructure.codePresent' : 'mobile.infrastructure.codeMissing')}</Text>
      {state.status.observation.contracts.map(contract => <Card key={contract.id} style={s.contract}>
        <Text>{contract.displayName}</Text>
        {contract.optional && <Text style={s.label}>{t('settings.optional')}</Text>}
        <Text selectable style={s.address}>{contract.address}</Text>
        <Text>{t(contract.deployed ? 'mobile.infrastructure.codePresent' : 'mobile.infrastructure.codeMissing')}</Text>
      </Card>)}
    </Card>}
  </Screen>{ledger.modal}</SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  card: { padding: 16, gap: 10, minWidth: 0 },
  contract: { padding: 12, gap: 6, minWidth: 0 },
  label: { color: colors.muted, fontSize: 13 },
  address: { color: colors.muted, fontSize: 12, lineHeight: 19, flexShrink: 1 },
  amount: { fontSize: 17, lineHeight: 25, flexShrink: 1 },
  error: { color: colors.red },
});
