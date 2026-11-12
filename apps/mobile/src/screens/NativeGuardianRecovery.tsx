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
import { nativeI18n, useNativeTranslation } from '../platform/localization';
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
const t = nativeI18n.t.bind(nativeI18n);

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
            t('mobile.recoveryStatusViews.guardian.recoveryCouldNotBeOpenedCheckTheCurrentPolicyAnd')
          );
      } finally {
        current.busy = false;
        if (current.live) setBusy(false);
      }
    },
    [
      t,
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
                ? t('mobile.recoveryStatusViews.guardian.chooseGuardian')
                : choosing === 'replacement'
                ? t('mobile.recoveryStatusViews.guardian.chooseReplacementOwner')
                : t('mobile.recoveryStatusViews.guardian.chooseFeePayer')
            }
            onBack={() => {
              setChoosing(null);
              setSearch('');
            }}
          />
          <IdleTextInput
            accessibilityLabel={t('mobile.recoveryStatusViews.guardian.searchWalletAccounts')}
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
              <Text style={styles.muted}>{t('mobile.recoveryStatusViews.guardian.noMatchingWalletAccounts')}</Text>
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
                title={t('mobile.recoveryStatusViews.guardian.reviewRecovery')}
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
              title={t('buttons.close')}
              variant="secondary"
              size="compact"
              onPress={back}
            />
          </>
        }
      >
        <Header
          title={t('mobile.recoveryStatusViews.guardian.recoverSmartAccount')}
          subtitle={networkLabel}
          onBack={back}
        />
        <Card style={s.card}>
          <Text style={s.label}>{t('mobile.recoveryStatusViews.guardian.smartAccountChainID')}{' '}{port.chainId}</Text>
          <Text selectable style={s.address}>
            {address}
          </Text>
        </Card>
        {port.hasIntent ? (
          <Text style={styles.muted}>{t('mobile.recoveryStatusViews.guardian.openingSavedRecovery')}</Text>
        ) : (
          <>
            <Notice
              title={
                policySupported
                  ? t('mobile.recoveryStatusViews.guardian.chooseTheReplacementOwner')
                  : t('mobile.recoveryStatusViews.guardian.guardianPolicyUnsupported')
              }
              body={
                policySupported
                  ? t('mobile.recoveryStatusViews.guardian.recoveryReplacesTheAccountsCurrentValidatorWithTheWalletKey')
                  : t('mobile.recoveryStatusViews.guardian.recoveryInThisWalletCurrentlySupportsPoliciesThatRequireOne')
              }
            />
            <Text style={s.heading}>{t('mobile.recoveryStatusViews.guardian.guardianAccount')}</Text>
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
                    title={t('mobile.recoveryStatusViews.guardian.chooseGuardianAccount')}
                    variant="secondary"
                    size="compact"
                    disabled={busy}
                    onPress={() => setChoosing('guardian')}
                  />
                )}
              </>
            ) : (
              <Notice
                title={t('mobile.recoveryStatusViews.guardian.guardianAccountUnavailable')}
                body={t('mobile.recoveryStatusViews.guardian.thisRecoveryRequiresAGuardianAccountHeldByThisWallet')}
                tone="amber"
              />
            )}
            <Text style={s.heading}>{t('mobile.recoveryStatusViews.guardian.replacementOwner')}</Text>
            {replacementKind === 'passkey' && <Card style={s.card}><Icon name="fingerprint" /><Text>{t('settings.passkeyAuthenticator')}</Text><Text>{t('smartAccountHub.compositePasskeyDescription')}</Text></Card>}
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
              title={t('mobile.recoveryStatusViews.guardian.chooseReplacementOwner')}
              variant="secondary"
              size="compact"
              disabled={busy}
              icon="wallet"
              onPress={() => { setReplacementKind('software'); setPasskeyNotVerified(false); setChoosing('replacement'); }}
            />
            {port.passkeysAvailable && replacementKind !== 'passkey' && <Button title={t('mobile.recoveryStatusViews.guardian.usePasskey')} icon="fingerprint" variant="secondary" size="compact" disabled={busy}
              onPress={() => { setReplacementKind('passkey'); setPasskeyNotVerified(false); }} />}
            {passkeyNotVerified && replacementKind === 'passkey' && <>
              <Notice title={t('settings.smartAccountPasskeyRecreateConfirmTitle')} body={t('settings.smartAccountPasskeyRecreateConfirmDescription')} />
              <Button title={t('settings.smartAccountPasskeyRecreateConfirmButton')} icon="fingerprint" disabled={busy || !guardianId || !payerId}
                onPress={() => void open({kind:'start',guardianId,payerId,replacement:{kind:'passkey',recreate:true}})} />
            </>}
            <Text style={s.heading}>{t('mobile.infrastructure.feePayer')}</Text>
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
              title={t('mobile.recoveryStatusViews.guardian.chooseFeePayer')}
              variant="secondary"
              size="compact"
              disabled={busy}
              onPress={() => setChoosing('payer')}
            />
          </>
        )}
        {busy && (
          <ActivityIndicator
            accessibilityLabel={t('mobile.recoveryStatusViews.guardian.openingRecovery')}
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
            title={t('mobile.connections.tryAgain')}
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
                  setError(t('mobile.recoveryStatusViews.guardian.recoveryAlertsCouldNotBeOpenedTryAgain'));
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
  useNativeTranslation();
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
        {selected ? ` · ${t('mobile.language.selected')}` : ''}
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
                    ? t('mobile.recoveryStatusViews.guardian.reviewFinalizationFee')
                    : t('mobile.recoveryStatusViews.guardian.authorizeRecovery')
                }
                onPress={() => void act(() => controller.review())}
              />
            )}
            {state.phase === 'review' && state.feeReview && (
              <Button
                title={
                  state.action === 'finalize'
                    ? t('mobile.recoveryStatusViews.guardian.confirmFinalization')
                    : t('mobile.recoveryStatusViews.guardian.confirmSchedule')
                }
                onPress={() => void act(() => controller.confirm(state.feeReview!.id))}
              />
            )}
            {state.phase === 'complete' &&
              state.metadataRefresh === 'failed' && (
                <Button
                  title={t('mobile.recoveryStatusViews.guardian.refreshAccountMetadata')}
                  onPress={() =>
                    void act(() => controller.retryMetadata().catch(() => undefined))
                  }
                />
              )}
            {['waiting', 'unknown', 'failed'].includes(state.phase) && (
              <Button
                title={
                  terminalNotice ? t('mobile.recoveryStatusViews.guardian.refreshCurrentPolicy') : t('settings.smartAccountInfrastructureCheckStatus')
                }
                onPress={() => void act(() => controller.refresh())}
              />
            )}
            <Button
              title={terminalNotice ? t('mobile.recoveryStatusViews.guardian.returnToAccount') : t('buttons.close')}
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
              ? t('mobile.recoveryStatusViews.guardian.recoveryTrackingCleared')
              : state.phase === 'complete'
              ? state.metadataRefresh === 'failed'
                ? t('mobile.recoveryStatusViews.guardian.recoveryConfirmed')
                : t('mobile.recoveryStatusViews.guardian.recoveryComplete')
              : t('mobile.recoveryStatusViews.guardian.recoverSmartAccount')
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
          <Text style={s.label}>{t('mobile.recoveryStatusViews.guardian.smartAccountChainID')}{' '}{chainId}</Text>
          <Text selectable style={s.address}>
            {address}
          </Text>
          {state.intent && (
            <>
              <Text style={s.label}>
                {state.phase === 'complete' &&
                state.metadataRefresh === 'failed'
                  ? t('mobile.recoveryStatusViews.guardian.replacementOwnerInSavedRecovery')
                  : t('mobile.recoveryStatusViews.guardian.replacementOwner')}
              </Text>
              <Text selectable style={s.address}>
                {state.intent.replacement.kind === 'software' ? state.intent.replacement.account.address : state.intent.replacement.credential.authenticator.id === 'p256-webauthn' ? state.intent.replacement.credential.authenticator.config.passkeyName || t('settings.passkeyAuthenticator') : t('settings.passkeyAuthenticator')}
              </Text>
              <Text style={s.label}>{t('mobile.recoveryStatusViews.guardian.guardian')}</Text>
              <Text selectable style={s.address}>
                {state.intent.guardian.address}
              </Text>
              <Text style={s.label}>{t('mobile.infrastructure.feePayer')}</Text>
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
                ? t('mobile.recoveryStatusViews.guardian.submittingRecovery')
                : t('mobile.recoveryStatusViews.guardian.checkingRecovery')}
            </Text>
          </>
        )}
        {(state.phase === 'authorize' || state.phase === 'ready') && (
          <>
            <Notice
              title={
                state.action === 'finalize'
                  ? t('mobile.recoveryStatusViews.guardian.recoveryIsReady')
                  : t('mobile.recoveryStatusViews.guardian.authorizeTheRecovery')
              }
              body={
                state.action === 'finalize'
                  ? t('mobile.recoveryStatusViews.guardian.finalizeTheSavedRecoveryToActivateTheReplacementOwnerReview')
                  : t('mobile.recoveryStatusViews.guardian.authorizeTheGuardianAndReplacementkeyProofsForThisExactRecovery')
              }
            />
          </>
        )}
        {state.phase === 'review' && state.feeReview && (
          <>
            <Notice
              title={
                state.action === 'finalize'
                  ? t('mobile.recoveryStatusViews.guardian.confirmFinalization')
                  : t('mobile.recoveryStatusViews.guardian.confirmRecoverySchedule')
              }
              body={t('mobile.recoveryStatusViews.guardian.theSelectedFeePayerPaysTheNetworkFeeForThe')}
            />
            <Card style={s.card}>
              <Text style={s.label}>{t('mobile.infrastructure.feePayer')}</Text>
              <Text selectable style={s.address}>
                {state.feeReview.transaction.from}
              </Text>
              <Text style={s.label}>{t('transactions.replay.maximumFee')}</Text>
              {amount(state.feeReview.maximumFeeUnits)}
              <Text style={s.label}>{t('mobile.infrastructure.maximumTotal')}</Text>
              {amount(state.feeReview.maximumTotalUnits)}
            </Card>
            <Button
              title={
                details
                  ? t('mobile.privacyFlows.deposit.hideTransactionDetails')
                  : t('mobile.privacyFlows.deposit.viewTransactionDetails')
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
            title={t('settings.smartAccountGuardianRecoveryPending')}
            body={
              state.observation?.knownOperation?.status === 'pending'
                ? t('mobile.recoveryStatusViews.guardian.checkTheNetworkStatusToSeeWhenTheGuardianWaiting')
                : state.observation?.knownOperation?.status === 'unknown' &&
                  state.observation.active &&
                  ['pending', 'ready'].includes(state.observation.active.status)
                ? t('mobile.recoveryStatusViews.guardian.anotherRecoveryIsPendingForThisAccountCheckItsStatus')
                : t('mobile.recoveryStatusViews.guardian.theSavedTransactionIsAwaitingANetworkResultCheckIts')
            }
          />
        )}
        {state.phase === 'unknown' && (
          <Notice
            title={t('mobile.recoveryStatusViews.guardian.submissionStatusUnavailable')}
            body={t('mobile.recoveryStatusViews.guardian.theTransactionMayHaveReachedTheNetworkCheckItsStatus')}
            tone="amber"
          />
        )}
        {state.observation?.knownOperation &&
          (state.phase === 'waiting' || state.phase === 'ready') && (
            <Card style={s.card}>
              <Text style={s.label}>
                {t('settings.smartAccountInfrastructureReadyStatus')}{' '}{' '}
                {new Date(
                  state.observation.knownOperation.executableAt * 1000
                ).toLocaleString()}
              </Text>
              <Text style={s.label}>
                {t('mobile.connections.expires')}{' '}{' '}
                {new Date(
                  state.observation.knownOperation.expiresAt * 1000
                ).toLocaleString()}
              </Text>
            </Card>
          )}
        {state.transactionHash && (
          <Card style={s.card}>
            <Text style={s.label}>{t('transactions.replay.hash')}</Text>
            <Text selectable style={s.address}>
              {state.transactionHash}
            </Text>
          </Card>
        )}
        {state.transactionHash && state.intent && (
          <Button
            title={t('mobile.recoveryStatusViews.guardian.viewSavedTransaction')}
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
                      t('mobile.recoveryStatusViews.guardian.theSavedTransactionCouldNotBeOpenedCheckStatusOr')
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
                ? t('mobile.recoveryStatusViews.guardian.walletUpdateIncomplete')
                : t('mobile.recoveryStatusViews.guardian.replacementOwnerActive')
            }
            body={
              state.metadataRefresh === 'failed'
                ? t('mobile.recoveryStatusViews.guardian.theRecoveryExecutedOnchainThisWalletHasNotAdoptedThe')
                : t('mobile.recoveryStatusViews.guardian.thisAccountNowUsesTheReplacementOwner')
            }
          />
        )}

        {state.canAbandon && !forget && (
          <Button
            title={t('mobile.recoveryStatusViews.guardian.clearLocalRecoveryTracking')}
            variant="danger"
            size="compact"
            icon="trash"
            onPress={() => setForget(true)}
          />
        )}
        {state.canAbandon && forget && (
          <>
            <Notice
              title={t('mobile.recoveryStatusViews.guardian.clearLocalTracking')}
              body={t('mobile.recoveryStatusViews.guardian.thisForgetsTheSavedRecoveryIntentItDoesNotCancel')}
              tone="amber"
            />
            <IdlePressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acknowledged }}
              accessibilityLabel={t('mobile.recoveryStatusViews.guardian.iUnderstandThatNetworkRecoveryIsNotCanceled')}
              onPress={() => setAcknowledged(!acknowledged)}
              style={s.choice}
            >
              <Text style={s.label}>
                {acknowledged ? '✓ ' : ''}{t('mobile.recoveryStatusViews.guardian.iUnderstandThatNetworkRecoveryIsNotCanceled2')}</Text>
            </IdlePressable>
            <Button
              title={t('mobile.recoveryStatusViews.guardian.clearSavedIntent')}
              disabled={!acknowledged || pending}
              onPress={() => void clear()}
            />
            <Button
              title={t('mobile.recoveryStatusViews.guardian.keepTracking')}
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
                    t('mobile.recoveryStatusViews.guardian.recoveryAlertsCouldNotBeOpenedTryAgain')
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
