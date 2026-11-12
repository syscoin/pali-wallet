import { useNativeTranslation } from '../platform/localization';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  type KeyDownEvent,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PRIVACY_POOLS } from '../../../../source/utils/privacy/registry';
import type { PrivacyPoolId } from '../../../../source/utils/privacy/types';
import type { NativePrivateDepositView as DepositController } from '../custody/privateDeposit';
import { formatBaseUnits } from '../core/amounts';
import { Button, Card, colors, Header, Screen, Text } from '../ui';
import { recordIdleActivity } from '../platform/security';
import { IdlePressable } from './IdleActivityBoundary';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

export type NativePrivateDepositTask = Readonly<{ poolId: PrivacyPoolId; noteId: string }>;

type Props = {
  open(
    signal: AbortSignal,
    assertCurrent: () => void,
    authentication: NativePrivateAuthenticationScope
  ): Promise<DepositController>;
  onBack(): void;
  onBackup(task?: NativePrivateDepositTask): void;
  initialTask?: NativePrivateDepositTask;
  onActivity?(hash: string): void;
};
type Owner = {
  live: boolean;
  returning?: boolean;
  abort: AbortController;
  controller?: DepositController;
  opening?: Promise<void>;
  disposing?: Promise<void>;
  authentication: NativePrivateAuthenticationScope;
};
function disposeOwner(owner: Owner): Promise<void> {
  owner.disposing ??= Promise.resolve(owner.opening).then(async () => {
    await owner.controller?.dispose();
  });
  return owner.disposing;
}

export function NativePrivateDeposit({
  open,
  onBack,
  onBackup,
  onActivity,
  initialTask,
}: Props) {
  const { t } = useNativeTranslation();
  const owner = useRef<Owner | undefined>(undefined);
  const [opened, setOpened] = useState<{
    source: Props['open'];
    controller?: DepositController;
    failed?: true;
    closing?: true;
  }>();
  const callbacks = useRef({ onBack, onBackup, onActivity });
  useLayoutEffect(() => {
    callbacks.current = { onBack, onBackup, onActivity };
  }, [onBack, onBackup, onActivity]);
  const leave = useCallback(
    (action: () => void) => {
      const current = owner.current;
      if (!current?.live) return;
      current.live = false;
      current.authentication.retire();
      current.returning = true;
      current.abort.abort();
      setOpened({ source: open, closing: true });
      void disposeOwner(current)
        .catch(() => undefined)
        .then(() => {
          if (owner.current === current && current.returning) action();
        });
    },
    [open]
  );
  const back = useCallback(() => {
    leave(callbacks.current.onBack);
  }, [leave]);
  const backup = useCallback((task?: NativePrivateDepositTask) => {
    const captured = task && Object.freeze({ poolId: task.poolId, noteId: task.noteId });
    leave(() => callbacks.current.onBackup(captured));
  }, [leave]);
  const activity = useCallback(
    (hash: string) => {
      const action = callbacks.current.onActivity;
      if (action) leave(() => action(hash));
    },
    [leave]
  );
  useEffect(() => {
    const current: Owner = { live: true, abort: new AbortController(), authentication: createNativePrivateAuthenticationScope() };
    owner.current = current;
    const check = () => {
      if (
        owner.current !== current || !current.live ||
        current.abort.signal.aborted ||
        (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication, AppState.currentState))
      )
        throw new Error('privacy_cancelled');
    };
    current.opening = open(current.abort.signal, check, current.authentication).then(
      (controller) => {
        current.controller = controller;
        if (current.live && AppState.currentState === 'active') setOpened({ source: open, controller });
        else { current.live = false; current.authentication.retire(); current.abort.abort(); return controller.dispose().catch(() => undefined); }
      },
      () => {
        if (current.live && AppState.currentState === 'active') setOpened({ source: open, failed: true });
      }
    );
    const change = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication, state)) back();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => { if (!allowsPrivateAuthenticationInterruption(current.authentication, 'blur')) back(); })
        : undefined;
    const hardwareBack = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        back();
        return true;
      }
    );
    return () => {
      current.live = false;
      current.authentication.retire();
      current.returning = false;
      current.abort.abort();
      void disposeOwner(current).catch(() => undefined);
      change.remove();
      blur?.remove();
      hardwareBack.remove();
    };
  }, [back, open]);
  const current = opened?.source === open ? opened : undefined;
  if (current?.controller)
    return (
      <DepositContent
        controller={current.controller}
        onBack={back}
        onBackup={backup}
        initialTask={initialTask}
        onActivity={onActivity ? activity : undefined}
      />
    );
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <Screen
        footer={
          <Button
            title={t('buttons.close')}
            variant="secondary" size="compact"
            disabled={current?.closing}
            onPress={back}
          />
        }
      >
        <Header title={t('privacy.deposit.title')} onBack={back} />
        {current?.failed ? (
          <Text accessibilityRole="alert" style={s.muted}>
            {t('mobile.privacyFlows.deposit.thisDepositCouldNotBeOpenedReturnToYourWallet')}</Text>
        ) : current?.closing ? (
          <Text style={s.muted}>{t('mobile.privacyFlows.deposit.closingDeposit')}</Text>
        ) : (
          <ActivityIndicator
            accessibilityLabel={t('mobile.privacyFlows.deposit.openingDeposit')}
            color={colors.pink}
          />
        )}
      </Screen>
    </SafeAreaView>
  );
}

