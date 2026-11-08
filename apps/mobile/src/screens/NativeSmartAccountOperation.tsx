import {
  formatTokenUnits,
  type Erc20Metadata,
} from '../../../../source/shared/erc20';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatBaseUnits } from '../core/amounts';
import { getNativeSendContext } from '../custody/networkContext';
import type {
  NativeSmartAccountOperation,
  NativeSmartAccountOperationSnapshot,
} from '../smartAccount/operation';
import { TransactionDetails } from './NativeTransactionReview';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { guardianDelayLabel } from './guardianPolicyLabels';

export function NativeSmartAccountOperationRoute({
  open,
  onBack,
}: {
  open(assertCurrent: () => void): Promise<NativeSmartAccountOperation>;
  onBack(): void;
}) {
  const [controller, setController] =
    useState<NativeSmartAccountOperation | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let current: NativeSmartAccountOperation | undefined;
    const check = () => {
      if (!alive) throw new Error('DEPLOYMENT_EXPIRED');
    };
    void open(check).then(
      (value) => {
        current = value;
        if (alive) setController(value);
        else value.dispose();
      },
      () => {
        if (alive) setFailed(true);
      }
    );
    return () => {
      alive = false;
      current?.dispose();
    };
  }, [open]);
  if (controller)
    return (
      <NativeSmartAccountOperationScreen
        controller={controller}
        onBack={onBack}
      />
    );
  return (
    <SafeAreaView style={s.safe}>
      <Screen>
        <Header title="Deploy smart account" onBack={onBack} />
        {failed ? (
          <Notice
            title="Deployment unavailable"
            body="Return to your account and try again."
          />
        ) : (
          <ActivityIndicator color={colors.pink} />
        )}
        <Button title="Close" variant="quiet" onPress={onBack} />
      </Screen>
    </SafeAreaView>
  );
}

export function NativeSmartAccountOperationScreen({
  controller,
  onBack,
}: {
  controller: NativeSmartAccountOperation;
  onBack(): void;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useEffect(() => {
    void controller.prepare();
    return () => controller.dispose();
  }, [controller]);
  return (
    <NativeSmartAccountOperationContent
      state={state}
      onBack={onBack}
      authorize={() => void controller.authorize(state.revision)}
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
  const transfer =
    state.intent.kind !== 'deploy' &&
    state.intent.kind !== 'dapp-batch' &&
    state.intent.kind !== 'guardian-policy'
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
              ? guardian
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
                guardian
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
                guardian
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
                guardian
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
              guardian
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
              guardian
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
        {guardian &&
          state.phase === 'complete' &&
          state.metadataRefresh === 'refreshing' && (
            <Text>Refreshing account status…</Text>
          )}
        {guardian &&
          state.phase === 'complete' &&
          state.metadataRefresh === 'failed' && (
            <>
              <Notice
                title="Account status unavailable"
                body="The policy transaction is confirmed. Refresh the saved account status to see the updated policy."
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
              guardian
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
            <Text style={s.label}>Latest transaction</Text>
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
