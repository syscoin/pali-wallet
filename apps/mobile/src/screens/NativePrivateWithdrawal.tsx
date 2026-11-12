import { useNativeTranslation } from '../platform/localization';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AppState,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAddress } from 'ethers/address';
import type { NativeSavedNote } from '../custody/noteBackupRuntime';
import type { NativePrivateWithdrawalView as WithdrawalView } from '../custody/privateWithdrawal';
import { formatBaseUnits } from '../core/amounts';
import { Button, Card, colors, Header, Screen, styles, Text } from '../ui';
import { IdlePressable, IdleTextInput } from './IdleActivityBoundary';
import { createNativePrivateAuthenticationChild, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

type Props = {
  note: NativeSavedNote;
  open(signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthenticationScope): Promise<WithdrawalView>;
  authentication: NativePrivateAuthenticationScope;
  onBack(): void;
};
type Owner = {
  live: boolean;
  returning?: boolean;
  abort: AbortController;
  controller?: WithdrawalView;
  opening?: Promise<void>;
  disposing?: Promise<void>;
  authentication: NativePrivateAuthenticationScope;
  parentAuthentication: NativePrivateAuthenticationScope;
  source: Props['open'];
};
function disposeOwner(owner: Owner): Promise<void> {
  owner.disposing ??= Promise.resolve(owner.opening).then(async () => {
    await owner.controller?.dispose();
  });
  return owner.disposing;
}
type Mode = 'direct' | 'relayed';
const recipientValid = (value: string) => {
  try {
    return (
      /^0x[0-9a-f]{40}$/i.test(value.trim()) &&
      BigInt(getAddress(value.trim())) !== 0n
    );
  } catch {
    return false;
  }
};
const amount = (value: string) => `${formatBaseUnits(value, 18)} ETH`;

export function NativePrivateWithdrawal({ note, open, onBack, authentication }: Props) {
  const { t } = useNativeTranslation();
  const owner = useRef<Owner | undefined>(undefined);
  const [opened, setOpened] = useState<{
    source: Props['open'];
    controller?: WithdrawalView;
    failed?: true;
    closing?: true;
  }>();
  const back = useCallback(() => {
    const current = owner.current;
    if (!current?.live || current.source !== open || current.parentAuthentication !== authentication) return;
    current.live = false;
    current.authentication.retire();
    current.returning = true;
    current.abort.abort();
    setOpened({ source: open, closing: true });
    Keyboard.dismiss();
    void disposeOwner(current)
      .catch(() => undefined)
      .then(() => {
        if (owner.current === current && current.returning) onBack();
      });
  }, [authentication, onBack, open]);
  useEffect(() => {
    const current: Owner = { live: true, abort: new AbortController(), source: open,
      parentAuthentication: authentication, authentication: createNativePrivateAuthenticationChild(authentication) };
    owner.current = current;
    const check = () => {
      if (
        owner.current !== current || !current.live ||
        current.abort.signal.aborted ||
        (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication, AppState.currentState))
      )
        throw new Error('privacy_cancelled');
    };
    current.opening = Promise.resolve().then(() => { check(); return open(current.abort.signal, check, current.authentication); }).then(
      (controller) => {
        current.controller = controller;
        if (current.live && AppState.currentState === 'active') setOpened({ source: open, controller });
        else { current.live = false; current.abort.abort(); return controller.dispose().catch(() => undefined); }
      },
      () => {
        if (current.live && AppState.currentState === 'active') setOpened({ source: open, failed: true });
      }
    );
    const change = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication, next)) back();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => { if (!allowsPrivateAuthenticationInterruption(current.authentication, 'blur')) back(); })
        : undefined;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => {
      current.live = false;
      current.authentication.retire();
      current.returning = false;
      current.abort.abort();
      void disposeOwner(current).catch(() => undefined);
      change.remove();
      blur?.remove();
      hardware.remove();
    };
  }, [authentication, back, open]);
  const current = opened?.source === open ? opened : undefined;
  if (current?.controller)
    return (
      <WithdrawalContent
        controller={current.controller}
        note={note}
        onBack={back}
      />
    );
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <Screen
        footer={
          <Button
            title={t('buttons.cancel')}
            variant="secondary" size="compact"
            disabled={current?.closing}
            onPress={back}
          />
        }
      >
        <Header title={t('privacy.withdrawal.title')} onBack={back} />
        <Text
          accessibilityRole={current?.failed ? 'alert' : undefined}
          style={styles.muted}
        >
          {current?.failed
            ? t('mobile.privacyFlows.withdrawal.couldNotOpenThisWithdrawalCheckThePoolDataAnd')
            : current?.closing
            ? t('mobile.privacyFlows.withdrawal.closingWithdrawal')
            : t('mobile.privacyFlows.withdrawal.openingWithdrawal')}
        </Text>
      </Screen>
    </SafeAreaView>
  );
}

