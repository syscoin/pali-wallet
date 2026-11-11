import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import type { AssetTransferCall } from '../../../../source/shared/assetTransfer';
import { resolveAssetTransferDisplay, type AssetTransferDisplay } from '../../../../source/shared/assetTransferDisplay';
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
  Platform,
  StyleSheet,
  Switch,
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
import { Button, Card, Coin, colors, Header, Notice, Screen, Text } from '../ui';
import { guardianDelayLabel } from './guardianPolicyLabels';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

type DeploymentOwner = {
  live: boolean;
  returning: boolean;
  lifetime: AbortController;
  authentication: NativePrivateAuthenticationScope;
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
  open(assertCurrent: () => void, signal: AbortSignal, authentication: NativePrivateAuthenticationScope): Promise<NativeSmartAccountOperation>;
  onBack(): void;
}) {
  const owner = useRef<DeploymentOwner | undefined>(undefined);
  const callbacks = useRef({ onBack });
  const [opened, setOpened] = useState<{
    source: typeof open;
    controller?: NativeSmartAccountOperation;
    authentication?: NativePrivateAuthenticationScope;
    failed?: true;
    closing?: true;
  }>();
  useLayoutEffect(() => {
    callbacks.current = { onBack };
  }, [onBack]);
  const back = useCallback((background = false) => {
    const current = owner.current;
    if (!current?.live) return;
    // Capture a verified local Suite departure before revoking this route.
    try { if (background === true) current.operation?.background(); }
    catch { /* A failed suspension still retires this route's custody. */ }
    current.live = false;
    current.authentication.retire();
    current.returning = true;
    current.lifetime.abort();
    const close = callbacks.current.onBack;
    setOpened({ source: open, closing: true });
    void disposeDeployment(current)
      .catch(() => undefined)
      .then(() => {
        if (owner.current === current && current.returning) close();
      });
  }, [open]);
  useEffect(() => {
    const current: DeploymentOwner = { live: true, returning: false, lifetime: new AbortController(), authentication: createNativePrivateAuthenticationScope() };
    owner.current = current;
    const check = () => {
      if (
        owner.current !== current ||
        !current.live ||
        current.lifetime.signal.aborted ||
        (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication, AppState.currentState))
      )
        throw new Error('DEPLOYMENT_EXPIRED');
    };
    current.opening = Promise.resolve()
      .then(() => {
        check();
        return open(check, current.lifetime.signal, current.authentication);
      })
      .then((operation) => {
        current.operation = operation;
        if (current.live) {
          check();
          setOpened({ source: open, controller: operation, authentication: current.authentication });
        }
      })
      .catch(() => {
        if (current.live) setOpened({ source: open, failed: true });
      });
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication, state)) back(true);
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => { if (!allowsPrivateAuthenticationInterruption(current.authentication, 'blur')) back(true); }) : undefined;
    return () => {
      current.live = false;
      current.authentication.retire();
      current.returning = false;
      current.lifetime.abort();
      void disposeDeployment(current).catch(() => undefined);
      hardware.remove();
      appState.remove();
      blur?.remove();
    };
  }, [back, open]);
  const current = opened?.source === open ? opened : undefined;
  if (current?.controller)
    return (
      <NativeSmartAccountOperationScreen
        authentication={current.authentication}
        controller={current.controller}
        ledgerConnection={ledgerConnection}
        onBack={() => back()}
      />
    );
  return (
    <SafeAreaView style={s.safe}>
      <Screen>
        <Header title="Smart account request" onBack={() => back()} />
        {current?.closing ? (
          <Text>Closing review…</Text>
        ) : current?.failed ? (
          <Notice
            title="Request unavailable"
            body="Return to your account and try again."
          />
        ) : (
          <ActivityIndicator color={colors.pink} />
        )}
        <Button
          title="Close"
          variant="secondary" size="compact"
          disabled={current?.closing}
          onPress={() => back()}
        />
      </Screen>
    </SafeAreaView>
  );
}

