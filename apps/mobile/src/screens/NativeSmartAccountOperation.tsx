import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { useOwnedLedgerConnection } from './useDappLedgerConnection';
import {
  formatTokenUnits,
  type Erc20Metadata,
} from '../../../../source/shared/erc20';
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
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNativeTranslation } from '../platform/localization';
import { formatBaseUnits } from '../core/amounts';
import { getNativeSendContext } from '../custody/networkContext';
import type {
  NativeSmartAccountOperation,
  NativeSmartAccountOperationSnapshot,
} from '../smartAccount/operation';
import { TransactionDetails } from './NativeTransactionReview';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { guardianDelayLabel } from './guardianPolicyLabels';

type DeploymentOwner = {
  live: boolean;
  returning: boolean;
  operation?: NativeSmartAccountOperation;
  opening?: Promise<void>;
  disposing?: Promise<void>;
};
function disposeDeployment(owner: DeploymentOwner): Promise<void> {
  owner.disposing ??= Promise.resolve(owner.opening).then(() =>
    owner.operation?.dispose()
  );
  return owner.disposing;
}

export function NativeSmartAccountOperationRoute({
  open,
  onBack,
  ledgerConnection,
}: {
  ledgerConnection?: NativeLedgerConnectionView;
  open(assertCurrent: () => void): Promise<NativeSmartAccountOperation>;
  onBack(): void;
}) {
  const owner = useRef<DeploymentOwner | undefined>(undefined);
  const callbacks = useRef({ onBack });
  const [opened, setOpened] = useState<{
    source: typeof open;
    controller?: NativeSmartAccountOperation;
    failed?: true;
    closing?: true;
  }>();
  useLayoutEffect(() => {
    callbacks.current = { onBack };
  }, [onBack]);
  const back = useCallback(() => {
    const current = owner.current;
    if (!current?.live) return;
    current.live = false;
    current.returning = true;
    const close = callbacks.current.onBack;
    setOpened({ source: open, closing: true });
    void disposeDeployment(current)
      .catch(() => undefined)
      .then(() => {
        if (owner.current === current && current.returning) close();
      });
  }, [open]);
  useEffect(() => {
    const current: DeploymentOwner = { live: true, returning: false };
    owner.current = current;
    const check = () => {
      if (
        owner.current !== current ||
        !current.live ||
        AppState.currentState !== 'active'
      )
        throw new Error('DEPLOYMENT_EXPIRED');
    };
    current.opening = Promise.resolve()
      .then(() => {
        check();
        return open(check);
      })
      .then((operation) => {
        current.operation = operation;
        if (current.live) {
          check();
          setOpened({ source: open, controller: operation });
        }
      })
      .catch(() => {
        if (current.live) setOpened({ source: open, failed: true });
      });
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => {
      current.live = false;
      current.returning = false;
      void disposeDeployment(current).catch(() => undefined);
      hardware.remove();
    };
  }, [back, open]);
  const current = opened?.source === open ? opened : undefined;
  if (current?.controller)
    return (
      <NativeSmartAccountOperationScreen
        controller={current.controller}
        ledgerConnection={ledgerConnection}
        onBack={back}
      />
    );
  return (
    <SafeAreaView style={s.safe}>
      <Screen>
        <Header title="Deploy smart account" onBack={back} />
        {current?.closing ? (
          <Text>Closing deployment review…</Text>
        ) : current?.failed ? (
          <Notice
            title="Deployment unavailable"
            body="Return to your account and try again."
          />
        ) : (
          <ActivityIndicator color={colors.pink} />
        )}
        <Button
          title="Close"
          variant="quiet"
          disabled={current?.closing}
          onPress={back}
        />
      </Screen>
    </SafeAreaView>
  );
}

