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
import { nativeI18n, useNativeTranslation } from '../platform/localization';
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
const t = nativeI18n.t.bind(nativeI18n);

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
  useNativeTranslation();
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
        <Header title={t('connections.prepareSmartAccountTitle')} onBack={() => back()} />
        {current?.closing ? (
          <Text>{t('mobile.recoveryStatusViews.operation.closingReview')}</Text>
        ) : current?.failed ? (
          <Notice
            title={t('mobile.dappConsent.dappControlReview.requestUnavailable')}
            body={t('mobile.smartSendViews.returnToYourAccountAndTryAgain')}
          />
        ) : (
          <ActivityIndicator color={colors.pink} />
        )}
        <Button
          title={t('buttons.close')}
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
  useNativeTranslation();
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
      before={<>{ledger.showConnect && <Button title={t('mobile.accounts.connectLedger')} variant="secondary" size="compact" onPress={ledger.connect} />}{ledger.modal}</>}
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
  authentication?: Pick<NativePrivateAuthenticationScope, 'isAuthenticating'>;
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
      <Text selectable style={[s.transferValue, item.value.length > 20 && s.preciseValue]} accessibilityLabel={item.symbol ? `${item.value} ${item.symbol}` : item.tokenId !== null ? t('mobile.recoveryStatusViews.operation.tokenQuantity', { id: item.tokenId, amount: item.units }) : t('mobile.recoveryStatusViews.operation.rawQuantity', { amount: item.units })}>{item.value}</Text>
      <Text style={s.unit}>{item.symbol ?? (item.tokenId !== null ? t('mobile.sendAssetViews.tokens.nftQuantity', { amount: item.units }) : t('assetTransfer.rawUnits'))}</Text>
    </View>)}
    <View style={s.transferFact}><Text style={s.label}>{t('assetTransfer.recipient')}</Text><Text selectable style={s.transferAddress}>{display.recipient}</Text></View>
    <View style={s.transferFact}><Text style={s.label}>{t('assetTransfer.contract')}</Text><Text selectable style={s.transferAddress}>{display.contract}</Text></View>
    {display.from && <View style={s.transferFact}><Text style={s.label}>{t('assetTransfer.owner')}</Text><Text selectable style={s.transferAddress}>{display.from}</Text></View>}
    {nativeUnits !== '0' && <View style={s.transferFact}><Text style={s.label}>{t('mobile.dappConsent.transactionReview.alsoSending')}</Text><Text selectable style={s.transferAddress}>{formatBaseUnits(nativeUnits, network.decimals)} {network.symbol}</Text></View>}
  </>;
  const batch = state.intent.kind === 'dapp-batch' ? state.intent : null;
  const guardian =
    state.intent.kind === 'guardian-policy' ? state.intent.command : null;
  const authenticator =
    state.intent.kind === 'authenticator' ? state.intent.command : null;
  const modules = state.intent.kind === 'modules' ? state.intent.command : null;
  const methodName = (id: string) => id === 'ecdsa' ? t('mobile.recoveryStatusViews.operation.walletOwners') : id === 'p256-webauthn' ? t('settings.passkeyAuthenticator') : id === 'slh-dsa' ? t('mobile.recoveryStatusViews.operation.postquantumKey') : id === 'composite' ? t('mobile.recoveryStatusViews.operation.combinedApprovalMethods') : t('mobile.recoveryStatusViews.operation.customApprovalMethod');
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
                  ? t('mobile.recoveryStatusViews.operation.authorizeApprovalChange')
                  : guardian
                  ? guardian.kind === 'remove'
                    ? t('mobile.recoveryStatusViews.operation.authorizeRemoval')
                    : t('mobile.recoveryStatusViews.operation.authorizePolicy')
                  : batch
                  ? t('mobile.recoveryStatusViews.operation.authorizeCalls')
                  : transfer?.kind === 'dapp-call'
                  ? t('mobile.recoveryStatusViews.operation.authorizeTransaction')
                  : transfer
                  ? t('mobile.recoveryStatusViews.operation.authorizeTransfer')
                  : t('mobile.recoveryStatusViews.operation.authorizeDeployment')
              }
              disabled={disabled || customInstall && !riskAcknowledged}
              onPress={authorizeCurrent}
            />
  ) : payer ? (
            <Button
              title={
                payer.purpose === 'fund-account'
                  ? t('mobile.recoveryStatusViews.operation.confirmFunding')
                  : modules
                  ? t('mobile.smartAccountModules.confirm')
                  : authenticator
                  ? t('mobile.recoveryStatusViews.operation.changeApprovalMethod')
                  : guardian
                  ? guardian.kind === 'remove'
                    ? t('mobile.recoveryStatusViews.operation.confirmRemoval')
                    : t('mobile.recoveryStatusViews.operation.confirmPolicy')
                  : batch
                  ? t('mobile.recoveryStatusViews.operation.confirmCalls')
                  : transfer
                  ? transfer.kind === 'dapp-call'
                    ? t('mobile.recoveryStatusViews.operation.confirmTransaction')
                    : t('mobile.recoveryStatusViews.operation.confirmTransfer')
                  : t('mobile.recoveryStatusViews.operation.confirmDeployment')
              }
              disabled={disabled}
              onPress={() => { if (live.current && AppState.currentState === 'active') confirmPayer(payer.id); }}
            />
  ) : null;
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <Screen scrollResetKey={`${state.phase}:${payer?.id ?? ''}`} footer={<>{primary}<Button title={t('buttons.close')} variant="secondary" size="compact" onPress={close} /></>}>
        <Header
          title={
            state.phase === 'authorize'
              ? modules
                ? t('mobile.smartAccountModules.review')
                : authenticator
                ? t('mobile.recoveryStatusViews.operation.changeApprovalMethod')
                : guardian
                ? guardian.kind === 'remove'
                  ? t('mobile.recoveryStatusViews.operation.reviewGuardianRemoval')
                  : t('mobile.recoveryStatusViews.operation.reviewGuardianPolicy')
                : batch
                ? t('mobile.dappConsent.transactionReview.reviewCalls')
                : transfer
                ? transfer.kind === 'dapp-call'
                  ? t('mobile.recoveryStatusViews.operation.reviewTransaction')
                  : t('mobile.smartSendViews.reviewTransfer')
                : t('mobile.recoveryStatusViews.operation.authorizeDeployment')
              : payer?.purpose === 'fund-account'
              ? t('mobile.recoveryStatusViews.operation.fundSmartAccount')
              : modules
              ? t('mobile.smartAccountModules.title')
              : authenticator
              ? t('mobile.recoveryStatusViews.operation.changeApprovalMethod')
              : guardian
              ? guardian.kind === 'remove'
                ? t('mobile.recoveryStatusViews.operation.guardianRemoval')
                : t('mobile.recoveryStatusViews.operation.guardianPolicy')
              : batch
              ? t('mobile.recoveryStatusViews.operation.sendCalls')
              : transfer
              ? t('buttons.send')
              : t('mobile.recoveryStatusViews.operation.deploySmartAccount')
          }
          onBack={close}
        />
        {before}
        <Card style={[s.card, s.contextCard]}>
          <View style={s.contextHeading}>
            <Text style={s.label}>{network.name}</Text>
            <Text style={s.label}>{t('send.chainId')}{' '}{state.network.chainId}</Text>
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
          <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.replaceHowThisAccountApprovesTransactionsReviewTheNewOwners')}</Text>
          <Card style={s.card}>
            <Text style={s.label}>{t('settings.smartAccountCurrentApprovalMethod')}</Text>
            <Text style={s.value}>{methodName(authenticator.sourceModule)}</Text>
          </Card>
          <Card style={s.card}>
            <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.newApprovalMethod')}</Text>
            <Text style={s.value}>{methodName(authenticator.targetModule.id)}</Text>
            {authenticator.targetModule.id === 'ecdsa' && <>
              <Text>{t('mobile.recoveryStatusViews.operation.ownersThreshold', { threshold: authenticator.targetModule.config.threshold, count: authenticator.targetModule.config.owners.length })}</Text>
              {authenticator.targetModule.config.owners.map((owner, index) => <View key={owner}>
                <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.ownerIndex', { index: index + 1 })}</Text><Text selectable style={s.address}>{owner}</Text>
              </View>)}
            </>}
            {authenticator.targetModule.id === 'composite' && <Text>{t('mobile.recoveryStatusViews.operation.methodsThreshold', { threshold: authenticator.targetModule.config.threshold, count: authenticator.targetModule.config.childValidators.length })}</Text>}
            {authenticator.targetModule.id === 'p256-webauthn' && <Text>{authenticator.targetModule.config.passkeyName || t('mobile.recoveryStatusViews.operation.useTheConfiguredPasskeyToApprove')}</Text>}
            {authenticator.targetModule.id === 'slh-dsa' && <Text>{t('mobile.recoveryStatusViews.operation.useTheConfiguredPostquantumKeyToApprove')}</Text>}
          </Card>
          <Button title={authorityDetails ? t('mobile.recoveryStatusViews.operation.hideApprovalDetails') : t('mobile.recoveryStatusViews.operation.viewApprovalDetails')} variant="quiet" size="compact" expanded={authorityDetails} onPress={() => setAuthorityDetails(!authorityDetails)} />
          {authorityDetails && <Card style={s.card}>
            <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.newValidatorContract')}</Text><Text selectable style={s.address}>{authenticator.target.validator}</Text>
            {authenticator.targetModule.id === 'slh-dsa' && <>
              <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.publicKeySeed')}</Text><Text selectable style={s.address}>{authenticator.targetModule.config.pkSeed}</Text>
              <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.publicKeyRoot')}</Text><Text selectable style={s.address}>{authenticator.targetModule.config.pkRoot}</Text>
              <Text style={s.label}>{t('settings.slhDsaModuleHint')}</Text>
            </>}
            {authenticator.targetModule.id === 'composite' && authenticator.targetModule.config.childValidators.map(address => <Text key={address} selectable style={s.address}>{address}</Text>)}
            <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.newApprovalConfiguration')}</Text><Text selectable style={s.address}>{authenticator.target.data}</Text>
          </Card>}
        </>}
        {guardian && (
          <Card style={s.card}>
            <Text style={s.label}>
              {guardian.kind === 'remove'
                ? t('mobile.recoveryDevices.guardianPolicy.removeGuardian')
                : guardian.kind === 'install'
                ? t('mobile.recoveryDevices.guardianPolicy.setGuardian')
                : t('mobile.recoveryDevices.guardianPolicy.updateGuardian')}
            </Text>
            {guardian.kind === 'remove' ? (
              <>
                <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.guardianRecoveryModule')}</Text>
                <Text selectable style={s.address}>
                  {guardian.moduleAddress}
                </Text>
                <Text style={s.label}>
                  {t('mobile.recoveryStatusViews.operation.thisRemovesTheAccountsGuardianRecoveryModule')}</Text>
              </>
            ) : (
              <>
                <Text selectable style={s.address}>
                  {guardian.guardian}
                </Text>
                <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.guardianThreshold1')}</Text>
                <Text style={s.label}>
                  {t('mobile.recoveryStatusViews.operation.recoveryDelay', { delay: guardianDelayLabel(guardian.delaySeconds, t) })}
                </Text>
                <Text style={s.label}>
                  {t('mobile.recoveryStatusViews.operation.finalizationWindow', { window: guardianDelayLabel(guardian.delaySeconds * 2, t) })}
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
                {t('mobile.dappConsent.transactionReview.callOf', { index: index + 1, count: batch.calls.length })}
              </Text>
              {display ? assetSummary(display, BigInt(call.value).toString()) : <>
                <Text style={s.label}>{call.data === '0x' ? t('send.to') : t('transactionDisplay.contract')}</Text>
                <Text selectable style={s.address}>{call.to}</Text>
                <Text style={s.label}>{t('assetTransfer.nativeValue')}</Text>
                {amount(BigInt(call.value).toString())}
                {call.data !== '0x' && <Text style={s.label}>{t('mobile.dappConsent.transactionReview.thisAmountExcludesAnyTokensOrNfts')}</Text>}
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
                <Text style={s.label}>{t('settings.decimals')}{' '}{transfer.token.decimals}</Text>
              </>
            )}
            <Text style={s.label}>{transfer.kind === 'dapp-call' && transfer.data !== '0x' ? t('transactionDisplay.contract') : t('send.to')}</Text>
            <Text selectable style={s.address}>
              {transfer.recipient}
            </Text>
            {transfer.kind === 'nft-transfer' && (
              <>
                <Text style={s.label}>{transfer.tokenStandard}</Text>
                <Text selectable style={s.address}>
                  {transfer.contractAddress}
                </Text>
                <Text style={s.label}>{t('send.tokenId')}</Text>
                <Text selectable style={s.address}>
                  {transfer.tokenId}
                </Text>
              </>
            )}
            <Text style={s.label}>
              {transfer.kind === 'nft-transfer' ? t('mobile.activityViews.nativeActivity.quantity') : transfer.kind === 'dapp-call' && transfer.data !== '0x' ? t('assetTransfer.nativeValue') : t('send.amount')}
            </Text>
            {transfer.kind === 'nft-transfer' ? (
              <Text selectable style={s.value}>
                {transfer.amountUnits}
              </Text>
            ) : transfer.kind === 'native-max' ? (
              <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.calculatingMaximum')}</Text>
            ) : (
              amount(
                transfer.amountUnits,
                transfer.kind === 'erc20-transfer' ? transfer.token : undefined
              )
            )}
            {transfer.kind === 'dapp-call' && transfer.data !== '0x' && <Text style={s.label}>{t('mobile.dappConsent.transactionReview.thisAmountExcludesAnyTokensOrNfts')}</Text>}
          </Card>
        )}
        {transfer?.kind === 'dapp-call' && (
          <Card style={s.card}>
            <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.transactionData')}</Text>
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
                  ? t('mobile.recoveryStatusViews.operation.authorizeApprovalChange')
                  : guardian
                  ? guardian.kind === 'remove'
                    ? t('mobile.recoveryStatusViews.operation.authorizeGuardianRemoval')
                    : t('mobile.recoveryStatusViews.operation.authorizeThisGuardianPolicy')
                  : batch
                  ? t('mobile.recoveryStatusViews.operation.authorizeTheseCalls')
                  : transfer
                  ? transfer.kind === 'dapp-call'
                    ? t('mobile.recoveryStatusViews.operation.authorizeThisTransaction')
                    : t('mobile.recoveryStatusViews.operation.authorizeThisTransfer')
                  : t('mobile.recoveryStatusViews.operation.createThisAccountOnTheNetwork')
              }
              body={
                modules
                  ? t('mobile.smartAccountModules.authorizationHint')
                  : authenticator
                  ? authenticator.targetModule.id === 'slh-dsa'
                    ? t('settings.slhDsaSetupConfirmDescription')
                    : t('mobile.recoveryStatusViews.operation.authorizeReplacingTheCurrentAuthenticatorSettingsWithTheOwnerAnd')
                  : guardian
                  ? guardian.kind === 'remove'
                    ? t('mobile.recoveryStatusViews.operation.authorizeRemovingGuardianRecoveryFromThisAccountTheFollowingReview')
                    : t('mobile.recoveryStatusViews.operation.authorizeTheGuardianAndRecoveryDelayShownAboveTheFollowing')
                  : batch
                  ? t('mobile.recoveryStatusViews.operation.authorizeTheOrderedCallsTogetherTheFollowingReviewConfirmsThe')
                  : transfer
                  ? transfer.kind === 'dapp-call'
                    ? t('mobile.recoveryStatusViews.operation.authorizeThisSmartAccountTransactionTheFollowingReviewConfirmsThe')
                    : t('mobile.recoveryStatusViews.operation.authorizeThisSmartAccountTransferTheFollowingReviewConfirmsThe')
                  : t('mobile.recoveryStatusViews.operation.authorizeTheAccountsDeploymentThisOperationSendsNoAssetsThe')
              }
            />
            <Card style={s.card}>
              <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.maximumAccountCharge')}</Text>
              {amount(state.maximumPrefundUnits!)}
              <Text style={s.label}>
                {t('mobile.recoveryStatusViews.operation.unusedPrefundStaysWithYourAccount')}</Text>
              <Button
                title={
                  details
                    ? t('mobile.recoveryStatusViews.operation.hideAuthorizationDetails')
                    : t('mobile.recoveryStatusViews.operation.viewAuthorizationDetails')
                }
                variant="quiet" size="compact"
                expanded={details}
                onPress={() => setDetails(!details)}
              />
              {details && (
                <>
                  <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.userOperationNonce')}</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.nonce}
                  </Text>
                  <Text style={s.label}>EntryPoint</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.entryPoint}
                  </Text>
                  <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.accountCreationData')}</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.initCode}
                  </Text>
                  <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.accountCallData')}</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.callData}
                  </Text>
                  <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.authorizationHash')}</Text>
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
                  ? t('mobile.recoveryStatusViews.operation.fundTheAccountCharge')
                  : modules
                  ? t('mobile.smartAccountModules.submit')
                  : authenticator
                  ? t('mobile.recoveryStatusViews.operation.changeApprovalMethod')
                  : guardian
                  ? guardian.kind === 'remove'
                    ? t('mobile.recoveryStatusViews.operation.submitTheAuthorizedRemoval')
                    : t('mobile.recoveryStatusViews.operation.submitTheAuthorizedGuardianPolicy')
                  : batch
                  ? t('mobile.recoveryStatusViews.operation.submitTheAuthorizedCalls')
                  : transfer
                  ? transfer.kind === 'dapp-call'
                    ? t('mobile.recoveryStatusViews.operation.submitTheAuthorizedTransaction')
                    : t('mobile.recoveryStatusViews.operation.submitTheAuthorizedTransfer')
                  : t('mobile.recoveryStatusViews.operation.submitTheAuthorizedDeployment')
              }
              body={
                payer.purpose === 'fund-account'
                  ? t('mobile.recoveryStatusViews.operation.moveThisAmountToYourSmartAccountSoItCan')
                  : modules
                  ? t('mobile.smartAccountModules.submitHint')
                  : authenticator
                  ? t('smartAccountHub.compositeOnchainHint')
                  : guardian
                  ? guardian.kind === 'remove'
                    ? t('mobile.recoveryStatusViews.operation.thisTransactionSubmitsTheGuardianRemovalYouAuthorized')
                    : t('mobile.recoveryStatusViews.operation.thisTransactionSubmitsTheGuardianPolicyYouAuthorized')
                  : batch
                  ? t('mobile.recoveryStatusViews.operation.thisTransactionSubmitsTheCallsYouAuthorized')
                  : transfer
                  ? transfer.kind === 'dapp-call'
                    ? t('mobile.recoveryStatusViews.operation.thisTransactionSubmitsTheOperationYouAuthorized')
                    : t('mobile.recoveryStatusViews.operation.thisTransactionSubmitsTheTransferYouAuthorized')
                  : t('mobile.recoveryStatusViews.operation.thisTransactionSubmitsYourExistingDeploymentAuthorization')
              }
            />
            <Card style={s.card}>
              <Text style={s.label}>{t('mobile.recoveryStatusViews.operation.payingAccount')}</Text>
              <Text selectable style={s.address}>
                {payer.transaction.from}
              </Text>
              <Text style={s.label}>{t('send.amount')}</Text>
              {amount(payer.transaction.value)}
              <Text style={s.label}>
                {payer.coveredFeeUnits !== '0'
                  ? t('mobile.recoveryStatusViews.operation.maximumNetworkFeeGasTank')
                  : t('transactions.replay.maximumFee')}
              </Text>
              {amount(payer.maximumFeeUnits)}
              <Text style={s.label}>
                {payer.coveredFeeUnits !== '0'
                  ? t('mobile.recoveryStatusViews.operation.maximumFromPayingAccount')
                  : t('privacy.deposit.total')}
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
                ? t('mobile.recoveryStatusViews.operation.waitingForTheNetwork')
                : modules
                ? t('mobile.smartAccountModules.preparing')
                : authenticator
                ? t('mobile.recoveryStatusViews.operation.preparingAuthenticatorChange')
                : guardian
                ? guardian.kind === 'remove'
                  ? t('mobile.recoveryStatusViews.operation.preparingRemoval')
                  : t('mobile.recoveryStatusViews.operation.preparingGuardianPolicy')
                : batch
                ? t('mobile.recoveryStatusViews.operation.preparingCalls')
                : transfer
                ? t('mobile.recoveryStatusViews.operation.preparingTransfer')
                : t('mobile.recoveryStatusViews.operation.preparingDeployment')}
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
                  ? t('mobile.recoveryStatusViews.operation.approvalMethodChanged')
                  : t('settings.smartAccountAuthenticatorConfigured')
                : guardian
                ? guardian.kind === 'remove'
                  ? t('mobile.recoveryStatusViews.operation.guardianRecoveryRemoved')
                  : t('mobile.recoveryStatusViews.operation.guardianPolicyUpdated')
                : batch
                ? t('mobile.recoveryStatusViews.operation.callsSubmitted')
                : transfer?.kind === 'dapp-call'
                ? t('privacy.deposit.submitted')
                : transfer
                ? t('mobile.recoveryStatusViews.operation.transferSubmitted')
                : t('mobile.recoveryStatusViews.operation.smartAccountDeployed')
            }
            body={
              modules
                ? t('mobile.smartAccountModules.confirmedHint')
                : authenticator
                ? state.transactionHash
                  ? t('mobile.recoveryStatusViews.operation.theNetworkConfirmedTheAuthenticatorChange')
                  : t('settings.smartAccountCurrentApprovalMethodHint')
                : guardian
                ? guardian.kind === 'remove'
                  ? t('mobile.recoveryStatusViews.operation.theNetworkConfirmedThisGuardianRemovalTransaction')
                  : t('mobile.recoveryStatusViews.operation.theNetworkConfirmedThisGuardianPolicyTransaction')
                : batch
                ? t('mobile.recoveryStatusViews.operation.theConnectedAppCanCheckThisCallBundlesStatus')
                : transfer
                ? t('mobile.recoveryStatusViews.operation.followThisTransactionInActivity')
                : t('mobile.recoveryStatusViews.operation.yourAccountIsAvailableOnThisNetwork')
            }
          />
        )}
        {(guardian || authenticator || modules) &&
          state.phase === 'complete' &&
          state.metadataRefresh === 'refreshing' && (
            <Text>{t('mobile.smartAccountModules.refreshing')}</Text>
          )}
        {(guardian || authenticator || modules) &&
          state.phase === 'complete' &&
          state.metadataRefresh === 'failed' && (
            <>
              <Notice
                title={t('mobile.smartAccountModules.statusUnavailable')}
                body={
                  modules
                    ? t('mobile.smartAccountModules.refreshHint')
                    : authenticator
                    ? t('mobile.recoveryStatusViews.operation.theAuthenticatorTransactionIsConfirmedRefreshTheSavedAccountStatus')
                    : t('mobile.recoveryStatusViews.operation.thePolicyTransactionIsConfirmedRefreshTheSavedAccountStatus')
                }
                tone="amber"
              />
              <Button
                title={t('mobile.smartAccountModules.refresh')}
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
                ? t('mobile.recoveryStatusViews.operation.checkAuthenticatorStatus')
                : guardian
                ? guardian.kind === 'remove'
                  ? t('settings.smartAccountGuardianRecoveryCheckRemoval')
                  : t('mobile.recoveryStatusViews.operation.checkGuardianPolicyStatus')
                : batch
                ? t('mobile.recoveryStatusViews.operation.checkCallsStatus')
                : transfer
                ? t('mobile.recoveryStatusViews.operation.checkTransferStatus')
                : t('mobile.recoveryStatusViews.operation.checkDeploymentStatus')
            }
            body={state.error}
            tone="amber"
          />
        )}
        {state.transactionHash && (
          <Card style={s.card}>
            <Text style={s.label}>
              {(authenticator || modules) && state.phase === 'complete'
                ? t('mobile.recoveryStatusViews.operation.confirmedTransaction')
                : t('mobile.recoveryStatusViews.operation.latestTransaction')}
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