export function NativeSmartAccountOperationScreen({
  controller,
  onBack,
  ledgerConnection,
  authentication,
}: {
  authentication?: NativePrivateAuthenticationScope;
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
    return current.revision === state.revision && current.phase === 'authorize' &&
      current.intent === state.intent && current.userOperationHash === state.userOperationHash;
  }, [controller, state.revision, state.intent, state.userOperationHash]);
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
      authentication={authentication}
      state={state}
      onBack={onBack}
      disabled={state.phase === 'authorize' && ledger.blocked}
      before={<>{ledger.showConnect && <Button title="Connect Ledger" variant="secondary" size="compact" onPress={ledger.connect} />}{ledger.modal}</>}
      authorize={(acknowledgedCustomRisk) => {
        if (AppState.currentState !== 'active') return;
        if (!ledger.canApprove()) return;
        if (state.intent.kind !== 'modules') { void controller.authorize(state.revision); return; }
        if (!isReviewCurrent()) return;
        const kind = state.intent.command.draft.kind;
        if (kind === 'install-custom') {
          if (acknowledgedCustomRisk === true)
            void controller.authorizeModuleChange(state.revision, { kind, riskAcknowledged: true });
        } else void controller.authorizeModuleChange(state.revision, { kind });
      }}
      confirmPayer={(id) => { if (AppState.currentState === 'active') return controller.confirmPayer(id); }}
      retryMetadata={() => { if (AppState.currentState === 'active') void controller.retryMetadata(); }}
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
  assetTransfer,
  batchAssetTransfers,
  disabled = false,
  authentication,
}: {
  authentication?: NativePrivateAuthenticationScope;
  state: NativeSmartAccountOperationSnapshot;
  onBack(): void;
  authorize(acknowledgedCustomRisk: boolean): void;
  confirmPayer(id: number): void;
  retryMetadata?(): void;
  before?: React.ReactNode;
  assetTransfer?: AssetTransferCall | null;
  batchAssetTransfers?: readonly (AssetTransferCall | null)[];
  disabled?: boolean;
}) {
  const { t } = useNativeTranslation();
  const [details, setDetails] = useState(false);
  const [authorityDetails, setAuthorityDetails] = useState(false);
  type RiskAcknowledgement = Readonly<{ intent: NativeSmartAccountOperationSnapshot['intent']; hash: string | null }>;
  const [riskAcknowledgement, setRiskAcknowledgement] = useState<RiskAcknowledgement | null>(null);
  const risk = useRef<RiskAcknowledgement | null>(null), live = useRef(false);
  const intent = state.intent, hash = state.userOperationHash, phase = state.phase;
  const latest = useRef({ intent, hash, phase });
  const clearRisk = useCallback(() => {
    if (!risk.current) return;
    risk.current = null; setRiskAcknowledgement(null);
  }, []);
  useLayoutEffect(() => { latest.current = { intent, hash, phase }; clearRisk(); }, [intent, hash, phase, clearRisk]);
  useLayoutEffect(() => {
    live.current = true;
    const retire = () => { live.current = false; clearRisk(); };
    const change = AppState.addEventListener('change', next => { if (next !== 'active' && !(authentication && allowsPrivateAuthenticationInterruption(authentication, next))) retire(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => { if (!(authentication && allowsPrivateAuthenticationInterruption(authentication, 'blur'))) retire(); }) : undefined;
    return () => { live.current = false; risk.current = null; change.remove(); blur?.remove(); };
  }, [clearRisk, authentication]);
  const reviewCurrent = () => live.current && AppState.currentState === 'active' &&
    latest.current.intent === intent && latest.current.hash === hash &&
    latest.current.phase === 'authorize' && phase === 'authorize';
  const customInstall = intent.kind === 'modules' && intent.command.draft.kind === 'install-custom';
  const riskAcknowledged = phase === 'authorize' && riskAcknowledgement?.intent === intent && riskAcknowledgement.hash === hash;
  const authorizeCurrent = () => {
    if (disabled || !live.current || AppState.currentState !== 'active') return;
    if (intent.kind !== 'modules') { authorize(false); return; }
    if (!reviewCurrent()) return;
    const acknowledged = risk.current?.intent === intent && risk.current.hash === hash;
    if (customInstall && !acknowledged) return;
    authorize(customInstall && acknowledged);
  };
  const close = () => { live.current = false; clearRisk(); onBack(); };
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
  const assetSummary = (display: AssetTransferDisplay, nativeUnits: string) => <>
    <View style={s.transferHeading}>
      <View style={s.transferIcon}><Coin id="token" asset={{ kind: 'evm', chainId: state.network.chainId, contractAddress: display.contract, decimals: display.decimals }} registrationHash={state.network.registrationHash} size={42} fallbackSymbol={display.items[0]?.symbol ?? undefined} /></View>
      <View style={s.transferTitle}>
        <Text style={s.value}>{t(`assetTransfer.${display.heading}`)}</Text>
        <Text style={s.label}>{t(display.standardVerified ? 'assetTransfer.contractMetadata' : 'assetTransfer.unverified')}</Text>
      </View>
    </View>
    {display.items.map((item, index) => <View key={index} style={s.transferItem}>
      <Text selectable style={[s.transferValue, item.value.length > 20 && s.preciseValue]} accessibilityLabel={item.symbol ? `${item.value} ${item.symbol}` : item.tokenId !== null ? `Token ID ${item.tokenId}, quantity ${item.units}` : `${item.units} base units or token ID`}>{item.value}</Text>
      <Text style={s.unit}>{item.symbol ?? (item.tokenId !== null ? `${item.units} NFT${item.units === '1' ? '' : 's'}` : t('assetTransfer.rawUnits'))}</Text>
    </View>)}
    <View style={s.transferFact}><Text style={s.label}>{t('assetTransfer.recipient')}</Text><Text selectable style={s.transferAddress}>{display.recipient}</Text></View>
    <View style={s.transferFact}><Text style={s.label}>{t('assetTransfer.contract')}</Text><Text selectable style={s.transferAddress}>{display.contract}</Text></View>
    {display.from && <View style={s.transferFact}><Text style={s.label}>{t('assetTransfer.owner')}</Text><Text selectable style={s.transferAddress}>{display.from}</Text></View>}
    {nativeUnits !== '0' && <View style={s.transferFact}><Text style={s.label}>Also sending</Text><Text selectable style={s.transferAddress}>{formatBaseUnits(nativeUnits, network.decimals)} {network.symbol}</Text></View>}
  </>;
  const batch = state.intent.kind === 'dapp-batch' ? state.intent : null;
  const guardian =
    state.intent.kind === 'guardian-policy' ? state.intent.command : null;
  const authenticator =
    state.intent.kind === 'authenticator' ? state.intent.command : null;
  const modules = state.intent.kind === 'modules' ? state.intent.command : null;
  const methodName = (id: string) => id === 'ecdsa' ? 'Wallet owners' : id === 'p256-webauthn' ? 'Passkey' : id === 'slh-dsa' ? 'Post-quantum key' : id === 'composite' ? 'Combined approval methods' : 'Custom approval method';
  const transfer =
    state.intent.kind !== 'deploy' &&
    state.intent.kind !== 'dapp-batch' &&
    state.intent.kind !== 'guardian-policy' &&
    state.intent.kind !== 'authenticator' &&
    state.intent.kind !== 'modules'
      ? state.intent
      : null;
  const dappTransfer = transfer?.kind === 'dapp-call'
    ? resolveAssetTransferDisplay({ data: transfer.data, contract: transfer.recipient, transfer: assetTransfer })
    : null;
  const waiting = ['preparing', 'preparing-fee', 'waiting'].includes(
    state.phase
  );
  const primary = state.phase === 'authorize' ? (
            <Button
              title={
                modules
                  ? t('mobile.smartAccountModules.authorize')
                  : authenticator
                  ? 'Authorize approval change'
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
              disabled={disabled || customInstall && !riskAcknowledged}
              onPress={authorizeCurrent}
            />
  ) : payer ? (
            <Button
              title={
                payer.purpose === 'fund-account'
                  ? 'Confirm funding'
                  : modules
                  ? t('mobile.smartAccountModules.confirm')
                  : authenticator
                  ? 'Change approval method'
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
              onPress={() => { if (live.current && AppState.currentState === 'active') confirmPayer(payer.id); }}
            />
  ) : null;
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <Screen scrollResetKey={`${state.phase}:${payer?.id ?? ''}`} footer={<>{primary}<Button title="Close" variant="secondary" size="compact" onPress={close} /></>}>
        <Header
          title={
            state.phase === 'authorize'
              ? modules
                ? t('mobile.smartAccountModules.review')
                : authenticator
                ? 'Change approval method'
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
              : modules
              ? t('mobile.smartAccountModules.title')
              : authenticator
              ? 'Change approval method'
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
          onBack={close}
        />
        {before}
        <Card style={[s.card, s.contextCard]}>
          <View style={s.contextHeading}>
            <Text style={s.label}>{network.name}</Text>
            <Text style={s.label}>Chain ID {state.network.chainId}</Text>
          </View>
          <Text selectable style={s.address}>{state.account}</Text>
        </Card>
        {modules && (
          <Card style={s.card}>
            <Text style={s.label}>{t(modules.draft.kind === 'install-custom' ? 'smartAccountHub.install' : modules.draft.kind === 'uninstall' ? 'smartAccountHub.uninstall' : 'smartAccountHub.compositeSavePolicy')}</Text>
            <Text style={s.label}>{t('smartAccountHub.moduleAddress')}</Text>
            <Text selectable style={s.address}>{modules.targetAddress}</Text>
            {modules.draft.kind === 'install-custom' && <>
              <Text style={s.label}>{t('smartAccountHub.moduleName')}</Text><Text>{modules.draft.name}</Text>
              <Text style={s.label}>{t('smartAccountHub.moduleInitData')}</Text><Text selectable style={s.address}>{modules.draft.initData}</Text>
            </>}
            {modules.draft.kind === 'uninstall' && <Text>{t('smartAccountHub.uninstallDescription')}</Text>}
            {modules.draft.kind === 'composite' && <>
              <Text style={s.label}>{t('smartAccountHub.compositeMethods')}</Text>
              {modules.draft.children.map(child => <Text key={child} selectable style={s.address}>{child}</Text>)}
              <Text>{t('smartAccountHub.compositeThresholdSummary', { required: modules.draft.threshold, total: modules.draft.children.length })}</Text>
            </>}
          </Card>
        )}
        {authenticator && <>
          <Text style={s.label}>Replace how this account approves transactions. Review the new owners or approval method before authorizing the change.</Text>
          <Card style={s.card}>
            <Text style={s.label}>Current approval method</Text>
            <Text style={s.value}>{methodName(authenticator.sourceModule)}</Text>
          </Card>
          <Card style={s.card}>
            <Text style={s.label}>New approval method</Text>
            <Text style={s.value}>{methodName(authenticator.targetModule.id)}</Text>
            {authenticator.targetModule.id === 'ecdsa' && <>
              <Text>{`${authenticator.targetModule.config.threshold} of ${authenticator.targetModule.config.owners.length} owners can approve`}</Text>
              {authenticator.targetModule.config.owners.map((owner, index) => <View key={owner}>
                <Text style={s.label}>Owner {index + 1}</Text><Text selectable style={s.address}>{owner}</Text>
              </View>)}
            </>}
            {authenticator.targetModule.id === 'composite' && <Text>{`${authenticator.targetModule.config.threshold} of ${authenticator.targetModule.config.childValidators.length} approval methods can approve`}</Text>}
            {authenticator.targetModule.id === 'p256-webauthn' && <Text>{authenticator.targetModule.config.passkeyName || 'Use the configured passkey to approve.'}</Text>}
            {authenticator.targetModule.id === 'slh-dsa' && <Text>Use the configured post-quantum key to approve.</Text>}
          </Card>
          <Button title={authorityDetails ? 'Hide approval details' : 'View approval details'} variant="quiet" size="compact" expanded={authorityDetails} onPress={() => setAuthorityDetails(!authorityDetails)} />
          {authorityDetails && <Card style={s.card}>
            <Text style={s.label}>New validator contract</Text><Text selectable style={s.address}>{authenticator.target.validator}</Text>
            {authenticator.targetModule.id === 'slh-dsa' && <>
              <Text style={s.label}>Public key seed</Text><Text selectable style={s.address}>{authenticator.targetModule.config.pkSeed}</Text>
              <Text style={s.label}>Public key root</Text><Text selectable style={s.address}>{authenticator.targetModule.config.pkRoot}</Text>
              <Text style={s.label}>{t('settings.slhDsaModuleHint')}</Text>
            </>}
            {authenticator.targetModule.id === 'composite' && authenticator.targetModule.config.childValidators.map(address => <Text key={address} selectable style={s.address}>{address}</Text>)}
            <Text style={s.label}>New approval configuration</Text><Text selectable style={s.address}>{authenticator.target.data}</Text>
          </Card>}
        </>}
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
          batch.calls.map((call, index) => {
            const display = resolveAssetTransferDisplay({ data: call.data, contract: call.to, transfer: batchAssetTransfers?.[index] });
            return (
            <Card key={index} style={s.card}>
              <Text style={s.label}>
                Call {index + 1} of {batch.calls.length}
              </Text>
              {display ? assetSummary(display, BigInt(call.value).toString()) : <>
                <Text style={s.label}>{call.data === '0x' ? 'To' : 'Contract'}</Text>
                <Text selectable style={s.address}>{call.to}</Text>
                <Text style={s.label}>Native currency sent</Text>
                {amount(BigInt(call.value).toString())}
                {call.data !== '0x' && <Text style={s.label}>This amount excludes any tokens or NFTs the contract may move.</Text>}
              </>}
              <TransactionDetails
                transaction={{
                  to: call.to!,
                  value: BigInt(call.value).toString(),
                  data: call.data,
                }}
              />
            </Card>
          );})}
        {dappTransfer && transfer?.kind === 'dapp-call' && <Card style={s.card}>{assetSummary(dappTransfer, transfer.amountUnits)}</Card>}
        {transfer && !dappTransfer && (
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
            <Text style={s.label}>{transfer.kind === 'dapp-call' && transfer.data !== '0x' ? 'Contract' : 'To'}</Text>
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
              {transfer.kind === 'nft-transfer' ? 'Quantity' : transfer.kind === 'dapp-call' && transfer.data !== '0x' ? 'Native currency sent' : 'Amount'}
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
            {transfer.kind === 'dapp-call' && transfer.data !== '0x' && <Text style={s.label}>This amount excludes any tokens or NFTs the contract may move.</Text>}
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
                modules
                  ? t('mobile.smartAccountModules.authorize')
                  : authenticator
                  ? 'Authorize approval change'
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
                modules
                  ? t('mobile.smartAccountModules.authorizationHint')
                  : authenticator
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
                variant="quiet" size="compact"
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
            {customInstall && <Card style={s.card}>
              <Notice title={t('smartAccountHub.customModule')} body={t('smartAccountHub.customRisk')} tone="amber" />
              <View style={s.riskChoice}>
                <Text style={s.riskText}>{t('smartAccountHub.customRiskAck')}</Text>
                <Switch accessibilityLabel={t('smartAccountHub.customRiskAck')} value={riskAcknowledged} disabled={disabled} onValueChange={value => {
                  if (!reviewCurrent() || disabled) return;
                  const acknowledged = value ? { intent, hash } : null;
                  risk.current = acknowledged; setRiskAcknowledgement(acknowledged);
                }} />
              </View>
            </Card>}

          </>
        )}
        {payer && (
          <>
            <Notice
              title={
                payer.purpose === 'fund-account'
                  ? 'Fund the account charge'
                  : modules
                  ? t('mobile.smartAccountModules.submit')
                  : authenticator
                  ? 'Change approval method'
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
                  : modules
                  ? t('mobile.smartAccountModules.submitHint')
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
                : modules
                ? t('mobile.smartAccountModules.preparing')
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
              modules
                ? t('mobile.smartAccountModules.confirmed')
                : authenticator
                ? state.transactionHash
                  ? 'Approval method changed'
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
              modules
                ? t('mobile.smartAccountModules.confirmedHint')
                : authenticator
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
        {(guardian || authenticator || modules) &&
          state.phase === 'complete' &&
          state.metadataRefresh === 'refreshing' && (
            <Text>{modules ? t('mobile.smartAccountModules.refreshing') : 'Refreshing account status…'}</Text>
          )}
        {(guardian || authenticator || modules) &&
          state.phase === 'complete' &&
          state.metadataRefresh === 'failed' && (
            <>
              <Notice
                title={modules ? t('mobile.smartAccountModules.statusUnavailable') : 'Account status unavailable'}
                body={
                  modules
                    ? t('mobile.smartAccountModules.refreshHint')
                    : authenticator
                    ? 'The authenticator transaction is confirmed. Refresh the saved account status to see the updated owner.'
                    : 'The policy transaction is confirmed. Refresh the saved account status to see the updated policy.'
                }
                tone="amber"
              />
              <Button
                title={modules ? t('mobile.smartAccountModules.refresh') : 'Refresh account status'}
                disabled={disabled || !retryMetadata}
                onPress={() => { if (live.current && AppState.currentState === 'active') retryMetadata?.(); }}
              />
            </>
          )}
        {state.error && state.phase !== 'preparing' && (
          <Notice
            title={
              modules
                ? t('mobile.smartAccountModules.checkStatus')
                : authenticator
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
              {(authenticator || modules) && state.phase === 'complete'
                ? 'Confirmed transaction'
                : 'Latest transaction'}
            </Text>
            <Text selectable style={s.address}>
              {state.transactionHash}
            </Text>
          </Card>
        )}
      </Screen>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  contextCard: { padding: 12, gap: 6 },
  contextHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12, rowGap: 2 },
  safe: { flex: 1, backgroundColor: colors.bg },
  card: { padding: 16, gap: 10 },
  transferHeading: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  transferTitle: { flex: 1, gap: 3 },
  transferIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  transferItem: { gap: 4, paddingVertical: 8 },
  transferValue: { color: colors.text, fontSize: 28, lineHeight: 36, fontWeight: '600' },
  transferFact: { gap: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  transferAddress: { color: colors.text, fontSize: 13, lineHeight: 20 },
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
    padding: 16,
  },
  riskChoice: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  riskText: { flex: 1 },
});
