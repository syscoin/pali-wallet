import React, { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { getNativeSendContext, nativeSigningEnabled } from '../custody/networkContext';
import { getTestnetFaucet, openTestnetFaucet } from '../custody/testnetFaucet';
import { formatBalanceDelta, formatBaseUnits } from '../core/amounts';
import { canUseUtxoCustodyAddress } from '../core/utxoAddresses';
import type { BalanceReader } from '../core/watchOnlyAuthority';
import { createBalanceReader } from '../platformRpc';
import { walletFetch } from '../platform/http';
import { useNativeCoinQuote } from '../portfolio/useNativeCoinQuote';
import { NativePortfolioController } from '../portfolio/nativePortfolio';
import type { NativeTokenView } from '../portfolio/nativeTokens';
import type { SavedCollectible } from '../portfolio/tokenRegistry';
import { NativeTokens } from './NativeTokens';
import { PortfolioQuote } from './PortfolioQuote';
import { AssetMarketCard } from '../portfolio/AssetMarketCard';
import { TestnetFaucetCard } from './TestnetFaucetCard';
import type { ShellLeafNavigation } from './RealAppShell';
import type { Erc20Metadata } from '../../../../source/shared/erc20';
import { supportsSptUtxoChain, type SptBalance } from '../../../../source/shared/sptInventory';
import { NativeSptAssets } from './NativeSptAssets';
import type { NativeCatalogueAccount } from '../custody/walletCatalogue';
import type { NativePortfolioAccount, NativePortfolioSnapshot, PublicCustodySource } from '../portfolio/nativePortfolio';
import { Button, Card, Coin, colors, Header, IconButton, Notice, Row, Screen, styles, Text } from '../ui';
import { useNativeTranslation } from '../platform/localization';

type Props = {
  source: PublicCustodySource;
  hardwareRequest?: React.ReactNode;
  smartAccount?: NativeCatalogueAccount['smartAccount'];
  onDeploySmartAccount?(): void;
  onUseWalletAuthenticator?(): void;
  onManageSlhDsa?(): void;
  onManageSmartAccountModules?(): void;
  onExit(): void;
  onLock(): void;
  onViewRecovery(): void;
  onSecurity?(): void;
  onSend?(): void;
  onSendSpt?(asset: SptBalance): void;
  onSendToken?(token: Erc20Metadata): void;
  onSendCollectible?(collectible: SavedCollectible): void;
  reader?: BalanceReader;
  accountLabel?: string;
  onManageAccounts?(): void;
  onManageNetworks?(): void;
  onActivity?(): void;
  tokenView?: NativeTokenView;
  navigation?: ShellLeafNavigation;
};
type Feedback = { scope: string; text: string; failed?: boolean } | null;
const scopeOf = (account: NativePortfolioAccount) => `${account.revision}:${account.network}:${account.address}`;

/** Only the custody authority's public account projection reaches this screen. */
export function NativePortfolio({ hardwareRequest, source, smartAccount, onDeploySmartAccount, onUseWalletAuthenticator, onManageSlhDsa, onManageSmartAccountModules, onExit, onLock, onViewRecovery, onSecurity, onSend, onSendSpt, onSendToken, onSendCollectible, reader, accountLabel = 'Account 1', onManageAccounts, onManageNetworks, onActivity, tokenView, navigation }: Props) {
  const balanceReader = useMemo(() => reader ?? createBalanceReader({ fetch: walletFetch, registrations: () => source.getCatalogue?.()?.networks }), [reader, source]);
  const model = useMemo(() => new NativePortfolioController(source, balanceReader), [source, balanceReader]);
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useLayoutEffect(() => model.connect(), [model]);
  const scope = snapshot.account ? scopeOf(snapshot.account) : 'unavailable';
  return <NativePortfolioContent hardwareRequest={hardwareRequest} smartAccount={smartAccount} onDeploySmartAccount={onDeploySmartAccount} onUseWalletAuthenticator={onUseWalletAuthenticator} onManageSlhDsa={onManageSlhDsa} onManageSmartAccountModules={onManageSmartAccountModules} key={scope} model={model} snapshot={snapshot} onExit={onExit} onLock={onLock} onViewRecovery={onViewRecovery} onSecurity={onSecurity} onSend={onSend} onSendSpt={onSendSpt} onSendToken={onSendToken} onSendCollectible={onSendCollectible} accountLabel={accountLabel} onManageAccounts={onManageAccounts} onManageNetworks={onManageNetworks} onActivity={onActivity} tokenView={tokenView} navigation={navigation} />;
}

function NativePortfolioContent({ hardwareRequest, model, snapshot, smartAccount, onDeploySmartAccount, onUseWalletAuthenticator, onManageSlhDsa, onManageSmartAccountModules, onExit, onLock, onViewRecovery, onSecurity, onSend, onSendSpt, onSendToken, onSendCollectible, accountLabel, onManageAccounts, onManageNetworks, onActivity, tokenView, navigation }: Omit<Props, 'source' | 'reader' | 'accountLabel'> & {
  model: NativePortfolioController; snapshot: NativePortfolioSnapshot; accountLabel: string;
}) {
  const { t } = useNativeTranslation();
  const [receiveScope, setReceiveScope] = useState<string | null>(null);
  const [tokenTitle, setTokenTitle] = useState<string | null>(null);
  const [nativeDetailScope, setNativeDetailScope] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pendingAction, setPendingAction] = useState<'copy' | 'share' | 'faucet' | null>(null);
  const { width, fontScale } = useWindowDimensions();
  const receiveQrSize = width <= 340 ? 176 : 204;
  const stackActions = fontScale >= 1.6 && width < 240 * fontScale;
  const actionStyle = [s.flex, width <= 340 && s.compactAction, stackActions && s.stackedAction];
  const lifecycle = useRef({ alive: false, epoch: 0, busy: false });
  const tokenBack = useRef<(() => boolean) | null>(null);
  const setTokenBack = useCallback((handler: (() => boolean) | null) => { tokenBack.current = handler; }, []);
  const account = snapshot.account;
  const utxo = model.getUtxoNetwork(account?.network);
  const registration = account && !utxo ? model.getNetworkRegistration(account.network) : null;
  const network = utxo ? { ...utxo, networkId: utxo.symbol } : registration ? getNativeSendContext(registration)
    : { networkId: '', name: 'Network', symbol: '', decimals: 18, testnet: false };
  const networkName = network.name;
  const symbol = network.symbol;
  const scope = account ? scopeOf(account) : null;
  const canReceive = !!account && (!utxo || canUseUtxoCustodyAddress(account.address, utxo));
  const receiving = canReceive && receiveScope === scope;
  const nativeDetail = scope !== null && nativeDetailScope === scope;
  const loading = snapshot.status === 'loading';
  const canSend = !!onSend && (utxo !== undefined ||
    !!registration && nativeSigningEnabled(registration.id, [registration]));
  const faucet = registration ? getTestnetFaucet(registration) : null;

  const invalidateActions = useCallback(() => {
    lifecycle.current.epoch++; lifecycle.current.busy = false;
    setPendingAction(null); setFeedback(null);
  }, []);
  useLayoutEffect(() => {
    const current = lifecycle.current;
    current.alive = true;
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') invalidateActions(); });
    return () => { current.alive = false; current.epoch++; current.busy = false; subscription.remove(); };
  }, [invalidateActions]);
  useLayoutEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (receiving) { setReceiveScope(null); invalidateActions(); return true; }
      if (nativeDetail) { setNativeDetailScope(null); return true; }
      return false;
    });
    return () => back.remove();
  }, [receiving, nativeDetail, invalidateActions]);

  const handleBack = () => { if (receiving) { setReceiveScope(null); invalidateActions(); return true; } if (nativeDetail) { setNativeDetailScope(null); return true; } return tokenBack.current?.() ?? false; };
  const back = () => { if (!handleBack()) onExit(); };
  useLayoutEffect(() => navigation?.registerBack(handleBack));
  useLayoutEffect(() => { navigation?.setImmersive(receiving || nativeDetail || !!tokenTitle); return () => navigation?.setImmersive(false); }, [navigation, receiving, nativeDetail, tokenTitle]);
  const publicAction = async (kind: 'copy' | 'share' | 'faucet') => {
    const current = account;
    if (!canReceive || !current || !model.isCurrent(current) || lifecycle.current.busy) return;
    if (kind === 'faucet' && AppState.currentState !== 'active') return;
    lifecycle.current.busy = true;
    const request = ++lifecycle.current.epoch;
    setPendingAction(kind); setFeedback(null);
    try {
      if (!model.isCurrent(current)) return;
      let completed = true;
      if (kind === 'copy') {
        const copied = await Clipboard.setStringAsync(current.address);
        if (copied === false) throw new Error('COPY_FAILED');
      }
      else if (kind === 'share') {
        const result = await Share.share({ title: `${networkName} receive address`, message: `${networkName} (${symbol}) address\n${current.address}` });
        completed = !result || result.action === Share.sharedAction;
      } else {
        await openTestnetFaucet(model.getNetworkRegistration(current.network), (url) => Linking.openURL(url), () => {
          if (!lifecycle.current.alive || lifecycle.current.epoch !== request || AppState.currentState !== 'active' || !model.isCurrent(current))
            throw new Error('CANCELLED');
        });
      }
      if (lifecycle.current.alive && lifecycle.current.epoch === request && model.isCurrent(current) && completed)
        setFeedback({ scope: scopeOf(current), text: kind === 'copy' ? `${networkName} address copied.` : kind === 'share' ? `${networkName} address shared.` : 'Faucet opened in your browser. Paste your address there to request test funds.' });
    } catch {
      if (lifecycle.current.alive && lifecycle.current.epoch === request && model.isCurrent(current))
        setFeedback({ scope: scopeOf(current), text: kind === 'copy' ? 'Could not copy this address. Try again.' : kind === 'share' ? 'Could not share this address. Try again.' : 'Could not open the faucet. Try again.', failed: true });
    } finally {
      if (lifecycle.current.alive && lifecycle.current.epoch === request) { lifecycle.current.busy = false; setPendingAction(null); }
    }
  };

  const amount = snapshot.status === 'available' && snapshot.units !== null ? formatBaseUnits(snapshot.units, network.decimals) : null;
  const quote = useNativeCoinQuote(!receiving && !tokenTitle ? account?.network ?? null : null, amount, registration);
  const pending = snapshot.pendingDeltaUnits;
  const statusText = loading ? `Loading ${networkName} balance…` : snapshot.status === 'error' ? 'Balance unavailable' : 'Balance not loaded';
  const currentFeedback = feedback?.scope === scope ? feedback : null;
  const faucetCard = faucet && account && <TestnetFaucetCard registration={registration!} busy={!!pendingAction} opening={pendingAction === 'faucet'} onCopy={receiving ? undefined : () => void publicAction('copy')} onOpen={() => void publicAction('faucet')} />;
  const feedbackView = currentFeedback && <Text accessibilityRole={currentFeedback.failed ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[s.feedback, currentFeedback.failed && { color: colors.red }]}>{currentFeedback.text}</Text>;
  const actions = receiving ? <View style={[s.actions, stackActions && s.stackedActions]}>
    <Button title="Copy address" icon="copy" style={actionStyle} size="compact" disabled={!account || !!pendingAction} onPress={() => publicAction('copy')} testID="native-receive-copy" />
    <Button title="Share address" icon="share" variant="secondary" style={actionStyle} size="compact" disabled={!account || !!pendingAction} onPress={() => publicAction('share')} testID="native-receive-share" />
  </View> : undefined;
  const nativeCoinCard = account && <Card><Row title={symbol} subtitle={networkName} icon={<Coin id={network.networkId} size={32} />}
    right={<Text style={s.assetBalance}>{amount ?? '—'} {symbol}</Text>}
    onPress={() => { if (model.isCurrent(account)) setNativeDetailScope(scopeOf(account)); }} last />
  </Card>;

  return <SafeAreaView edges={navigation && !receiving && !nativeDetail && !tokenTitle ? ['top'] : ['top', 'bottom']} style={s.safeArea}>
    <Screen key={receiving ? 'receive' : 'portfolio'} scrollResetKey={nativeDetail ? 'native-asset' : tokenTitle ?? 'portfolio'} footer={actions} footerScrollable={receiving} gap={receiving ? 12 : 16}>
      <Header title={receiving ? `Receive ${symbol}` : nativeDetail ? networkName : tokenTitle ?? 'Pali Wallet'} subtitle={`${accountLabel} · ${networkName}${network.testnet ? ' · Test network' : ''}`} onBack={receiving || nativeDetail || !!tokenTitle ? back : undefined} brand={!receiving && !nativeDetail && !tokenTitle} right={!receiving && !tokenTitle ? <View style={s.toolbar}>
        {canSend && <IconButton label={loading ? 'Refreshing balance' : 'Refresh balance'} icon="refresh" disabled={loading} onPress={() => model.refresh()} testID="native-portfolio-refresh" />}
        {!nativeDetail && onManageAccounts && <IconButton label="Accounts" icon="wallet" onPress={onManageAccounts} />}
      </View> : undefined} />
      {!account ? <Notice title="Wallet locked" body="Unlock your wallet to view its account." /> : receiving ? <>
        <View style={s.identity}><Coin id={network.networkId} size={36} /><Text style={s.network}>{networkName}</Text></View>
        <View style={s.qr} accessible accessibilityRole="image" accessibilityLabel={`QR code for ${networkName} address ${account.address}`} testID="native-receive-qr">
          <QRCode value={account.address} size={receiveQrSize} quietZone={16} backgroundColor="#ffffff" color={colors.bg} ecl="M" />
        </View>
        <Text selectable style={s.receiveAddress} accessibilityLabel={`${networkName} address ${account.address}`} testID="native-receive-address">{account.address}</Text>
        {feedbackView}
        <Notice title="Check the network" body={`Use ${networkName}${network.testnet ? ' (test network)' : ''} for this address. Check the network in the sending wallet before transferring funds.`} />
        {faucetCard}
      </> : <>
        {!tokenTitle && <>
        {!nativeDetail && hardwareRequest}
        {!nativeDetail && onDeploySmartAccount && <Button title="Deploy smart account" variant="secondary" onPress={onDeploySmartAccount} />}
        <View style={s.hero}>
          <Coin id={network.networkId} size={46} />
          <Text style={s.label}>{networkName.toUpperCase()} {utxo ? 'CONFIRMED BALANCE' : 'BALANCE'}</Text>
          <Text style={[s.amount, amount !== null && amount.length > 14 && styles.walletBalanceLong, amount !== null && amount.length > 20 && styles.walletBalancePrecise]} accessibilityLabel={amount === null ? statusText : `${networkName} balance ${amount} ${symbol}`} testID="native-portfolio-balance">{amount ?? '—'}</Text>
          <Text style={s.unit}>{amount === null ? statusText : symbol}</Text>
          <PortfolioQuote {...quote} testID="native-portfolio-quote" />
          {pending !== undefined && pending !== '0' &&
            <Text style={s.unit}>Pending {formatBalanceDelta(pending, network.decimals)} {symbol}</Text>}
          {loading && <ActivityIndicator color={colors.pink} accessibilityLabel={`Loading ${networkName} balance`} />}
          {snapshot.status === 'available' && snapshot.updatedAt !== null && <Text style={s.freshness}>Updated {new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>}
        </View>
        {!nativeDetail && smartAccount && <Card style={{ padding: 16, gap: 10 }}><Text style={s.label}>SMART ACCOUNT</Text>
          <Text style={styles.muted}>Managed by {smartAccount.managementAddress}</Text>
          <Text style={styles.muted}>{smartAccount.isDeployed ? t(canSend ? 'settings.smartAccountInfrastructureReadyStatus' : 'settings.unavailable') : t('settings.smartAccountUndeployedNotice')}</Text>
          {smartAccount.isDeployed && onManageSmartAccountModules && <Button title={t('mobile.smartAccountModules.title')} variant="secondary" onPress={() => { if (account && model.isCurrent(account)) onManageSmartAccountModules(); }} />}
          {onManageSlhDsa && <Button title={t('settings.slhDsaAuthenticator')} variant="secondary" onPress={() => { if (account && model.isCurrent(account)) onManageSlhDsa(); }} />}
          {onUseWalletAuthenticator && <Button title="Use Pali wallet" variant="secondary" onPress={() => { if (account && model.isCurrent(account)) onUseWalletAuthenticator(); }} />}
        </Card>}
        {snapshot.status === 'error' && <Notice title="Could not load your balance" body={canReceive ? `Your ${networkName} address is still available. Refresh to try again.` : 'Refresh to try again.'} tone="amber" />}
        {!canSend && !smartAccount && <Notice title={canReceive ? network.testnet ? 'Test network · Balance and receive only' : 'Balance and receive only' : 'Balance only'} body="Sending is not available for this account in this build." />}
        <View style={[s.actions, stackActions && s.stackedActions]}>
          {canSend && <Button title="Send" icon="arrow-up-right" style={actionStyle} onPress={() => { if (account && model.isCurrent(account)) onSend?.(); }} />}
          {canReceive && <Button title="Receive" variant={canSend ? 'secondary' : 'primary'} icon="arrow-down-left" style={actionStyle} testID="native-portfolio-receive" onPress={() => { if (account && model.isCurrent(account)) { invalidateActions(); setReceiveScope(scopeOf(account)); } }} />}
          {!canSend && <Button title={loading ? 'Refreshing…' : 'Refresh'} icon="refresh" variant="secondary" style={actionStyle} disabled={loading} onPress={() => model.refresh()} testID="native-portfolio-refresh" />}
        </View>
        {nativeDetail ? <>
          <AssetMarketCard asset={{ kind: 'native', networkId: account.network, registration }} />
          {canReceive && <Card style={s.assetAddress}><Text style={s.label}>{accountLabel.toUpperCase()} · {networkName.toUpperCase()}</Text><Text selectable style={s.address}>{account.address}</Text></Card>}
        </> : (!tokenView || utxo) && <View style={s.assetList}>
          <Text accessibilityRole="header" style={s.assetHeading}>Assets</Text>
          {nativeCoinCard}
        </View>}
        {faucetCard}
        </>}
        <View style={nativeDetail ? { display: 'none' } : s.assetList} accessibilityElementsHidden={nativeDetail} aria-hidden={nativeDetail}>
        {utxo && supportsSptUtxoChain(utxo.chainId) && <NativeSptAssets key={scope} holdings={snapshot.assets?.status === 'available' ? snapshot.assets.holdings : null} loading={loading}
          onModeChange={setTokenTitle} onBackHandlerChange={setTokenBack}
          onReceive={canReceive ? () => { if (account && model.isCurrent(account)) { invalidateActions(); setReceiveScope(scopeOf(account)); } } : undefined}
          onRefresh={() => { if (account && model.isCurrent(account)) void model.refresh(); }}
          onSend={account && onSendSpt ? asset => { if (model.isCurrent(account)) onSendSpt(asset); } : undefined} />}
        {tokenView && !utxo && <NativeTokens registration={registration} nativeAsset={nativeCoinCard} controller={tokenView} onBackHandlerChange={setTokenBack} onModeChange={setTokenTitle}
          onSend={account && onSendToken ? (token) => { if (model.isCurrent(account)) onSendToken(token); } : undefined}
          onSendCollectible={account && onSendCollectible ? (collectible) => { if (model.isCurrent(account)) onSendCollectible(collectible); } : undefined}
          onReceive={() => { if (account && model.isCurrent(account)) { invalidateActions(); setReceiveScope(scopeOf(account)); } }} />}
        </View>
        {!nativeDetail && !tokenTitle && <Card style={s.tools}>{onActivity && <Row title="Activity" subtitle="Transactions and token transfer events" icon="clock" onPress={onActivity} />}{onManageNetworks && <Row title="Network" subtitle={`${networkName}${network.testnet ? ' · Test network' : ''}`} icon="globe" onPress={onManageNetworks} />}<Row title={onSecurity ? "Security & backups" : "View recovery phrase"} subtitle={onSecurity ? "Recovery phrase and account key" : "Confirm your password to continue"} icon="shield" onPress={onSecurity ?? onViewRecovery} /><Row title="Lock wallet" icon="lock" onPress={onLock} last /></Card>}
      </>}
      {!receiving && feedbackView}
      {typeof __DEV__ !== 'undefined' && __DEV__ && <Text style={s.buildLabel}>Development build · Use a test wallet</Text>}
    </Screen>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 }, actions: { flexDirection: 'row', gap: 11 },
  compactAction: { paddingHorizontal: 8 },
  stackedActions: { flexDirection: 'column' },
  stackedAction: { flex: 0 },
  toolbar: { flexDirection: 'row' },
  hero: { alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 4 },
  label: { color: colors.muted, fontSize: 11, lineHeight: 17, fontWeight: '600', letterSpacing: 1 },
  amount: { fontSize: 36, lineHeight: 46, fontWeight: '600', textAlign: 'center', letterSpacing: -1.1, alignSelf: 'stretch', flexShrink: 1 },
  unit: { color: colors.muted, fontSize: 15, lineHeight: 22 }, freshness: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  privacy: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  assetAddress: { padding: 16, gap: 8 }, assetList: { gap: 12 }, assetHeading: { fontSize: 18, lineHeight: 26, fontWeight: '600' }, assetBalance: { fontSize: 13, lineHeight: 20, fontWeight: '600', textAlign: 'right', flexShrink: 1, maxWidth: '45%' }, address: { color: colors.text, fontSize: 14, lineHeight: 23 },
  tools: { overflow: 'hidden' }, identity: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 }, network: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  qr: { alignSelf: 'center', backgroundColor: '#ffffff', padding: 10, borderRadius: 20, maxWidth: '100%' },
  receiveAddress: { color: colors.text, fontSize: 14, lineHeight: 22, textAlign: 'center', marginHorizontal: 4 },
  feedback: { color: colors.green, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  buildLabel: { color: colors.muted, fontSize: 11, lineHeight: 18, textAlign: 'center' },
});
