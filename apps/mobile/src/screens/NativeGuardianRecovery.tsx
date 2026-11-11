import { guardianRecoveryTerminalNotice } from '../../../../source/utils/smartAccount/guardianRecoveryLifecycle';
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
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { GuardianRecoveryObservation } from '../../../../source/utils/smartAccount/guardianStatus';
import type {
  NativeGuardianRecoveryController,
  NativeGuardianRecoveryChoice,
  NativeGuardianRecoveryChoices,
  NativeGuardianRecoveryDraft,
} from '../smartAccount/guardianRecovery';
import { formatBaseUnits } from '../core/amounts';
import { useNativeTranslation } from '../platform/localization';
import {
  Button,
  Card,
  colors,
  Header,
  Icon,
  Notice,
  Screen,
  Text,
  styles,
} from '../ui';
import { IdlePressable, IdleTextInput } from './IdleActivityBoundary';
import { TransactionDetails } from './NativeTransactionReview';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

export type NativeGuardianRecoveryTool = NativeGuardianRecoveryChoices & {
  chainId: number;
  currency: string;
  hasIntent: boolean;
  open(
    draft: NativeGuardianRecoveryDraft,
    signal: AbortSignal,
    assertCurrent: () => void,
    authentication: NativePrivateAuthenticationScope
  ): Promise<NativeGuardianRecoveryController>;
  onActivity(payerId: string, chainId: number, hash: string): Promise<void>;
  openRecoveryAlerts(): Promise<void>;
};

