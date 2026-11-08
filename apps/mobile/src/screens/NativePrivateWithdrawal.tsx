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
import { NoteBackupPasswordField } from './NoteBackupPasswordField';

type Props = {
  note: NativeSavedNote;
  open(signal: AbortSignal, assertCurrent: () => void): Promise<WithdrawalView>;
  onBack(): void;
};
type Owner = {
  live: boolean;
  returning?: boolean;
  abort: AbortController;
  controller?: WithdrawalView;
  opening?: Promise<void>;
  disposing?: Promise<void>;
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

export function NativePrivateWithdrawal({ note, open, onBack }: Props) {
  const owner = useRef<Owner | undefined>(undefined);
  const [opened, setOpened] = useState<{
    source: Props['open'];
    controller?: WithdrawalView;
    failed?: true;
    closing?: true;
  }>();
  const back = useCallback(() => {
    const current = owner.current;
    if (!current?.live) return;
    current.live = false;
    current.returning = true;
    current.abort.abort();
    setOpened({ source: open, closing: true });
    Keyboard.dismiss();
    void disposeOwner(current)
      .catch(() => undefined)
      .then(() => {
        if (owner.current === current && current.returning) onBack();
      });
  }, [onBack, open]);
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
    const change = AppState.addEventListener('change', (next) => {
      if (next !== 'active') back();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', back)
        : undefined;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => {
      current.live = false;
      current.returning = false;
      current.abort.abort();
      void disposeOwner(current).catch(() => undefined);
      change.remove();
      blur?.remove();
      hardware.remove();
    };
  }, [back, open]);
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
            title="Cancel"
            variant="quiet"
            disabled={current?.closing}
            onPress={back}
          />
        }
      >
        <Header title="Withdraw note" onBack={back} />
        <Text
          accessibilityRole={current?.failed ? 'alert' : undefined}
          style={styles.muted}
        >
          {current?.failed
            ? 'Could not open this withdrawal. Check the pool data and your network, then try again.'
            : current?.closing
            ? 'Closing withdrawal…'
            : 'Opening withdrawal…'}
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
  const [password, setPassword] = useState('');
  const subscribe = useCallback(
    (notify: () => void) =>
      controller.subscribe(() => {
        setPassword('');
        notify();
      }),
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
      setPassword('');
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
    if (busy || !password) return;
    const entered = password;
    setPassword('');
    Keyboard.dismiss();
    void controller.reviewRestored(entered).catch(() => undefined);
  };
  const title = submitted
    ? state.result?.phase === 'unknown' || state.status?.phase === 'unknown'
      ? 'Submission status unknown'
      : (state.result?.jobId || state.status?.jobId) &&
        !(state.result?.transactionHash || state.status?.transactionHash)
      ? 'Relayer accepted the request'
      : 'Withdrawal submitted'
    : showReview
    ? 'Review withdrawal'
    : 'Withdraw note';
  const hash =
    state.result?.transactionHash ??
    state.status?.transactionHash ??
    state.result?.signedTransactionHash;
  const jobId = state.result?.jobId ?? state.status?.jobId;
  const error =
    state.error === 'expired'
      ? 'This review expired. Prepare a fresh review before confirming.'
      : state.error === 'pending'
      ? 'This note has a saved withdrawal. Check its status before trying again.'
      : state.error === 'verification'
      ? 'Check the pool data before preparing this withdrawal.'
      : state.error === 'restored'
      ? 'Could not review this restored note. Confirm your password and try again.'
      : state.error === 'unavailable'
      ? 'This withdrawal is unavailable in the current account or network.'
      : state.error === 'failed'
      ? 'Could not complete this request. Check the pool data and your network, then try again.'
      : null;
  const needsRefresh = reviewExpired || state.phase === 'failed';
  const primary = submitted ? (
    <Button title="Done" onPress={onBack} />
  ) : state.restored ? (
    <Button
      title={busy ? 'Reviewing note…' : 'Review restored note'}
      disabled={busy || !password}
      onPress={reviewRestored}
    />
  ) : showReview ? (
    <Button
      title={
        state.phase === 'submitting'
          ? 'Submitting…'
          : needsRefresh
          ? 'Refresh review'
          : 'Confirm withdrawal'
      }
      disabled={busy}
      onPress={needsRefresh ? prepare : confirm}
    />
  ) : (
    <Button
      title={
        state.phase === 'preparing' ? 'Preparing proof…' : 'Review withdrawal'
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
          footer={
            <>
              {primary}
              {!submitted && (
                <Button title="Cancel" variant="quiet" onPress={onBack} />
              )}
            </>
          }
        >
          <Header title={title} onBack={onBack} />
          <Text style={s.denomination}>{note.amount} ETH</Text>
          <Text style={styles.muted}>Ethereum Mainnet · Private note</Text>
          {error && (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          )}
          {state.restored && !submitted ? (
            <>
              <Text style={styles.muted}>
                Review this restored note before withdrawing.
              </Text>
              <NoteBackupPasswordField
                label="Confirm your wallet password"
                value={password}
                onChange={setPassword}
                busy={busy}
              />
            </>
          ) : !showReview && !submitted ? (
            <>
              <Text style={s.label}>Recipient address</Text>
              <IdleTextInput
                accessibilityLabel="Recipient address"
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
                  Enter a valid Ethereum address.
                </Text>
              )}
              <Text style={s.label}>Send with</Text>
              <Card
                accessibilityRole="radiogroup"
                accessibilityLabel="Withdrawal delivery"
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
                      item === 'direct' ? 'Direct' : 'Relayer'
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
                      {item === 'direct' ? 'Direct' : 'Relayer'}
                    </Text>
                    <Text aria-hidden>{mode === item ? '●' : '○'}</Text>
                  </IdlePressable>
                ))}
              </Card>
              {!state.canSign && (
                <Text style={styles.muted}>
                  This account cannot sign a direct withdrawal.
                </Text>
              )}
              <Text style={styles.muted}>
                {mode === 'direct'
                  ? 'Your account pays gas. This can link the gas payer to the recipient.'
                  : 'The selected relayer learns the recipient and receives the fee.'}
              </Text>
              {mode === 'relayed' && (
                <>
                  <Text style={s.label}>Relayer</Text>
                  {state.relayers.length === 0 && (
                    <Text style={styles.muted}>
                      {state.checking
                        ? 'Loading relayers…'
                        : 'No available relayers support this pool.'}
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
                          : ' · Unavailable'
                      }`}
                      variant={
                        relayerId === relayer.id ? 'primary' : 'secondary'
                      }
                      disabled={busy || relayer.health !== 'reported-healthy'}
                      onPress={() => setRelayerId(relayer.id)}
                    />
                  ))}
                  <Button
                    title="Refresh relayers"
                    variant="quiet"
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
                      state.checking ? 'Checking pool…' : 'Check pool status'
                    }
                    variant="secondary"
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
                  ? 'Loading proof resources…'
                  : state.progress?.stage === 'witness'
                  ? 'Preparing witness…'
                  : state.progress?.stage === 'verifying'
                  ? 'Checking proof…'
                  : 'Preparing proof…'}
              </Text>
              <Text style={styles.muted}>
                Preparing a proof locally. This may take up to two minutes.
              </Text>
            </Card>
          )}
          {showReview && review && (
            <>
              <Card style={s.card}>
                <Text style={s.label}>Recipient address</Text>
                <Text selectable style={s.address}>
                  {review.recipient}
                </Text>
                <Text style={s.label}>
                  {review.mode === 'direct' ? 'Gas payer' : 'Relayer'}
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
                <Text style={s.label}>Pool amount</Text>
                <Text selectable>{review.amount} ETH</Text>
                <Text style={s.label}>Maximum network fee</Text>
                <Text selectable>{amount(review.maxNetworkFeeWei)}</Text>
                {review.mode === 'relayed' && (
                  <>
                    <Text style={s.label}>Relayer service fee</Text>
                    <Text selectable>{amount(review.serviceFeeWei)}</Text>
                    <Text style={s.label}>Total fee from note</Text>
                    <Text selectable>{amount(review.feeWei)}</Text>
                  </>
                )}
                <Text style={s.label}>Recipient receives</Text>
                <Text selectable>{amount(review.receiveWei)}</Text>
              </Card>
              <Text style={styles.muted}>
                {review.mode === 'direct'
                  ? 'Your account pays gas. This can link the gas payer to the recipient.'
                  : 'The selected relayer learns the recipient and receives the fee.'}
              </Text>
              {reviewExpired && (
                <Text accessibilityLiveRegion="polite" style={styles.muted}>
                  This review expired. Prepare a fresh review before confirming.
                </Text>
              )}
              <Button
                title="Edit withdrawal"
                variant="quiet"
                disabled={busy}
                onPress={() => setEditing(true)}
              />
            </>
          )}
          {submitted && (
            <>
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                {state.result?.phase === 'unknown' ||
                state.status?.phase === 'unknown'
                  ? 'Do not submit again. Check the transaction or relayer status before another withdrawal.'
                  : jobId && !hash
                  ? 'The relayer has a job ID. This does not mean the withdrawal is mined.'
                  : 'Wait for public pool data to confirm the withdrawal.'}
              </Text>
              {hash && (
                <Card style={s.card}>
                  <Text style={s.label}>Transaction hash</Text>
                  <Text selectable style={s.address}>
                    {hash}
                  </Text>
                </Card>
              )}
              {jobId && (
                <Card style={s.card}>
                  <Text style={s.label}>Relayer job ID</Text>
                  <Text selectable style={s.address}>
                    {jobId}
                  </Text>
                </Card>
              )}
              {state.noteStatus?.phase === 'spent' && (
                <Text accessibilityLiveRegion="polite">
                  Note already spent.
                </Text>
              )}
              <Button
                title={state.checking ? 'Checking status…' : 'Check status'}
                variant="secondary"
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