function WithdrawalContent({
  controller,
  note,
  onBack,
}: {
  controller: WithdrawalView;
  note: NativeSavedNote;
  onBack(): void;
}) {
  const { t } = useNativeTranslation();
  const subscribe = useCallback(
    (notify: () => void) => controller.subscribe(notify),
    [controller]
  );
  const state = useSyncExternalStore(
    subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [recipient, setRecipient] = useState('');
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<Mode>(state.canSign ? 'direct' : 'relayed');
  const [relayerId, setRelayerId] = useState('');
  const [expired, setExpired] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const modes = useRef(new Map<Mode, React.ComponentRef<typeof View>>());
  const review = state.review;
  const busy =
    state.checking ||
    state.phase === 'preparing' ||
    state.phase === 'submitting';
  const submitted =
    !!state.result || (!!state.status && state.status.phase !== 'none');
  const observed =
    state.status && state.status.phase !== 'none'
      ? state.status
      : state.result;
  const spent = state.noteStatus?.phase === 'spent';
  const unknown = observed?.phase === 'unknown';
  const showReview = !!review && !editing && !submitted;
  const reviewExpired = !!review && expired === review.intentId;
  const healthyRelayer = state.relayers.some(
    (relayer) =>
      relayer.id === relayerId && relayer.health === 'reported-healthy'
  );
  useEffect(() => {
    if (mode === 'relayed')
      void controller.loadRelayers().catch(() => undefined);
  }, [controller, mode]);
  useEffect(() => {
    if (!review) return;
    const timer = setTimeout(() => {
      setExpired(review.intentId);
    }, Math.max(0, review.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [review]);
  const prepare = () => {
    if (
      busy ||
      submitted ||
      !recipientValid(recipient) ||
      (mode === 'relayed' &&
        !controller
          .getSnapshot()
          .relayers.some(
            (relayer) =>
              relayer.id === relayerId && relayer.health === 'reported-healthy'
          ))
    )
      return;
    Keyboard.dismiss();
    setTouched(true);
    setEditing(false);
    void controller
      .prepare({
        recipient: recipient.trim(),
        mode,
        ...(mode === 'relayed' ? { relayerId } : {}),
      })
      .catch(() => undefined);
  };
  const confirm = () => {
    const current = controller.getSnapshot();
    if (
      !review ||
      current.review !== review ||
      current.phase !== 'review' ||
      current.checking ||
      Date.now() >= review.expiresAt
    )
      return;
    void controller.confirm(review.intentId).catch(() => undefined);
  };
  const chooseMode = (next: Mode) => {
    if (!busy && (next !== 'direct' || state.canSign)) {
      if (next !== mode) setRelayerId('');
      setMode(next);
    }
  };
  const modeKeys = (
    event: { nativeEvent: { key?: string }; preventDefault(): void },
    next: Mode
  ) => {
    if (busy) return;
    if (
      event.nativeEvent.key === 'ArrowLeft' ||
      event.nativeEvent.key === 'ArrowRight'
    ) {
      event.preventDefault();
      const target =
        next === 'direct' ? 'relayed' : state.canSign ? 'direct' : 'relayed';
      chooseMode(target);
      (modes.current.get(target) as unknown as { focus?(): void })?.focus?.();
    }
  };
  const reviewRestored = () => {
    if (busy) return;
    Keyboard.dismiss();
    void controller.reviewRestored().catch(() => undefined);
  };
  const title = submitted
    ? spent
      ? t('mobile.privacyFlows.deposit.noteAlreadySpent')
      : unknown
      ? t('privacy.deposit.unknown')
      : (state.status?.jobId || state.result?.jobId) &&
        !(state.status?.transactionHash || state.result?.transactionHash)
      ? t('privacy.withdrawal.accepted')
      : t('mobile.privacyFlows.withdrawal.withdrawalSubmitted')
    : showReview
    ? t('privacy.withdrawal.continue')
    : t('privacy.withdrawal.title');
  const hash =
    state.status?.transactionHash ??
    state.result?.transactionHash ??
    state.result?.signedTransactionHash;
  const jobId = state.status?.jobId ?? state.result?.jobId;
  const error =
    state.error === 'expired'
      ? t('mobile.privacyFlows.withdrawal.thisReviewExpiredPrepareAFreshReviewBeforeConfirming')
      : state.error === 'pending'
      ? t('mobile.privacyFlows.withdrawal.thisNoteHasASavedWithdrawalCheckItsStatusBefore')
      : state.error === 'verification'
      ? t('mobile.privacyFlows.withdrawal.checkThePoolDataBeforePreparingThisWithdrawal')
      : state.error === 'restored'
      ? t('mobile.privacyFlows.withdrawal.couldNotReviewThisRestoredNoteTryAgain')
      : state.error === 'unavailable'
      ? t('mobile.privacyFlows.withdrawal.thisWithdrawalIsUnavailableInTheCurrentAccountOrNetwork')
      : state.error === 'failed'
      ? t('mobile.privacyFlows.withdrawal.couldNotCompleteThisRequestCheckThePoolDataAnd')
      : null;
  const needsRefresh = reviewExpired || state.phase === 'failed';
  const primary = submitted ? (
    <Button title={t('privacy.deposit.done')} onPress={onBack} />
  ) : state.restored ? (
    <Button
      title={busy ? t('mobile.privacyFlows.withdrawal.reviewingNote') : t('privacy.restoreReview.action')}
      disabled={busy}
      onPress={reviewRestored}
    />
  ) : showReview ? (
    <Button
      title={
        state.phase === 'submitting'
          ? t('privacy.deposit.submitting')
          : needsRefresh
          ? t('privacy.deposit.refresh')
          : t('privacy.withdrawal.confirm')
      }
      disabled={busy}
      onPress={needsRefresh ? prepare : confirm}
    />
  ) : (
    <Button
      title={
        state.phase === 'preparing' ? t('mobile.privacyFlows.withdrawal.preparingProof') : t('privacy.withdrawal.continue')
      }
      disabled={
        busy ||
        !recipientValid(recipient) ||
        (mode === 'relayed' && !healthyRelayer) ||
        state.noteStatus?.phase !== 'verified'
      }
      onPress={prepare}
    />
  );
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <KeyboardAvoidingView
        style={s.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen
          scrollResetKey={`${state.phase}:${showReview ? review?.intentId : submitted ? 'result' : 'draft'}`}
          footer={
            <>
              {primary}
              {!submitted && (
                <Button title={t('buttons.cancel')} variant="secondary" size="compact" onPress={onBack} />
              )}
            </>
          }
        >
          <Header title={title} onBack={onBack} />
          <Text style={s.denomination}>{note.amount} ETH</Text>
          <Text style={styles.muted}>{t('mobile.privacyFlows.withdrawal.ethereumMainnetPrivateNote')}</Text>
          {error && (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          )}
          {state.restored && !submitted ? (
            <>
              <Text style={styles.muted}>
                {t('mobile.privacyFlows.withdrawal.reviewThisRestoredNoteBeforeWithdrawing')}</Text>
            </>
          ) : !showReview && !submitted ? (
            <>
              <Text style={s.label}>{t('privacy.withdrawal.recipient')}</Text>
              <IdleTextInput
                accessibilityLabel={t('privacy.withdrawal.recipient')}
                value={recipient}
                onChangeText={setRecipient}
                editable={!busy}
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
                maxLength={1024}
                onBlur={() => setTouched(true)}
                style={s.input}
              />
              {touched && !recipientValid(recipient) && (
                <Text accessibilityRole="alert" style={s.error}>
                  {t('privacy.withdrawal.recipientInvalid')}</Text>
              )}
              <Text style={s.label}>{t('privacy.withdrawal.method')}</Text>
              <Card
                accessibilityRole="radiogroup"
                accessibilityLabel={t('mobile.privacyFlows.withdrawal.withdrawalDelivery')}
                style={s.card}
              >
                {(['direct', 'relayed'] as const).map((item) => (
                  <IdlePressable
                    key={item}
                    ref={(value) => {
                      if (value) modes.current.set(item, value);
                      else modes.current.delete(item);
                    }}
                    accessibilityRole="radio"
                    accessibilityLabel={
                      item === 'direct' ? t('privacy.withdrawal.direct') : t('privacy.withdrawal.relayed')
                    }
                    accessibilityState={{
                      checked: mode === item,
                      disabled: busy || (item === 'direct' && !state.canSign),
                    }}
                    aria-checked={mode === item}
                    disabled={busy || (item === 'direct' && !state.canSign)}
                    {...(Platform.OS === 'web'
                      ? {
                          tabIndex: mode === item && !busy ? 0 : -1,
                          onKeyDown: (event: {
                            nativeEvent: { key?: string };
                            preventDefault(): void;
                          }) => modeKeys(event, item),
                        }
                      : {})}
                    onPress={() => chooseMode(item)}
                    style={[s.option, mode === item && s.selected]}
                  >
                    <Text style={s.optionLabel}>
                      {item === 'direct' ? t('privacy.withdrawal.direct') : t('privacy.withdrawal.relayed')}
                    </Text>
                    <Text aria-hidden>{mode === item ? '●' : '○'}</Text>
                  </IdlePressable>
                ))}
              </Card>
              {!state.canSign && (
                <Text style={styles.muted}>
                  {t('mobile.privacyFlows.withdrawal.thisAccountCannotSignADirectWithdrawal')}</Text>
              )}
              <Text style={styles.muted}>
                {mode === 'direct'
                  ? t('privacy.withdrawal.directWarning')
                  : t('privacy.withdrawal.relayedWarning')}
              </Text>
              {mode === 'relayed' && (
                <>
                  <Text style={s.label}>{t('privacy.withdrawal.relayed')}</Text>
                  {state.relayers.length === 0 && (
                    <Text style={styles.muted}>
                      {state.checking
                        ? t('privacy.withdrawal.loadingRelayers')
                        : t('privacy.withdrawal.noRelayers')}
                    </Text>
                  )}
                  {state.relayers.map((relayer) => (
                    <Button
                      key={relayer.id}
                      title={`${relayer.name}${
                        relayer.feePercent === undefined
                          ? ''
                          : ` · ${relayer.feePercent}%`
                      }${
                        relayer.health === 'reported-healthy'
                          ? ''
                          : ` · ${t('privacy.withdrawal.unavailableRelayer')}`
                      }`}
                      variant={
                        relayerId === relayer.id ? 'primary' : 'secondary'
                      }
                      disabled={busy || relayer.health !== 'reported-healthy'}
                      onPress={() => setRelayerId(relayer.id)}
                    />
                  ))}
                  <Button icon="refresh"
                    title={t('mobile.privacyFlows.withdrawal.refreshRelayers')}
                    variant="secondary" size="compact"
                    disabled={busy}
                    onPress={() => {
                      setRelayerId('');
                      void controller.loadRelayers().catch(() => undefined);
                    }}
                  />
                </>
              )}
              {state.noteStatus?.phase !== 'verified' &&
                state.phase !== 'preparing' && (
                  <Button
                    title={
                      state.checking ? t('mobile.noteFlows.import.checkingPool') : t('mobile.noteFlows.inventory.checkPoolStatus')
                    }
                    variant="secondary" size="compact"
                    disabled={busy}
                    onPress={() => {
                      void controller.refresh().catch(() => undefined);
                    }}
                  />
                )}
            </>
          ) : null}
          {state.phase === 'preparing' && (
            <Card style={s.card}>
              <Text accessibilityLiveRegion="polite" style={s.label}>
                {state.progress?.stage === 'artifacts'
                  ? t('mobile.privacyFlows.withdrawal.loadingProofResources')
                  : state.progress?.stage === 'witness'
                  ? t('mobile.privacyFlows.withdrawal.preparingWitness')
                  : state.progress?.stage === 'verifying'
                  ? t('mobile.privacyFlows.withdrawal.checkingProof')
                  : t('mobile.privacyFlows.withdrawal.preparingProof')}
              </Text>
              <Text style={styles.muted}>
                {t('privacy.withdrawal.proving')}</Text>
            </Card>
          )}
          {showReview && review && (
            <>
              <Card style={s.card}>
                <Text style={s.label}>{t('privacy.withdrawal.recipient')}</Text>
                <Text selectable style={s.address}>
                  {review.recipient}
                </Text>
                <Text style={s.label}>
                  {review.mode === 'direct' ? t('privacy.withdrawal.gasPayer') : t('privacy.withdrawal.relayed')}
                </Text>
                <Text selectable style={s.address}>
                  {review.mode === 'direct'
                    ? review.account.address
                    : review.relayerName}
                </Text>
                {review.relayerEndpoint && (
                  <Text selectable style={s.address}>
                    {review.relayerEndpoint}
                  </Text>
                )}
                <Text style={s.label}>{t('mobile.privacyFlows.withdrawal.poolAmount')}</Text>
                <Text selectable>{review.amount} ETH</Text>
                <Text style={s.label}>{t('privacy.deposit.networkFee')}</Text>
                <Text selectable>{amount(review.maxNetworkFeeWei)}</Text>
                {review.mode === 'relayed' && (
                  <>
                    <Text style={s.label}>{t('privacy.withdrawal.serviceFee')}</Text>
                    <Text selectable>{amount(review.serviceFeeWei)}</Text>
                    <Text style={s.label}>{t('privacy.withdrawal.totalFee')}</Text>
                    <Text selectable>{amount(review.feeWei)}</Text>
                  </>
                )}
                <Text style={s.label}>{t('privacy.withdrawal.receive')}</Text>
                <Text selectable>{amount(review.receiveWei)}</Text>
              </Card>
              <Text style={styles.muted}>
                {review.mode === 'direct'
                  ? t('privacy.withdrawal.directWarning')
                  : t('privacy.withdrawal.relayedWarning')}
              </Text>
              {reviewExpired && (
                <Text accessibilityLiveRegion="polite" style={styles.muted}>
                  {t('mobile.privacyFlows.withdrawal.thisReviewExpiredPrepareAFreshReviewBeforeConfirming')}</Text>
              )}
              <Button icon="edit"
                title={t('mobile.privacyFlows.withdrawal.editWithdrawal')}
                variant="secondary" size="compact"
                disabled={busy}
                onPress={() => setEditing(true)}
              />
            </>
          )}
          {submitted && (
            <>
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                {spent
                  ? t('mobile.privacyFlows.withdrawal.poolDataConfirmsTheNoteIsSpent')
                  : unknown
                  ? t('privacy.withdrawal.unknownHelp')
                  : jobId && !hash
                  ? t('privacy.withdrawal.acceptedHelp')
                  : t('privacy.withdrawal.submittedHelp')}
              </Text>
              {hash && (
                <Card style={s.card}>
                  <Text style={s.label}>{t('privacy.deposit.txHash')}</Text>
                  <Text selectable style={s.address}>
                    {hash}
                  </Text>
                </Card>
              )}
              {jobId && (
                <Card style={s.card}>
                  <Text style={s.label}>{t('privacy.withdrawal.jobId')}</Text>
                  <Text selectable style={s.address}>
                    {jobId}
                  </Text>
                </Card>
              )}
              <Button
                title={state.checking ? t('mobile.recoveryDevices.guardianPolicy.checkingStatus') : t('privacy.withdrawal.checkStatus')}
                variant="secondary" size="compact"
                disabled={busy}
                onPress={() => {
                  void controller.refresh().catch(() => undefined);
                }}
              />
            </>
          )}
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  denomination: { fontSize: 32, fontWeight: '600', color: colors.text },
  label: { fontWeight: '600', color: colors.text },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    color: colors.text,
    fontSize: 14,
  },
  card: { padding: 16, gap: 10 },
  address: { fontSize: 13, lineHeight: 20, flexShrink: 1 },
  option: {
    minHeight: 48,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
  },
  optionLabel: { color: colors.text, fontSize: 16 },
  selected: { backgroundColor: colors.raised },
  error: { color: colors.red },
});