export function NativeGuardianRecovery({
  address,
  networkLabel,
  observation,
  recovery,
  lifetime,
  onBack,
}: {
  address: string;
  networkLabel: string;
  observation: GuardianRecoveryObservation | null;
  recovery: NativeGuardianRecoveryTool;
  lifetime: AbortSignal;
  onBack(): void;
}) {
  const { t } = useNativeTranslation();
  const [port] = useState(recovery);
  const policySupported =
    observation?.exists === true && observation.threshold === 1;
  const guardians = port.guardians.filter((account) =>
    observation?.guardians.some(
      (guardian) => guardian.toLowerCase() === account.address.toLowerCase()
    )
  );
  const [guardianId, setGuardianId] = useState(guardians[0]?.id ?? '');
  const [replacementId, setReplacementId] = useState('');
  const [replacementKind, setReplacementKind] = useState<'software' | 'passkey'>('software');
  const [passkeyNotVerified, setPasskeyNotVerified] = useState(false);
  const [payerId, setPayerId] = useState(
    () =>
      port.payers.find((account) => account.id === guardians[0]?.id)?.id ??
      port.payers[0]?.id ??
      ''
  );
  const [choosing, setChoosing] = useState<
    'guardian' | 'replacement' | 'payer' | null
  >(null);
  const [search, setSearch] = useState('');
  const [controller, setController] =
    useState<NativeGuardianRecoveryController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const owner = useRef({
    live: false,
    busy: false,
    controller: null as NativeGuardianRecoveryController | null,
    authentication: null as NativePrivateAuthenticationScope | null,
  });
  const latestBack = useRef(onBack);
  useLayoutEffect(() => { latestBack.current = onBack; }, [onBack]);
  const back = useCallback(() => {
    const current = owner.current;
    if (!current.live) return;
    current.live = false;
    current.authentication?.retire();
    current.controller?.dispose();
    latestBack.current();
  }, []);
  useLayoutEffect(() => {
    const current = { live: !lifetime.aborted, busy: false, controller: null as NativeGuardianRecoveryController | null,
      authentication: createNativePrivateAuthenticationScope() };
    owner.current = current;
    const retire = () => {
      current.live = false;
      current.authentication.retire();
      current.controller?.dispose();
    };
    lifetime.addEventListener('abort', retire, { once: true });
    if (lifetime.aborted) retire();
    const change = AppState.addEventListener('change', state => { if (state !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication, state)) back(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => { if (!allowsPrivateAuthenticationInterruption(current.authentication, 'blur')) back(); }) : undefined;
    return () => {
      lifetime.removeEventListener('abort', retire);
      retire();
      change.remove(); blur?.remove();
    };
  }, [lifetime, back]);
  const openRecoveryAlerts = useCallback(async () => {
    if (!owner.current.live || lifetime.aborted) throw Error('CANCELLED');
    await port.openRecoveryAlerts();
  }, [port, lifetime]);
  const onActivity = useCallback(
    async (payerId: string, chainId: number, hash: string) => {
      if (!owner.current.live || lifetime.aborted) throw Error('CANCELLED');
      await port.onActivity(payerId, chainId, hash);
    },
    [port, lifetime]
  );
  const open = useCallback(
    async (draft: NativeGuardianRecoveryDraft) => {
      const current = owner.current;
      if (
        draft.kind === 'start' &&
        (!policySupported ||
          !port.guardians.some(
            (account) =>
              account.id === draft.guardianId &&
              observation?.guardians.some(
                (guardian) =>
                  guardian.toLowerCase() === account.address.toLowerCase()
              )
          ) ||
          !(draft.replacement.kind === 'passkey' ? port.passkeysAvailable : port.replacements.some(
            (account) => account.id === (draft.replacement.kind === 'software' ? draft.replacement.accountId : '')
          )) ||
          !port.payers.some((account) => account.id === draft.payerId))
      )
        return;
      if (!current.live || current.busy || !current.authentication || lifetime.aborted || AppState.currentState !== 'active') return;
      current.busy = true;
      setBusy(true);
      setError(''); setPasskeyNotVerified(false);
      const check = () => {
        if (!current.live || lifetime.aborted ||
            (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication!, AppState.currentState))) throw Error('CANCELLED');
      };
      try {
        const next = await port.open(draft, lifetime, check, current.authentication);
        if (!current.live || lifetime.aborted) {
          next.dispose();
          return;
        }
        current.controller = next;
        setController(next);
      } catch (failure) {
        if (current.live && (failure as {code?:string})?.code === 'PASSKEY_POSSESSION_FAILED') setPasskeyNotVerified(true);
        else if (current.live)
          setError(
            'Recovery could not be opened. Check the current policy and try again.'
          );
      } finally {
        current.busy = false;
        if (current.live) setBusy(false);
      }
    },
    [
      port,
      lifetime,
      policySupported,
      observation,
      setBusy,
      setController,
      setError,
    ]
  );
  useEffect(() => {
    if (port.hasIntent) void open({ kind: 'resume' });
  }, [port, open]);
  useEffect(() => {
    if (!choosing) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      setChoosing(null);
      setSearch('');
      return true;
    });
    return () => back.remove();
  }, [choosing]);
  if (choosing) {
    const options = (
      choosing === 'guardian'
        ? guardians
        : choosing === 'replacement'
        ? port.replacements
        : port.payers
    ).filter((account) =>
      `${account.label} ${account.address}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    );
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={s.safe}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Header
            title={
              choosing === 'guardian'
                ? 'Choose guardian'
                : choosing === 'replacement'
                ? 'Choose replacement owner'
                : 'Choose fee payer'
            }
            onBack={() => {
              setChoosing(null);
              setSearch('');
            }}
          />
          <IdleTextInput
            accessibilityLabel="Search wallet accounts"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            style={s.search}
          />
          <FlatList
            data={options}
            keyExtractor={(account) => account.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.choices}
            ListEmptyComponent={
              <Text style={styles.muted}>No matching wallet accounts</Text>
            }
            renderItem={({ item }) => (
              <AccountChoice
                account={item}
                selected={
                  (choosing === 'guardian'
                    ? guardianId
                    : choosing === 'replacement'
                    ? replacementId
                    : payerId) === item.id
                }
                disabled={false}
                onPress={() => {
                  if (choosing === 'guardian') setGuardianId(item.id);
                  else if (choosing === 'replacement')
                    setReplacementId(item.id);
                  else setPayerId(item.id);
                  setChoosing(null);
                  setSearch('');
                }}
              />
            )}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }
  if (controller)
    return (
      <NativeGuardianRecoveryView
        controller={controller}
        address={address}
        chainId={port.chainId}
        currency={port.currency}
        networkLabel={networkLabel}
        onActivity={onActivity}
        openRecoveryAlerts={openRecoveryAlerts}
        onBack={back}
      />
    );
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <Screen
        footer={
          <>
            {!port.hasIntent && (
              <Button
                title="Review recovery"
                disabled={
                  busy ||
                  !policySupported ||
                  !guardianId ||
                  (replacementKind === 'software' && !replacementId) ||
                  !payerId
                }
                onPress={() =>
                  void open({
                    kind: 'start',
                    guardianId,
                    replacement: replacementKind === 'passkey' ? {kind:'passkey',recreate:false} : {kind:'software',accountId:replacementId},
                    payerId,
                  })
                }
              />
            )}{' '}
            <Button
              title="Close"
              variant="secondary"
              size="compact"
              onPress={back}
            />
          </>
        }
      >
        <Header
          title="Recover smart account"
          subtitle={networkLabel}
          onBack={back}
        />
        <Card style={s.card}>
          <Text style={s.label}>Smart account · Chain ID {port.chainId}</Text>
          <Text selectable style={s.address}>
            {address}
          </Text>
        </Card>
        {port.hasIntent ? (
          <Text style={styles.muted}>Opening saved recovery…</Text>
        ) : (
          <>
            <Notice
              title={
                policySupported
                  ? 'Choose the replacement owner'
                  : 'Guardian policy unsupported'
              }
              body={
                policySupported
                  ? 'Recovery replaces the account’s current validator with the wallet key you select. The guardian policy’s waiting period applies before finalization.'
                  : 'Recovery in this wallet currently supports policies that require one guardian. You can still check this account’s recovery status.'
              }
            />
            <Text style={s.heading}>Guardian account</Text>
            {guardians.length ? (
              <>
                <Card style={s.card}>
                  <Text style={s.label}>
                    {
                      guardians.find((account) => account.id === guardianId)
                        ?.label
                    }
                  </Text>
                  <Text selectable style={s.address}>
                    {
                      guardians.find((account) => account.id === guardianId)
                        ?.address
                    }
                  </Text>
                </Card>
                {guardians.length > 1 && (
                  <Button
                    title="Choose guardian account"
                    variant="secondary"
                    size="compact"
                    disabled={busy}
                    onPress={() => setChoosing('guardian')}
                  />
                )}
              </>
            ) : (
              <Notice
                title="Guardian account unavailable"
                body="This recovery requires a guardian account held by this wallet."
                tone="amber"
              />
            )}
            <Text style={s.heading}>Replacement owner</Text>
            {replacementKind === 'passkey' && <Card style={s.card}><Icon name="fingerprint" /><Text>Passkey</Text><Text>{t('settings.compositePasskeyDescription')}</Text></Card>}
            {replacementKind === 'software' && replacementId && (
              <Card style={s.card}>
                <Text style={s.label}>
                  {
                    port.replacements.find(
                      (account) => account.id === replacementId
                    )?.label
                  }
                </Text>
                <Text selectable style={s.address}>
                  {
                    port.replacements.find(
                      (account) => account.id === replacementId
                    )?.address
                  }
                </Text>
              </Card>
            )}
            <Button
              title="Choose replacement owner"
              variant="secondary"
              size="compact"
              disabled={busy}
              icon="wallet"
              onPress={() => { setReplacementKind('software'); setPasskeyNotVerified(false); setChoosing('replacement'); }}
            />
            {port.passkeysAvailable && replacementKind !== 'passkey' && <Button title="Use passkey" icon="fingerprint" variant="secondary" size="compact" disabled={busy}
              onPress={() => { setReplacementKind('passkey'); setPasskeyNotVerified(false); }} />}
            {passkeyNotVerified && replacementKind === 'passkey' && <>
              <Notice title={t('settings.smartAccountPasskeyRecreateConfirmTitle')} body={t('settings.smartAccountPasskeyRecreateConfirmDescription')} />
              <Button title={t('settings.smartAccountPasskeyRecreateConfirmButton')} icon="fingerprint" disabled={busy || !guardianId || !payerId}
                onPress={() => void open({kind:'start',guardianId,payerId,replacement:{kind:'passkey',recreate:true}})} />
            </>}
            <Text style={s.heading}>Fee payer</Text>
            {payerId && (
              <Card style={s.card}>
                <Text style={s.label}>
                  {port.payers.find((account) => account.id === payerId)?.label}
                </Text>
                <Text selectable style={s.address}>
                  {
                    port.payers.find((account) => account.id === payerId)
                      ?.address
                  }
                </Text>
              </Card>
            )}
            <Button
              title="Choose fee payer"
              variant="secondary"
              size="compact"
              disabled={busy}
              onPress={() => setChoosing('payer')}
            />
          </>
        )}
        {busy && (
          <ActivityIndicator
            accessibilityLabel="Opening recovery"
            color={colors.pink}
          />
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        )}
        {error && port.hasIntent && (
          <Button
            title="Try again"
            disabled={busy}
            onPress={() => void open({ kind: 'resume' })}
          />
        )}
        {observation?.exists && (
          <Button
            title={t('settings.smartAccountRecoveryEmailAlerts')}
            variant="secondary"
            size="compact"
            icon="external"
            onPress={() => {
              if (!owner.current.live || lifetime.aborted) return;
              void openRecoveryAlerts().catch(() => {
                if (owner.current.live && !lifetime.aborted)
                  setError('Recovery alerts could not be opened. Try again.');
              });
            }}
          />
        )}
      </Screen>
    </SafeAreaView>
  );
}

function AccountChoice({
  account,
  selected,
  disabled,
  onPress,
}: {
  account: Pick<NativeGuardianRecoveryChoice, 'label' | 'address'>;
  selected: boolean;
  disabled: boolean;
  onPress(): void;
}) {
  return (
    <IdlePressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${account.label} ${account.address}`}
      disabled={disabled}
      onPress={onPress}
      style={[s.choice, selected && s.selected]}
    >
      <Text style={s.label}>
        {account.label}
        {selected ? ' · Selected' : ''}
      </Text>
      <Text selectable style={s.address}>
        {account.address}
      </Text>
    </IdlePressable>
  );
}

