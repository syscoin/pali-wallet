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
import type { NativePrivateDeposit as DepositController } from '../custody/privateDeposit';
import { formatBaseUnits } from '../core/amounts';
import { Button, Card, colors, Header, Screen, Text } from '../ui';
import { recordIdleActivity } from '../platform/security';
import { IdlePressable } from './IdleActivityBoundary';

type Props = {
  open(
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<DepositController>;
  onBack(): void;
  onBackup(): void;
  onActivity?(hash: string): void;
};
type Owner = {
  live: boolean;
  returning?: boolean;
  abort: AbortController;
  controller?: DepositController;
  opening?: Promise<void>;
  disposing?: Promise<void>;
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
}: Props) {
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
  const backup = useCallback(() => {
    leave(callbacks.current.onBackup);
  }, [leave]);
  const activity = useCallback(
    (hash: string) => {
      const action = callbacks.current.onActivity;
      if (action) leave(() => action(hash));
    },
    [leave]
  );
  useEffect(() => {
    const current: Owner = { live: true, abort: new AbortController() };
    owner.current = current;
    const check = () => {
      if (
        !current.live ||
        current.abort.signal.aborted ||
        AppState.currentState !== 'active'
      )
        throw new Error('privacy_cancelled');
    };
    current.opening = open(current.abort.signal, check).then(
      (controller) => {
        current.controller = controller;
        if (current.live) setOpened({ source: open, controller });
      },
      () => {
        if (current.live) setOpened({ source: open, failed: true });
      }
    );
    const change = AppState.addEventListener('change', (state) => {
      if (state !== 'active') back();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', back)
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
        onActivity={onActivity ? activity : undefined}
      />
    );
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <Screen
        footer={
          <Button
            title="Close"
            variant="quiet"
            disabled={current?.closing}
            onPress={back}
          />
        }
      >
        <Header title="Deposit to pool" onBack={back} />
        {current?.failed ? (
          <Text accessibilityRole="alert" style={s.muted}>
            This deposit could not be opened. Return to your wallet and try
            again.
          </Text>
        ) : current?.closing ? (
          <Text style={s.muted}>Closing deposit…</Text>
        ) : (
          <ActivityIndicator
            accessibilityLabel="Opening deposit"
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
}: {
  controller: DepositController;
  onBack(): void;
  onBackup(): void;
  onActivity?: Props['onActivity'];
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [poolId, setPoolId] = useState<PrivacyPoolId>(PRIVACY_POOLS[0]!.id);
  const [choosing, setChoosing] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [expiredIntent, setExpiredIntent] = useState<string | null>(null);
  const options = useRef(
    new Map<PrivacyPoolId, React.ComponentRef<typeof IdlePressable>>()
  );
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
    void controller.prepare({ poolId }).catch(() => undefined);
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
      ? 'This review expired. Refresh to check fees again.'
      : state.error === 'pending'
      ? 'This note has an unresolved deposit. Check Activity before continuing.'
      : state.error === 'unavailable'
      ? 'This deposit is unavailable. Check your account and network.'
      : state.error === 'failed'
      ? result
        ? 'Could not check the pool status. Try again.'
        : 'Could not prepare this deposit. Check your network and funds, then retry.'
      : null;
  const feedback = error && (
    <Text accessibilityRole="alert" style={s.error}>
      {error}
    </Text>
  );
  const primary = result ? (
    <Button title="Done" onPress={onBack} />
  ) : showReview && review ? (
    <Button
      title={
        busy
          ? 'Submitting…'
          : needsRefresh
          ? 'Refresh review'
          : 'Confirm deposit'
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
      title={busy ? 'Preparing review…' : 'Review deposit'}
      disabled={busy}
      onPress={prepare}
    />
  );
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <Screen
        footer={
          <>
            {primary}
            {!result && (
              <Button title="Close" variant="quiet" onPress={onBack} />
            )}
          </>
        }
      >
        <Header
          title={
            result
              ? state.status?.phase === 'verified'
                ? 'Deposit verified'
                : 'Deposit status'
              : showReview
              ? 'Review deposit'
              : 'Deposit to pool'
          }
          onBack={onBack}
        />
        {!showReview && !result && feedback}
        {!showReview && !result && (
          <>
            <Text style={s.muted}>Choose an Ethereum privacy pool.</Text>
            <Card
              style={s.options}
              accessibilityRole="radiogroup"
              accessibilityLabel="Deposit amount"
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
              <Text style={s.muted}>Ethereum privacy pool</Text>
            </View>
            <Card style={s.card}>
              <Text style={s.label}>From account</Text>
              <Text selectable style={s.address}>
                {review.account.address}
              </Text>
              <Text style={s.label}>Pool contract</Text>
              <Text selectable style={s.address}>
                {review.poolAddress}
              </Text>
              <View style={s.divider} />
              <Text style={s.label}>Maximum network fee</Text>
              <Text selectable style={s.value}>
                {amount(review.maxNetworkFeeWei)}
              </Text>
              <Text style={s.label}>Maximum total</Text>
              <Text selectable style={s.total}>
                {amount(review.maxTotalWei)}
              </Text>
              <Button
                title={
                  details === review.intentId
                    ? 'Hide transaction details'
                    : 'View transaction details'
                }
                variant="quiet"
                expanded={details === review.intentId}
                onPress={() =>
                  setDetails(
                    details === review.intentId ? null : review.intentId
                  )
                }
              />
              {details === review.intentId && (
                <View style={s.review}>
                  <Text style={s.label}>Nonce</Text>
                  <Text selectable>{review.nonce}</Text>
                  <Text style={s.label}>Gas limit</Text>
                  <Text selectable>{review.gasLimit}</Text>
                  <Text style={s.label}>
                    {review.feeMode === 'legacy'
                      ? 'Gas price'
                      : 'Maximum fee per gas'}
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
                      <Text style={s.label}>Maximum priority fee per gas</Text>
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
                Keep a private backup of this note. Your recovery phrase cannot
                restore it.
              </Text>
              <Button
                title="Back up private notes"
                variant="quiet"
                disabled={busy}
                onPress={onBackup}
              />
              <IdlePressable
                accessibilityRole="checkbox"
                accessibilityLabel="I understand that I need the note backup to withdraw"
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
                  I understand that I need the note backup to withdraw.
                </Text>
              </IdlePressable>
            </View>
            {!busy && (
              <Button
                title="Change amount"
                variant="quiet"
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
                  ? 'Verified in pool history'
                  : state.status?.phase === 'spent'
                  ? 'Note already spent'
                  : result.phase === 'submitted'
                  ? 'Transaction submitted'
                  : 'Submission status unknown'}
              </Text>
            </View>
            <Text style={s.muted}>
              {state.status?.phase === 'verified'
                ? 'The deposit is present in the verified pool history.'
                : state.status?.phase === 'spent'
                ? 'This note has already been withdrawn.'
                : result.phase === 'submitted'
                ? 'Your note is saved. Check the pool status to verify the deposit.'
                : 'Your note is saved. Check Activity before trying another deposit.'}
            </Text>
            {hash && (
              <Card style={s.card}>
                <Text style={s.label}>Transaction hash</Text>
                <Text selectable style={s.address}>
                  {hash}
                </Text>
              </Card>
            )}
            {state.status?.phase === 'not-found' && (
              <Text style={s.muted}>
                This deposit is not present in the current verified pool
                history.
              </Text>
            )}
            {state.status?.phase === 'waiting' && (
              <Text style={s.muted}>Pool verification is still pending.</Text>
            )}
            <Button
              title={busy ? 'Checking pool…' : 'Check pool status'}
              variant="secondary"
              disabled={busy}
              onPress={() => {
                void controller.refresh().catch(() => undefined);
              }}
            />
            {feedback}
            {hash && onActivity && (
              <Button
                title="View in Activity"
                variant="quiet"
                onPress={() => onActivity(hash)}
              />
            )}
            <Button
              title="Back up private notes"
              variant="quiet"
              disabled={busy}
              onPress={onBackup}
            />
          </>
        )}
        {showReview && feedback}
        {expired && !error && showReview && (
          <Text accessibilityRole="alert" style={s.muted}>
            This review expired. Refresh to check fees again.
          </Text>
        )}
        {busy && (
          <ActivityIndicator
            accessibilityLabel={
              result
                ? 'Checking pool status'
                : state.phase === 'submitting'
                ? 'Submitting deposit'
                : 'Preparing deposit'
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
  card: { gap: 8, padding: 18 },
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