export function NativeSmartAccountOperationScreen({
  controller,
  onBack,
  ledgerConnection,
}: {
  ledgerConnection?: NativeLedgerConnectionView;
  controller: NativeSmartAccountOperation;
  onBack(): void;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const isReviewCurrent = useCallback(() => {
    const current = controller.getSnapshot();
    return current.revision === state.revision && current.phase === 'authorize';
  }, [controller, state.revision]);
  const ledger = useOwnedLedgerConnection({owner: controller, revision: state.revision, expiresAt: controller.authorizationExpiresAt,
    available: state.phase === 'authorize', isReviewCurrent, ledgerConnection});
  useEffect(() => {
    void controller.prepare();
    return () => {
      void Promise.resolve(controller.dispose()).catch(() => undefined);
    };
  }, [controller]);
  return (
    <NativeSmartAccountOperationContent
      state={state}
      onBack={onBack}
      disabled={state.phase === 'authorize' && ledger.blocked}
      before={<>{ledger.showConnect && <Button title="Connect Ledger" variant="secondary" onPress={ledger.connect} />}{ledger.modal}</>}
      authorize={() => { if (ledger.canApprove()) void controller.authorize(state.revision); }}
      confirmPayer={(id) => controller.confirmPayer(id)}
      retryMetadata={() => void controller.retryMetadata()}
    />
  );
}

/** Both wallet and dapp screens render the same two-stage operation review. */
export function NativeSmartAccountOperationContent({
  state,
  onBack,
  authorize,
  confirmPayer,
  retryMetadata,
  before,
  disabled = false,
}: {
  state: NativeSmartAccountOperationSnapshot;
  onBack(): void;
  authorize(): void;
  confirmPayer(id: number): void;
  retryMetadata?(): void;
  before?: React.ReactNode;
  disabled?: boolean;
}) {
  const { t } = useNativeTranslation();
  const [details, setDetails] = useState(false);
  const network = getNativeSendContext(state.network);
  const amount = (units: string, token?: Erc20Metadata) => {
    const value = token
      ? formatTokenUnits(units, token.decimals)
      : formatBaseUnits(units, network.decimals);
    const symbol = token?.symbol ?? network.symbol;
    return (
      <View
        style={s.amount}
        accessible
        accessibilityLabel={`${value} ${symbol}`}
      >
        <Text selectable style={[s.value, value.length > 18 && s.preciseValue]}>
          {value}
        </Text>
        <Text style={s.unit}>{symbol}</Text>
      </View>
    );
  };
  const payer = state.payerReview;
  const batch = state.intent.kind === 'dapp-batch' ? state.intent : null;
  const guardian =
    state.intent.kind === 'guardian-policy' ? state.intent.command : null;
  const authenticator =
    state.intent.kind === 'authenticator' ? state.intent.command : null;
  const transfer =
    state.intent.kind !== 'deploy' &&
    state.intent.kind !== 'dapp-batch' &&
    state.intent.kind !== 'guardian-policy' &&
    state.intent.kind !== 'authenticator'
      ? state.intent
      : null;
  const waiting = ['preparing', 'preparing-fee', 'waiting'].includes(
    state.phase
  );
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <Screen>
        <Header
          title={
            state.phase === 'authorize'
              ? authenticator
                ? t('settings.smartAccountCurrentApprovalMethod')
                : guardian
                ? guardian.kind === 'remove'
                  ? 'Review guardian removal'
                  : 'Review guardian policy'
                : batch
                ? 'Review calls'
                : transfer
                ? transfer.kind === 'dapp-call'
                  ? 'Review transaction'
                  : 'Review transfer'
                : 'Authorize deployment'
              : payer?.purpose === 'fund-account'
              ? 'Fund smart account'
              : authenticator
              ? t(authenticator.targetModule.id === 'slh-dsa' ? 'settings.slhDsaAuthenticator' : 'settings.ecdsaAuthenticator')
              : guardian
              ? guardian.kind === 'remove'
                ? 'Guardian removal'
                : 'Guardian policy'
              : batch
              ? 'Send calls'
              : transfer
              ? 'Send'
              : 'Deploy smart account'
          }
          onBack={onBack}
        />
        {before}
        <Card style={s.card}>
          <Text style={s.label}>{network.name}</Text>
          <Text selectable style={s.address}>
            {state.account}
          </Text>
          <Text style={s.label}>Chain ID {state.network.chainId}</Text>
        </Card>
        {authenticator && (
          <Card style={s.card}>
            <Text style={s.label}>{t(authenticator.targetModule.id === 'slh-dsa' ? 'settings.slhDsaAuthenticator' : authenticator.targetModule.id === 'ecdsa' ? 'settings.ecdsaAuthenticator' : 'settings.compositeAuthenticator')}</Text>
            <Text selectable style={s.address}>{authenticator.target.validator}</Text>
            {authenticator.targetModule.id === 'ecdsa' && <>
              {authenticator.targetModule.config.owners.map(owner => <Text key={owner} selectable style={s.address}>{owner}</Text>)}
              <Text style={s.label}>{t('smartAccountHub.compositeThreshold')}</Text><Text>{authenticator.targetModule.config.threshold}</Text>
            </>}
            {authenticator.targetModule.id === 'slh-dsa' && <>
              <Text selectable style={s.address}>{authenticator.targetModule.config.pkSeed}</Text>
              <Text selectable style={s.address}>{authenticator.targetModule.config.pkRoot}</Text>
              <Text style={s.label}>{t('settings.slhDsaModuleHint')}</Text>
            </>}
          </Card>
        )}
        {guardian && (
          <Card style={s.card}>
            <Text style={s.label}>
              {guardian.kind === 'remove'
                ? 'Remove guardian'
                : guardian.kind === 'install'
                ? 'Set guardian'
                : 'Update guardian'}
            </Text>
            {guardian.kind === 'remove' ? (
              <>
                <Text style={s.label}>Guardian recovery module</Text>
                <Text selectable style={s.address}>
                  {guardian.moduleAddress}
                </Text>
                <Text style={s.label}>
                  This removes the account’s guardian recovery module.
                </Text>
              </>
            ) : (
              <>
                <Text selectable style={s.address}>
                  {guardian.guardian}
                </Text>
                <Text style={s.label}>Guardian threshold · 1</Text>
                <Text style={s.label}>
                  Recovery delay · {guardianDelayLabel(guardian.delaySeconds)}
                </Text>
                <Text style={s.label}>
                  Finalization window once ready ·{' '}
                  {guardianDelayLabel(guardian.delaySeconds * 2)}
                </Text>
              </>
            )}
          </Card>
        )}
        {batch &&
          batch.calls.map((call, index) => (
            <Card key={index} style={s.card}>
              <Text style={s.label}>
                Call {index + 1} of {batch.calls.length}
              </Text>
              <Text selectable style={s.address}>
                {call.to}
              </Text>
              {amount(BigInt(call.value).toString())}
              <TransactionDetails
                transaction={{
                  to: call.to!,
                  value: BigInt(call.value).toString(),
                  data: call.data,
                }}
              />
            </Card>
          ))}
        {transfer && (
          <Card style={s.card}>
            {transfer.kind === 'erc20-transfer' && (
              <>
                <Text style={s.label}>
                  {transfer.token.name} · {transfer.token.symbol}
                </Text>
                <Text selectable style={s.address}>
                  {transfer.token.contractAddress}
                </Text>
                <Text style={s.label}>Decimals {transfer.token.decimals}</Text>
              </>
            )}
            <Text style={s.label}>To</Text>
            <Text selectable style={s.address}>
              {transfer.recipient}
            </Text>
            {transfer.kind === 'nft-transfer' && (
              <>
                <Text style={s.label}>{transfer.tokenStandard}</Text>
                <Text selectable style={s.address}>
                  {transfer.contractAddress}
                </Text>
                <Text style={s.label}>Token ID</Text>
                <Text selectable style={s.address}>
                  {transfer.tokenId}
                </Text>
              </>
            )}
            <Text style={s.label}>
              {transfer.kind === 'nft-transfer' ? 'Quantity' : 'Amount'}
            </Text>
            {transfer.kind === 'nft-transfer' ? (
              <Text selectable style={s.value}>
                {transfer.amountUnits}
              </Text>
            ) : transfer.kind === 'native-max' ? (
              <Text style={s.label}>Calculating maximum…</Text>
            ) : (
              amount(
                transfer.amountUnits,
                transfer.kind === 'erc20-transfer' ? transfer.token : undefined
              )
            )}
          </Card>
        )}
        {transfer?.kind === 'dapp-call' && (
          <Card style={s.card}>
            <Text style={s.label}>Transaction data</Text>
            <TransactionDetails
              transaction={{
                to: transfer.recipient,
                value: transfer.amountUnits,
                data: transfer.data,
              }}
            />
          </Card>
        )}
        {state.phase === 'authorize' && (
          <>
            <Notice
              title={
                authenticator
                  ? t('settings.useSmartAccountValidator')
                  : guardian
                  ? guardian.kind === 'remove'
                    ? 'Authorize guardian removal'
                    : 'Authorize this guardian policy'
                  : batch
                  ? 'Authorize these calls'
                  : transfer
                  ? transfer.kind === 'dapp-call'
                    ? 'Authorize this transaction'
                    : 'Authorize this transfer'
                  : 'Create this account on the network'
              }
              body={
                authenticator
                  ? authenticator.targetModule.id === 'slh-dsa'
                    ? t('settings.slhDsaSetupConfirmDescription')
                    : 'Authorize replacing the current authenticator settings with the owner and threshold shown above. The following review confirms the paying account and submission fee.'
                  : guardian
                  ? guardian.kind === 'remove'
                    ? 'Authorize removing guardian recovery from this account. The following review confirms the paying account and submission fee.'
                    : 'Authorize the guardian and recovery delay shown above. The following review confirms the paying account and submission fee.'
                  : batch
                  ? 'Authorize the ordered calls together. The following review confirms the paying account and submission fee.'
                  : transfer
                  ? transfer.kind === 'dapp-call'
                    ? 'Authorize this smart account transaction. The following review confirms the paying account and submission fee.'
                    : 'Authorize this smart account transfer. The following review confirms the paying account and submission fee.'
                  : 'Authorize the account’s deployment. This operation sends no assets. The following review confirms the wallet account and network fee used to submit it.'
              }
            />
            <Card style={s.card}>
              <Text style={s.label}>Maximum account charge</Text>
              {amount(state.maximumPrefundUnits!)}
              <Text style={s.label}>
                Unused prefund stays with your account.
              </Text>
              <Button
                title={
                  details
                    ? 'Hide authorization details'
                    : 'View authorization details'
                }
                variant="quiet"
                expanded={details}
                onPress={() => setDetails(!details)}
              />
              {details && (
                <>
                  <Text style={s.label}>User operation nonce</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.nonce}
                  </Text>
                  <Text style={s.label}>EntryPoint</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.entryPoint}
                  </Text>
                  <Text style={s.label}>Account creation data</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.initCode}
                  </Text>
                  <Text style={s.label}>Account call data</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.callData}
                  </Text>
                  <Text style={s.label}>Authorization hash</Text>
                  <Text selectable style={s.address}>
                    {state.userOperationHash}
                  </Text>
                </>
              )}
            </Card>
            <Button
              title={
                authenticator
                  ? 'Authorize authenticator change'
                  : guardian
                  ? guardian.kind === 'remove'
                    ? 'Authorize removal'
                    : 'Authorize policy'
                  : batch
                  ? 'Authorize calls'
                  : transfer?.kind === 'dapp-call'
                  ? 'Authorize transaction'
                  : transfer
                  ? 'Authorize transfer'
                  : 'Authorize deployment'
              }
              disabled={disabled}
              onPress={authorize}
            />
          </>
        )}
        {payer && (
          <>
            <Notice
              title={
                payer.purpose === 'fund-account'
                  ? 'Fund the account charge'
                  : authenticator
                  ? 'Submit the authorized authenticator change'
                  : guardian
                  ? guardian.kind === 'remove'
                    ? 'Submit the authorized removal'
                    : 'Submit the authorized guardian policy'
                  : batch
                  ? 'Submit the authorized calls'
                  : transfer
                  ? transfer.kind === 'dapp-call'
                    ? 'Submit the authorized transaction'
                    : 'Submit the authorized transfer'
                  : 'Submit the authorized deployment'
              }
              body={
                payer.purpose === 'fund-account'
                  ? 'Move this amount to your smart account so it can cover its network charge.'
                  : authenticator
                  ? t('smartAccountHub.compositeOnchainHint')
                  : guardian
                  ? guardian.kind === 'remove'
                    ? 'This transaction submits the guardian removal you authorized.'
                    : 'This transaction submits the guardian policy you authorized.'
                  : batch
                  ? 'This transaction submits the calls you authorized.'
                  : transfer
                  ? transfer.kind === 'dapp-call'
                    ? 'This transaction submits the operation you authorized.'
                    : 'This transaction submits the transfer you authorized.'
                  : 'This transaction submits your existing deployment authorization.'
              }
            />
            <Card style={s.card}>
              <Text style={s.label}>Paying account</Text>
              <Text selectable style={s.address}>
                {payer.transaction.from}
              </Text>
              <Text style={s.label}>Amount</Text>
              {amount(payer.transaction.value)}
              <Text style={s.label}>
                {payer.coveredFeeUnits !== '0'
                  ? 'Maximum network fee · gas tank'
                  : 'Maximum network fee'}
              </Text>
              {amount(payer.maximumFeeUnits)}
              <Text style={s.label}>
                {payer.coveredFeeUnits !== '0'
                  ? 'Maximum from paying account'
                  : 'Maximum total'}
              </Text>
              {amount(payer.maximumTotalUnits)}
            </Card>
            <Button
              title={
                payer.purpose === 'fund-account'
                  ? 'Confirm funding'
                  : authenticator
                  ? 'Confirm authenticator change'
                  : guardian
                  ? guardian.kind === 'remove'
                    ? 'Confirm removal'
                    : 'Confirm policy'
                  : batch
                  ? 'Confirm calls'
                  : transfer
                  ? transfer.kind === 'dapp-call'
                    ? 'Confirm transaction'
                    : 'Confirm transfer'
                  : 'Confirm deployment'
              }
              disabled={disabled}
              onPress={() => confirmPayer(payer.id)}
            />
          </>
        )}
        {waiting && (
          <View style={s.progress}>
            <ActivityIndicator color={colors.pink} />
            <Text>
              {state.error && state.phase === 'preparing'
                ? state.error
                : state.phase === 'waiting'
                ? 'Waiting for the network…'
                : authenticator
                ? 'Preparing authenticator change…'
                : guardian
                ? guardian.kind === 'remove'
                  ? 'Preparing removal…'
                  : 'Preparing guardian policy…'
                : batch
                ? 'Preparing calls…'
                : transfer
                ? 'Preparing transfer…'
                : 'Preparing deployment…'}
            </Text>
          </View>
        )}
        {state.phase === 'complete' && (
          <Notice
            title={
              authenticator
                ? state.transactionHash
                  ? 'Authenticator transaction confirmed'
                  : t('settings.smartAccountAuthenticatorConfigured')
                : guardian
                ? guardian.kind === 'remove'
                  ? 'Guardian recovery removed'
                  : 'Guardian policy updated'
                : batch
                ? 'Calls submitted'
                : transfer?.kind === 'dapp-call'
                ? 'Transaction submitted'
                : transfer
                ? 'Transfer submitted'
                : 'Smart account deployed'
            }
            body={
              authenticator
                ? state.transactionHash
                  ? 'The network confirmed the authenticator change.'
                  : t('settings.smartAccountCurrentApprovalMethodHint')
                : guardian
                ? guardian.kind === 'remove'
                  ? 'The network confirmed this guardian removal transaction.'
                  : 'The network confirmed this guardian policy transaction.'
                : batch
                ? 'The connected app can check this call bundle’s status.'
                : transfer
                ? 'Follow this transaction in Activity.'
                : 'Your account is available on this network.'
            }
          />
        )}
        {(guardian || authenticator) &&
          state.phase === 'complete' &&
          state.metadataRefresh === 'refreshing' && (
            <Text>Refreshing account status…</Text>
          )}
        {(guardian || authenticator) &&
          state.phase === 'complete' &&
          state.metadataRefresh === 'failed' && (
            <>
              <Notice
                title="Account status unavailable"
                body={
                  authenticator
                    ? 'The authenticator transaction is confirmed. Refresh the saved account status to see the updated owner.'
                    : 'The policy transaction is confirmed. Refresh the saved account status to see the updated policy.'
                }
                tone="amber"
              />
              <Button
                title="Refresh account status"
                disabled={disabled || !retryMetadata}
                onPress={() => retryMetadata?.()}
              />
            </>
          )}
        {state.error && state.phase !== 'preparing' && (
          <Notice
            title={
              authenticator
                ? 'Check authenticator status'
                : guardian
                ? guardian.kind === 'remove'
                  ? 'Check removal status'
                  : 'Check guardian policy status'
                : batch
                ? 'Check calls status'
                : transfer
                ? 'Check transfer status'
                : 'Check deployment status'
            }
            body={state.error}
            tone="amber"
          />
        )}
        {state.transactionHash && (
          <Card style={s.card}>
            <Text style={s.label}>
              {authenticator && state.phase === 'complete'
                ? 'Confirmed transaction'
                : 'Latest transaction'}
            </Text>
            <Text selectable style={s.address}>
              {state.transactionHash}
            </Text>
          </Card>
        )}
        <Button title="Close" variant="quiet" onPress={onBack} />
      </Screen>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  card: { padding: 20, gap: 10 },
  label: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  address: { color: colors.text, fontSize: 13, lineHeight: 20 },
  amount: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 6,
  },
  value: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '600',
    maxWidth: '100%',
  },
  preciseValue: { fontSize: 16, lineHeight: 24 },
  unit: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  progress: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 20,
  },
});