export function NativeGuardianRecoveryView({
  controller,
  address,
  chainId,
  currency,
  networkLabel,
  onActivity,
  openRecoveryAlerts,
  onBack,
}: {
  controller: NativeGuardianRecoveryController;
  address: string;
  chainId: number;
  currency: string;
  networkLabel: string;
  onActivity(payerId: string, chainId: number, hash: string): Promise<void>;
  openRecoveryAlerts(): Promise<void>;
  onBack(): void;
}) {
  const { t } = useNativeTranslation();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [details, setDetails] = useState(false);
  const [forget, setForget] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState('');
  const live = useRef(true);
  useLayoutEffect(
    () => () => {
      live.current = false;
    },
    []
  );
  useEffect(() => {
    if (AppState.currentState === 'active') void controller.prepare();
  }, [controller]);
  const act = (action: () => unknown) => { if (live.current && AppState.currentState === 'active') return action(); };
  const amount = (units: string) => (
    <>
      <Text selectable style={s.amount}>
        {formatBaseUnits(units, 18)}
      </Text>
      <Text style={s.label}>{currency}</Text>
    </>
  );
  const terminalNotice = state.terminalReason
    ? guardianRecoveryTerminalNotice(state.terminalReason)
    : null;
  const pending = state.phase === 'preparing' || state.phase === 'submitting';
  const clear = async () => {
    if (!acknowledged || !live.current || AppState.currentState !== 'active') return;
    await controller.abandon();
  };
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <Screen
        footer={
          <>
            {(state.phase === 'authorize' || state.phase === 'ready') && (
              <Button
                title={
                  state.action === 'finalize'
                    ? 'Review finalization fee'
                    : 'Authorize recovery'
                }
                onPress={() => void act(() => controller.review())}
              />
            )}
            {state.phase === 'review' && state.feeReview && (
              <Button
                title={
                  state.action === 'finalize'
                    ? 'Confirm finalization'
                    : 'Confirm schedule'
                }
                onPress={() => void act(() => controller.confirm(state.feeReview!.id))}
              />
            )}
            {state.phase === 'complete' &&
              state.metadataRefresh === 'failed' && (
                <Button
                  title="Refresh account metadata"
                  onPress={() =>
                    void act(() => controller.retryMetadata().catch(() => undefined))
                  }
                />
              )}
            {['waiting', 'unknown', 'failed'].includes(state.phase) && (
              <Button
                title={
                  terminalNotice ? 'Refresh current policy' : 'Check status'
                }
                onPress={() => void act(() => controller.refresh())}
              />
            )}
            <Button
              title={terminalNotice ? 'Return to account' : 'Close'}
              variant="secondary"
              size="compact"
              onPress={onBack}
            />
          </>
        }
      >
        <Header
          title={
            state.phase === 'cleared'
              ? 'Recovery tracking cleared'
              : state.phase === 'complete'
              ? state.metadataRefresh === 'failed'
                ? 'Recovery confirmed'
                : 'Recovery complete'
              : 'Recover smart account'
          }
          subtitle={networkLabel}
          onBack={onBack}
        />
        {terminalNotice && (
          <Notice
            title={terminalNotice.title}
            body={terminalNotice.body}
            tone="amber"
          />
        )}
        <Card style={s.card}>
          <Text style={s.label}>Smart account · Chain ID {chainId}</Text>
          <Text selectable style={s.address}>
            {address}
          </Text>
          {state.intent && (
            <>
              <Text style={s.label}>
                {state.phase === 'complete' &&
                state.metadataRefresh === 'failed'
                  ? 'Replacement owner in saved recovery'
                  : 'Replacement owner'}
              </Text>
              <Text selectable style={s.address}>
                {state.intent.replacement.kind === 'software' ? state.intent.replacement.account.address : state.intent.replacement.credential.authenticator.id === 'p256-webauthn' ? state.intent.replacement.credential.authenticator.config.passkeyName || 'Passkey' : 'Passkey'}
              </Text>
              <Text style={s.label}>Guardian</Text>
              <Text selectable style={s.address}>
                {state.intent.guardian.address}
              </Text>
              <Text style={s.label}>Fee payer</Text>
              <Text selectable style={s.address}>
                {state.intent.payer.address}
              </Text>
            </>
          )}
        </Card>
        {pending && (
          <>
            <ActivityIndicator color={colors.pink} />
            <Text style={styles.muted}>
              {state.phase === 'submitting'
                ? 'Submitting recovery…'
                : 'Checking recovery…'}
            </Text>
          </>
        )}
        {(state.phase === 'authorize' || state.phase === 'ready') && (
          <>
            <Notice
              title={
                state.action === 'finalize'
                  ? 'Recovery is ready'
                  : 'Authorize the recovery'
              }
              body={
                state.action === 'finalize'
                  ? 'Finalize the saved recovery to activate the replacement owner. Review the paying account and fee next.'
                  : 'Authorize the guardian and replacement-key proofs for this exact recovery. Review the paying account and fee next.'
              }
            />
          </>
        )}
        {state.phase === 'review' && state.feeReview && (
          <>
            <Notice
              title={
                state.action === 'finalize'
                  ? 'Confirm finalization'
                  : 'Confirm recovery schedule'
              }
              body="The selected fee payer pays the network fee for the exact transaction below."
            />
            <Card style={s.card}>
              <Text style={s.label}>Fee payer</Text>
              <Text selectable style={s.address}>
                {state.feeReview.transaction.from}
              </Text>
              <Text style={s.label}>Maximum network fee</Text>
              {amount(state.feeReview.maximumFeeUnits)}
              <Text style={s.label}>Maximum total cost</Text>
              {amount(state.feeReview.maximumTotalUnits)}
            </Card>
            <Button
              title={
                details
                  ? 'Hide transaction details'
                  : 'View transaction details'
              }
              expanded={details}
              variant="secondary"
              size="compact"
              icon={details ? 'chevron-up' : 'chevron-down'}
              onPress={() => setDetails(!details)}
            />
            {details && (
              <TransactionDetails transaction={state.feeReview.transaction} />
            )}
          </>
        )}
        {state.phase === 'waiting' && (
          <Notice
            title="Recovery pending"
            body={
              state.observation?.knownOperation?.status === 'pending'
                ? 'Check the network status to see when the guardian waiting period has elapsed.'
                : state.observation?.knownOperation?.status === 'unknown' &&
                  state.observation.active &&
                  ['pending', 'ready'].includes(state.observation.active.status)
                ? 'Another recovery is pending for this account. Check its status before continuing.'
                : 'The saved transaction is awaiting a network result. Check its status before continuing.'
            }
          />
        )}
        {state.phase === 'unknown' && (
          <Notice
            title="Submission status unavailable"
            body="The transaction may have reached the network. Check its status before attempting another recovery."
            tone="amber"
          />
        )}
        {state.observation?.knownOperation &&
          (state.phase === 'waiting' || state.phase === 'ready') && (
            <Card style={s.card}>
              <Text style={s.label}>
                Ready{' '}
                {new Date(
                  state.observation.knownOperation.executableAt * 1000
                ).toLocaleString()}
              </Text>
              <Text style={s.label}>
                Expires{' '}
                {new Date(
                  state.observation.knownOperation.expiresAt * 1000
                ).toLocaleString()}
              </Text>
            </Card>
          )}
        {state.transactionHash && (
          <Card style={s.card}>
            <Text style={s.label}>Transaction hash</Text>
            <Text selectable style={s.address}>
              {state.transactionHash}
            </Text>
          </Card>
        )}
        {state.transactionHash && state.intent && (
          <Button
            title="View saved transaction"
            variant="secondary"
            size="compact"
            disabled={activityBusy}
            onPress={() => {
              if (!live.current) return;
              setActivityBusy(true);
              setActivityError('');
              void onActivity(
                state.intent!.payer.id,
                state.intent!.operation.chainId,
                state.transactionHash!
              )
                .catch(() => {
                  if (live.current)
                    setActivityError(
                      'The saved transaction could not be opened. Check status or close and resume recovery.'
                    );
                })
                .finally(() => {
                  if (live.current) setActivityBusy(false);
                });
            }}
          />
        )}
        {!!activityError && (
          <Text accessibilityRole="alert" style={s.error}>
            {activityError}
          </Text>
        )}
        {!!state.error &&
          !(
            state.phase === 'complete' && state.metadataRefresh === 'failed'
          ) && (
            <Text accessibilityRole="alert" style={s.error}>
              {state.error}
            </Text>
          )}
        {state.phase === 'complete' && (
          <Notice
            title={
              state.metadataRefresh === 'failed'
                ? 'Wallet update incomplete'
                : 'Replacement owner active'
            }
            body={
              state.metadataRefresh === 'failed'
                ? 'The recovery executed on-chain. This wallet has not adopted the observed account metadata. Refresh it or clear local recovery tracking.'
                : 'This account now uses the replacement owner.'
            }
          />
        )}

        {state.canAbandon && !forget && (
          <Button
            title="Clear local recovery tracking"
            variant="danger"
            size="compact"
            icon="trash"
            onPress={() => setForget(true)}
          />
        )}
        {state.canAbandon && forget && (
          <>
            <Notice
              title="Clear local tracking?"
              body="This forgets the saved recovery intent. It does not cancel transactions or recovery scheduled on the network. Your wallet keys are kept."
              tone="amber"
            />
            <IdlePressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acknowledged }}
              accessibilityLabel="I understand that network recovery is not canceled"
              onPress={() => setAcknowledged(!acknowledged)}
              style={s.choice}
            >
              <Text style={s.label}>
                {acknowledged ? '✓ ' : ''}I understand that network recovery is
                not canceled.
              </Text>
            </IdlePressable>
            <Button
              title="Clear saved intent"
              disabled={!acknowledged || pending}
              onPress={() => void clear()}
            />
            <Button
              title="Keep tracking"
              variant="secondary"
              size="compact"
              onPress={() => {
                setForget(false);
                setAcknowledged(false);
              }}
            />
          </>
        )}
        {state.observation?.exists && (
          <Button
            title={t('settings.smartAccountRecoveryEmailAlerts')}
            variant="secondary"
            size="compact"
            icon="external"
            onPress={() => {
              if (!live.current) return;
              void openRecoveryAlerts().catch(() => {
                if (live.current)
                  setActivityError(
                    'Recovery alerts could not be opened. Try again.'
                  );
              });
            }}
          />
        )}
      </Screen>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  card: { padding: 16, gap: 8 },
  label: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  heading: { color: colors.text, fontSize: 17, fontWeight: '600' },
  address: { color: colors.text, fontSize: 14, lineHeight: 21 },
  amount: { color: colors.text, fontSize: 19, lineHeight: 27 },
  search: {
    marginHorizontal: 20,
    marginBottom: 16,
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.text,
  },
  choices: { paddingHorizontal: 20, paddingBottom: 20, gap: 10 },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  selected: { borderColor: colors.pink },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