function DepositContent({
  controller,
  onBack,
  onBackup,
  onActivity,
  initialTask,
}: {
  controller: DepositController;
  onBack(): void;
  onBackup(task?: NativePrivateDepositTask): void;
  initialTask?: NativePrivateDepositTask;
  onActivity?: Props['onActivity'];
}) {
  const { t } = useNativeTranslation();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [poolId, setPoolId] = useState<PrivacyPoolId>(initialTask?.poolId ?? PRIVACY_POOLS[0]!.id);
  const [choosing, setChoosing] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [expiredIntent, setExpiredIntent] = useState<string | null>(null);
  const options = useRef(
    new Map<PrivacyPoolId, React.ComponentRef<typeof IdlePressable>>()
  );
  useEffect(() => {
    if (initialTask) void controller.prepare({ poolId: initialTask.poolId, noteId: initialTask.noteId }).catch(() => undefined);
  }, [controller, initialTask]);
  const review = state.review;
  const result = state.result;
  const busy =
    state.phase === 'preparing' ||
    state.phase === 'submitting' ||
    state.checking;
  const showReview = !!review && !choosing && !result;
  useEffect(() => {
    if (!review) return;
    const timer = setTimeout(
      () => setExpiredIntent(review.intentId),
      Math.max(0, review.expiresAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [review]);
  const prepare = () => {
    setChoosing(false);
    setAcknowledged(null);
    void controller.prepare({ poolId, ...(initialTask?.poolId === poolId ? { noteId: initialTask.noteId } : {}) }).catch(() => undefined);
  };
  const refresh = () => {
    setAcknowledged(null);
    void controller.refresh().catch(() => undefined);
  };
  const amount = (units: string) => `${formatBaseUnits(units, 18)} ETH`;
  const hash = result?.transactionHash ?? result?.signedTransactionHash;
  const expired = !!review && expiredIntent === review.intentId;
  const needsRefresh =
    expired || state.error === 'expired' || state.phase === 'failed';
  const radioKeyboard = (event: KeyDownEvent, index: number) => {
    if (busy) return;
    const key = event.nativeEvent.key;
    let next = index;
    if (key === 'ArrowRight' || key === 'ArrowDown')
      next = (index + 1) % PRIVACY_POOLS.length;
    else if (key === 'ArrowLeft' || key === 'ArrowUp')
      next = (index + PRIVACY_POOLS.length - 1) % PRIVACY_POOLS.length;
    else if (key !== ' ') return;
    event.preventDefault();
    if (!recordIdleActivity()) return;
    const pool = PRIVACY_POOLS[next]!;
    setPoolId(pool.id);
    options.current.get(pool.id)?.focus();
  };
  const toggleAcknowledgement = () => {
    if (review && !busy && !needsRefresh)
      setAcknowledged(
        acknowledged === review.intentId ? null : review.intentId
      );
  };
  const error =
    state.error === 'expired'
      ? t('privacy.deposit.expired')
      : state.error === 'pending'
      ? t('mobile.privacyFlows.deposit.thisNoteHasAnUnresolvedDepositCheckActivityBeforeContinuing')
      : state.error === 'unavailable'
      ? t('mobile.privacyFlows.deposit.thisDepositIsUnavailableCheckYourAccountAndNetwork')
      : state.error === 'failed'
      ? result
        ? t('mobile.privacyFlows.deposit.couldNotCheckThePoolStatusTryAgain')
        : t('privacy.deposit.prepareFailed')
      : null;
  const feedback = error && (
    <Text accessibilityRole="alert" style={s.error}>
      {error}
    </Text>
  );
  const primary = result ? (
    <Button title={t('privacy.deposit.done')} onPress={onBack} />
  ) : showReview && review ? (
    <Button
      title={
        busy
          ? t('privacy.deposit.submitting')
          : needsRefresh
          ? t('privacy.deposit.refresh')
          : t('privacy.deposit.confirm')
      }
      disabled={busy || (!needsRefresh && acknowledged !== review.intentId)}
      onPress={
        needsRefresh
          ? refresh
          : () => {
              void controller.confirm(review.intentId).catch(() => undefined);
            }
      }
    />
  ) : (
    <Button
      title={busy ? t('privacy.deposit.preparing') : t('privacy.deposit.continue')}
      disabled={busy}
      onPress={prepare}
    />
  );
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <Screen
        scrollResetKey={`${state.phase}:${showReview ? review?.intentId : result ? 'result' : 'pool'}`}
        footer={
          <>
            {primary}
            {!result && (
              <Button title={t('buttons.close')} variant="secondary" size="compact" onPress={onBack} />
            )}
          </>
        }
      >
        <Header
          title={
            result
              ? state.status?.phase === 'verified'
                ? t('mobile.privacyFlows.deposit.depositVerified')
                : t('mobile.privacyFlows.deposit.depositStatus')
              : showReview
              ? t('privacy.deposit.continue')
              : t('privacy.deposit.title')
          }
          onBack={onBack}
        />
        {!showReview && !result && feedback}
        {!showReview && !result && (
          <>
            <Text style={s.muted}>{t('mobile.privacyFlows.deposit.chooseAnEthereumPrivacyPool')}</Text>
            <Card
              style={s.options}
              accessibilityRole="radiogroup"
              accessibilityLabel={t('mobile.privacyFlows.deposit.depositAmount')}
            >
              {PRIVACY_POOLS.map((pool, index) => (
                <IdlePressable
                  key={pool.id}
                  accessibilityRole="radio"
                  ref={(option) => {
                    if (option) options.current.set(pool.id, option);
                    else options.current.delete(pool.id);
                  }}
                  {...(Platform.OS === 'web'
                    ? {
                        tabIndex: poolId === pool.id && !busy ? 0 : -1,
                        onKeyDown: (event: KeyDownEvent) =>
                          radioKeyboard(event, index),
                      }
                    : {})}
                  accessibilityLabel={`${pool.amount} ETH pool`}
                  accessibilityState={{
                    checked: poolId === pool.id,
                    disabled: busy,
                  }}
                  aria-checked={poolId === pool.id}
                  disabled={busy}
                  onPress={() => setPoolId(pool.id)}
                  style={[s.option, poolId === pool.id && s.selected]}
                >
                  <Text style={s.optionLabel}>{pool.amount} ETH</Text>
                  <View
                    style={[s.radio, poolId === pool.id && s.radioSelected]}
                  >
                    {poolId === pool.id && <View style={s.radioDot} />}
                  </View>
                </IdlePressable>
              ))}
            </Card>
          </>
        )}
        {showReview && review && (
          <>
            <View style={s.amountBlock}>
              <Text style={s.amount}>{review.amount} ETH</Text>
              <Text style={s.muted}>{t('mobile.privacyFlows.deposit.ethereumPrivacyPool')}</Text>
            </View>
            <Card style={s.card}>
              <Text style={s.label}>{t('privacy.deposit.account')}</Text>
              <Text selectable style={s.address}>
                {review.account.address}
              </Text>
              <Text style={s.label}>{t('privacy.deposit.pool')}</Text>
              <Text selectable style={s.address}>
                {review.poolAddress}
              </Text>
              <View style={s.divider} />
              <Text style={s.label}>{t('privacy.deposit.networkFee')}</Text>
              <Text selectable style={s.value}>
                {amount(review.maxNetworkFeeWei)}
              </Text>
              <Text style={s.label}>{t('privacy.deposit.total')}</Text>
              <Text selectable style={s.total}>
                {amount(review.maxTotalWei)}
              </Text>
              <Button
                title={
                  details === review.intentId
                    ? t('mobile.privacyFlows.deposit.hideTransactionDetails')
                    : t('mobile.privacyFlows.deposit.viewTransactionDetails')
                }
                variant="quiet" size="compact"
                expanded={details === review.intentId}
                onPress={() =>
                  setDetails(
                    details === review.intentId ? null : review.intentId
                  )
                }
              />
              {details === review.intentId && (
                <View style={s.review}>
                  <Text style={s.label}>{t('transactionDisplay.nonce')}</Text>
                  <Text selectable>{review.nonce}</Text>
                  <Text style={s.label}>{t('send.gasLimit')}</Text>
                  <Text selectable>{review.gasLimit}</Text>
                  <Text style={s.label}>
                    {review.feeMode === 'legacy'
                      ? t('mobile.privacyFlows.deposit.gasPrice')
                      : t('mobile.privacyFlows.deposit.maximumFeePerGas')}
                  </Text>
                  <Text selectable>
                    {formatBaseUnits(
                      review.gasPrice ?? review.maxFeePerGas!,
                      9
                    )}{' '}
                    gwei
                  </Text>
                  {review.maxPriorityFeePerGas && (
                    <>
                      <Text style={s.label}>{t('mobile.privacyFlows.deposit.maximumPriorityFeePerGas')}</Text>
                      <Text selectable>
                        {formatBaseUnits(review.maxPriorityFeePerGas, 9)} gwei
                      </Text>
                    </>
                  )}
                </View>
              )}
            </Card>
            <View style={s.backup}>
              <Text style={s.muted}>
                {t('mobile.privacyFlows.deposit.keepAPrivateBackupOfThisNoteYourRecoveryPhrase')}</Text>
              <Button icon="shield"
                title={t('mobile.noteFlows.export.backUpPrivateNotes')}
                variant="secondary" size="compact"
                disabled={busy}
                onPress={() => {
                  if (busy || controller.getSnapshot().review !== review || controller.getSnapshot().phase !== 'review') return;
                  onBackup(Object.freeze({ poolId: review.poolId, noteId: review.noteId }));
                }}
              />
              <IdlePressable
                accessibilityRole="checkbox"
                accessibilityLabel={t('mobile.privacyFlows.deposit.iUnderstandThatINeedTheNoteBackupToWithdraw')}
                accessibilityState={{
                  checked: acknowledged === review.intentId,
                  disabled: busy || needsRefresh,
                }}
                aria-checked={acknowledged === review.intentId}
                {...(Platform.OS === 'web'
                  ? {
                      onKeyDown: (event: KeyDownEvent) => {
                        if (event.nativeEvent.key === ' ') {
                          event.preventDefault();
                          if (recordIdleActivity()) toggleAcknowledgement();
                        }
                      },
                    }
                  : {})}
                disabled={busy || needsRefresh}
                onPress={toggleAcknowledgement}
                style={s.acknowledgement}
              >
                <View
                  style={[
                    s.checkbox,
                    acknowledged === review.intentId && s.checked,
                  ]}
                >
                  <Text style={s.checkmark}>
                    {acknowledged === review.intentId ? '✓' : ''}
                  </Text>
                </View>
                <Text style={s.acknowledgementText}>
                  {t('privacy.deposit.backupAck')}</Text>
              </IdlePressable>
            </View>
            {!busy && (
              <Button icon="edit"
                title={t('privacy.deposit.changeAmount')}
                variant="secondary" size="compact"
                onPress={() => {
                  setChoosing(true);
                  setAcknowledged(null);
                }}
              />
            )}
          </>
        )}
        {result && (
          <>
            <View style={s.amountBlock}>
              <Text style={s.amount}>
                {review?.amount ??
                  PRIVACY_POOLS.find((pool) => pool.id === poolId)?.amount}{' '}
                ETH
              </Text>
              <Text accessibilityLiveRegion="polite" style={s.muted}>
                {state.status?.phase === 'verified'
                  ? t('mobile.noteFlows.import.verifiedInPoolHistory')
                  : state.status?.phase === 'spent'
                  ? t('mobile.privacyFlows.deposit.noteAlreadySpent')
                  : result.phase === 'submitted'
                  ? t('privacy.deposit.submitted')
                  : t('privacy.deposit.unknown')}
              </Text>
            </View>
            <Text style={s.muted}>
              {state.status?.phase === 'verified'
                ? t('mobile.privacyFlows.deposit.theDepositIsPresentInTheVerifiedPoolHistory')
                : state.status?.phase === 'spent'
                ? t('mobile.privacyFlows.deposit.thisNoteHasAlreadyBeenWithdrawn')
                : result.phase === 'submitted'
                ? t('mobile.privacyFlows.deposit.yourNoteIsSavedCheckThePoolStatusToVerify')
                : t('mobile.privacyFlows.deposit.yourNoteIsSavedCheckActivityBeforeTryingAnotherDeposit')}
            </Text>
            {hash && (
              <Card style={s.card}>
                <Text style={s.label}>{t('privacy.deposit.txHash')}</Text>
                <Text selectable style={s.address}>
                  {hash}
                </Text>
              </Card>
            )}
            {state.status?.phase === 'not-found' && (
              <Text style={s.muted}>
                {t('mobile.privacyFlows.deposit.thisDepositIsNotPresentInTheCurrentVerifiedPool')}</Text>
            )}
            {state.status?.phase === 'waiting' && (
              <Text style={s.muted}>{t('mobile.privacyFlows.deposit.poolVerificationIsStillPending')}</Text>
            )}
            <Button
              title={busy ? t('mobile.noteFlows.import.checkingPool') : t('mobile.noteFlows.inventory.checkPoolStatus')}
              variant="secondary" size="compact"
              disabled={busy}
              onPress={() => {
                void controller.refresh().catch(() => undefined);
              }}
            />
            {feedback}
            {hash && onActivity && (
              <Button icon="activity"
                title={t('mobile.privacyFlows.deposit.viewInActivity')}
                variant="secondary" size="compact"
                onPress={() => onActivity(hash)}
              />
            )}
            <Button icon="shield"
              title={t('mobile.noteFlows.export.backUpPrivateNotes')}
              variant="secondary" size="compact"
              disabled={busy}
              onPress={() => onBackup()}
            />
          </>
        )}
        {showReview && feedback}
        {expired && !error && showReview && (
          <Text accessibilityRole="alert" style={s.muted}>
            {t('privacy.deposit.expired')}</Text>
        )}
        {busy && (
          <ActivityIndicator
            accessibilityLabel={
              result
                ? t('mobile.privacyFlows.deposit.checkingPoolStatus')
                : state.phase === 'submitting'
                ? t('mobile.privacyFlows.deposit.submittingDeposit')
                : t('mobile.privacyFlows.deposit.preparingDeposit')
            }
            color={colors.pink}
          />
        )}
      </Screen>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  options: { padding: 6, gap: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 60,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  selected: { backgroundColor: colors.raised },
  optionLabel: { fontSize: 18, lineHeight: 25, fontWeight: '600' },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.pink },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.pink,
  },
  amountBlock: { gap: 6, paddingVertical: 8 },
  amount: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '700',
    letterSpacing: -0.7,
  },
  review: { gap: 8 },
  card: { gap: 8, padding: 16 },
  label: { fontSize: 12, lineHeight: 17, color: colors.muted },
  address: { fontSize: 13, lineHeight: 20 },
  value: { fontSize: 16, lineHeight: 23 },
  total: { fontSize: 19, lineHeight: 27, fontWeight: '600' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  backup: { gap: 4 },
  acknowledgement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
  },
  acknowledgementText: { flex: 1, fontSize: 14, lineHeight: 21 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: { backgroundColor: colors.pink, borderColor: colors.pink },
  checkmark: { color: colors.bg, fontWeight: '700' },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
