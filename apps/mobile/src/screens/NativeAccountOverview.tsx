import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NotificationChoice } from '../notifications/choices';
import { AccountPortfolioController, type AccountPortfolioRow } from '../portfolio/accountPortfolio';
import { formatBaseUnits } from '../core/amounts';
import { formatTokenUnits, type Erc20Metadata } from '../../../../source/shared/erc20';
import { formatIndicativeFiat } from '../portfolio/fiatDisplay';
import { useFiatCurrency } from '../platform/fiatPreferences';
import { HIDDEN_BALANCE, useBalancePrivacy } from '../platform/balancePrivacy';
import { nativeSigningEnabled } from '../custody/networkContext';
import { Button, Card, Coin, colors, Header, Icon, IconButton, Row, Screen, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';
import { NativePortfolio, type NativePortfolioProps } from './NativePortfolio';
import { NetworkSourceSheet, type NetworkSourceOption } from './NetworkSourceSheet';
import { WalletBackupBadge } from './WalletBackupBadge';
import { compactActivityAmountLabel } from '../activity/activityAmountLabel';
import { useNativeTranslation } from '../platform/localization';

export function NativePortfolioRoute({ overview, selectNetwork, sendFrom, cancelSelection, ...portfolio }: NativePortfolioProps & {
  overview?: AccountPortfolioController | null;
  selectNetwork(choice: NotificationChoice, assertCurrent: () => void): Promise<void>;
  sendFrom(choice: NotificationChoice, token: Erc20Metadata | undefined, assertCurrent: () => void): Promise<void>;
  cancelSelection?(): void;
}) {
  return overview ? <NativeAccountOverview controller={overview} portfolio={portfolio} selectNetwork={selectNetwork} send={sendFrom} cancelSelection={cancelSelection} /> : <NativePortfolio {...portfolio} />;
}

export function NativeAccountOverview({ controller, portfolio, selectNetwork, send, cancelSelection }: {
  controller: AccountPortfolioController;
  portfolio: NativePortfolioProps;
  selectNetwork(choice: NotificationChoice, assertCurrent: () => void): Promise<void>;
  send(choice: NotificationChoice, token: Erc20Metadata | undefined, assertCurrent: () => void): Promise<void>;
  cancelSelection?(): void;
}) {
  const { t } = useNativeTranslation();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const preference = useFiatCurrency();
  const { hidden } = useBalancePrivacy();
  const [detail, setDetail] = useState<{ accountId: string; networkId: string; receive?: boolean; token?: string } | null>(() => portfolio.initialReceive ? {
    accountId: portfolio.source.getCatalogue?.()?.active.accountId ?? '', networkId: portfolio.initialReceive.account.network,
  } : null);
  const [sheet, setSheet] = useState<'filter' | 'send' | 'receive' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lifetime = useRef({ alive: true, generation: 0, busy: false });
  useLayoutEffect(() => {
    lifetime.current.alive = true;
    return () => { lifetime.current.alive = false; lifetime.current.generation++; };
  }, []);
  const accountId = portfolio.source.getCatalogue?.()?.active.accountId ?? null;
  const detailCurrent = detail && detail.accountId === accountId && portfolio.source.getSnapshot().account?.network === detail.networkId;
  const pauseOverview = detail?.accountId === accountId;
  useLayoutEffect(() => {
    if (preference.status === 'loading' || pauseOverview) return;
    controller.setCurrency(preference.status === 'ready' ? preference.currency : null);
    return controller.connect();
  }, [controller, pauseOverview, preference.status, preference.status === 'ready' ? preference.currency : null]);
  const closeDetail = () => { lifetime.current.generation++; lifetime.current.busy = false; setBusy(false); setDetail(null); };
  const closeSheet = () => { if (busy && sheet !== 'filter') cancelSelection?.(); closeDetail(); setSheet(null); };
  useLayoutEffect(() => portfolio.navigation?.registerBack(() => {
    if (sheet) { closeSheet(); return true; }
    if (detailCurrent) { closeDetail(); return true; }
    return false;
  }), [portfolio.navigation, detailCurrent, sheet]);
  const run = async (operation: (check: () => void) => Promise<void>) => {
    const owner = lifetime.current;
    if (owner.busy || !owner.alive || AppState.currentState !== 'active') return;
    const generation = ++owner.generation;
    owner.busy = true; setBusy(true); setError(false);
    const check = () => { if (!owner.alive || generation !== owner.generation || AppState.currentState !== 'active') throw Error('CANCELLED'); };
    try { check(); await operation(check); check(); }
    catch { if (owner.alive && generation === owner.generation) setError(true); }
    finally { if (owner.alive && generation === owner.generation) { owner.busy = false; setBusy(false); } }
  };
  const openDetail = (choice: NotificationChoice, receive = false, token?: string) => run(async check => {
    const generation = lifetime.current.generation;
    setDetail({ accountId: choice.scope.accountId, networkId: choice.scope.network.id, receive, token });
    try { await selectNetwork(choice, check); }
    catch (cause) { setDetail(null); throw cause; }
    if (!lifetime.current.alive || generation !== lifetime.current.generation) return;
    setSheet(null); setDetail({ accountId: choice.scope.accountId, networkId: choice.scope.network.id, receive, token });
  });
  if (detailCurrent) return <NativePortfolio {...portfolio} onOverviewBack={closeDetail} openReceive={detail.receive}
    initialTokenContract={detail.token} onExit={closeDetail} />;

  const balance = (row: AccountPortfolioRow) => row.units === null ? '—' : formatBaseUnits(row.units, row.decimals);
  const sourceRows = snapshot.rows.map(row => ({ id: `${row.choice.scope.id}:native`, row }));
  const canSendChoice = (choice: NotificationChoice) => 'kind' in choice.scope.network && choice.scope.network.kind === 'evm'
    ? nativeSigningEnabled(choice.scope.network.id, [choice.scope.network]) : !!portfolio.onSend;
  const sources = sourceRows.filter(entry => sheet !== 'send' || canSendChoice(entry.row.choice));
  const options: NetworkSourceOption[] = sheet === 'filter'
    ? [{ id: 'all', name: t('mobile.accountPortfolio.allNetworks'), symbol: '' }, ...snapshot.choices.map(choice => ({ id: choice.scope.network.id, name: choice.networkName, symbol: choice.symbol,
      testnet: 'testnet' in choice.scope.network ? choice.scope.network.testnet : false,
      available: controller.cachedBalances().find(value => value.networkId === choice.scope.network.id)?.available }))]
    : sources.map(entry => ({ id: entry.id, name: entry.row.choice.networkName,
      iconId: entry.row.choice.scope.network.id, symbol: entry.row.choice.symbol,
      testnet: 'testnet' in entry.row.choice.scope.network && entry.row.choice.scope.network.testnet,
      available: entry.row.units === null ? undefined : balance(entry.row) }));
  const selectedNetwork = snapshot.choices.find(choice => choice.scope.network.id === snapshot.filter);
  const filterName = snapshot.filter === 'all' ? t('mobile.accountPortfolio.allNetworks') : selectedNetwork?.networkName ?? t(snapshot.filter ? 'mobile.accountPortfolio.unavailableNetwork' : 'buttons.loading');
  const filterAvailable = snapshot.filter === 'all' ? snapshot.choices.length > 0 : !!selectedNetwork;
  const hasTestnets = snapshot.rows.some(row => 'testnet' in row.choice.scope.network && row.choice.scope.network.testnet);
  const amount = hidden ? HIDDEN_BALANCE : snapshot.knownValue === null || !snapshot.currency ? '—' : snapshot.knownValue >= 1e9
    ? `≈ ${compactActivityAmountLabel(String(snapshot.knownValue))} ${snapshot.currency.toUpperCase()}` : formatIndicativeFiat(snapshot.knownValue, snapshot.currency) ?? '—';
  const selectSource = (id: string) => {
    if (sheet === 'filter') { void run(async () => { await controller.selectFilter(id); setSheet(null); }); return; }
    const source = sources.find(entry => entry.id === id); if (!source) return;
    if (sheet === 'send') void run(async check => { await send(source.row.choice, undefined, check); check(); setSheet(null); });
    else void openDetail(source.row.choice, true);
  };
  return <SafeAreaView edges={['top']} style={s.safe}><Screen gap={18}>
    <Header title="Pali Wallet" brand right={<IconButton label={t('mobile.accountPortfolio.refresh')} icon="refresh" disabled={busy || snapshot.refreshing || snapshot.status !== 'ready'} onPress={() => void controller.refresh()} />} />
    <IdlePressable accessibilityRole="button" accessibilityLabel={t('mobile.accountPortfolio.chooseAccount', { account: portfolio.accountLabel ?? 'Account 1' })} onPress={portfolio.onManageAccounts} style={s.account}>
      <Icon name="wallet" size={18} color={colors.blue} /><Text style={s.accountName}>{portfolio.accountLabel ?? 'Account 1'}</Text><Icon name="chevron-down" size={17} color={colors.muted} />
    </IdlePressable>
    {portfolio.source.getSnapshot().backup === 'unconfirmed' && portfolio.onBackup && <WalletBackupBadge onPress={portfolio.onBackup} />}
    <View style={s.hero}><Text style={s.label}>{t('mobile.accountPortfolio.value').toLocaleUpperCase()}</Text><Text testID="account-portfolio-value" style={s.value} numberOfLines={1} adjustsFontSizeToFit>{amount}</Text>
      <Text style={s.help}>{t(snapshot.partial ? 'mobile.accountPortfolio.partial' : 'mobile.accountPortfolio.estimated')}</Text>
      {hasTestnets && <Text style={s.help}>{t('mobile.accountPortfolio.testnetsExcluded')}</Text>}</View>
    <View style={s.actions}>
      {!!portfolio.onSend && <Button title={t('buttons.send')} icon="arrow-up-right" style={s.flex} disabled={busy || snapshot.status !== 'ready' || !filterAvailable} onPress={() => {
        if (snapshot.filter === 'all') setSheet('send');
        else if (selectedNetwork) void run(check => send(selectedNetwork, undefined, check));
      }} />}
      <Button title={t('buttons.receive')} icon="arrow-down-left" variant="secondary" style={s.flex} disabled={busy || snapshot.status !== 'ready' || !filterAvailable} onPress={() => {
        if (snapshot.filter === 'all') setSheet('receive'); else if (selectedNetwork) void openDetail(selectedNetwork, true);
      }} />
    </View>
    <IdlePressable accessibilityRole="button" accessibilityLabel={t('mobile.accountPortfolio.chooseFilter', { network: filterName })} disabled={busy || snapshot.status === 'loading'} onPress={() => setSheet('filter')} style={s.filter}>
      <Text style={s.accountName}>{filterName}</Text><Icon name="chevron-down" size={18} color={colors.muted} />
    </IdlePressable>
    <Text accessibilityRole="header" style={s.heading}>{t('mobile.accountPortfolio.assets', { account: portfolio.accountLabel ?? 'Account 1' })}</Text>
    {snapshot.rows.map(row => <Card key={row.choice.scope.id} style={s.card}>
      <IdlePressable accessibilityRole="button" accessibilityLabel={`${row.choice.symbol}, ${row.choice.networkName}, ${hidden ? HIDDEN_BALANCE : balance(row)}`} disabled={busy} onPress={() => void openDetail(row.choice)} style={s.row}>
        <Coin id={row.choice.scope.network.id} fallbackSymbol={row.choice.symbol} size={36} /><View style={s.names}><Text style={s.name}>{row.choice.symbol}</Text><Text style={s.help}>{row.choice.networkName}{'testnet' in row.choice.scope.network && row.choice.scope.network.testnet ? ` · ${t('mobile.common.testNetwork')}` : ''}</Text></View>
        <View style={s.amounts}><Text style={s.name} numberOfLines={2} accessibilityLabel={hidden ? HIDDEN_BALANCE : `${balance(row)} ${row.choice.symbol}`}>{hidden ? HIDDEN_BALANCE : compactActivityAmountLabel(`${balance(row)} ${row.choice.symbol}`)}</Text><Text style={s.help}>{row.status === 'loading' ? t('buttons.loading') : row.price !== null && row.units !== null && snapshot.currency ? hidden ? HIDDEN_BALANCE : formatIndicativeFiat(Number(balance(row)) * row.price, snapshot.currency) : '—'}</Text></View>
      </IdlePressable>
      {row.tokens.map(token => <IdlePressable key={token.metadata.contractAddress} accessibilityRole="button" accessibilityLabel={`${token.metadata.symbol}, ${row.choice.networkName}, ${hidden ? HIDDEN_BALANCE : token.units === null ? '—' : formatTokenUnits(token.units, token.metadata.decimals)}`} disabled={busy} onPress={() => void openDetail(row.choice, false, token.metadata.contractAddress)} style={[s.row, s.divider]}>
        <Coin id={token.metadata.contractAddress} fallbackSymbol={token.metadata.symbol} size={36} /><View style={s.names}><Text style={s.name}>{token.metadata.symbol}</Text><Text style={s.help}>{row.choice.networkName}</Text></View>
        <View style={s.amounts}><Text style={s.name} numberOfLines={2} accessibilityLabel={hidden ? HIDDEN_BALANCE : token.units === null ? '—' : formatTokenUnits(token.units, token.metadata.decimals)}>{hidden ? HIDDEN_BALANCE : token.units === null ? '—' : compactActivityAmountLabel(formatTokenUnits(token.units, token.metadata.decimals))}</Text>
          <Text style={s.help}>{hidden ? HIDDEN_BALANCE : token.price !== null && token.units !== null && snapshot.currency ? formatIndicativeFiat(Number(formatTokenUnits(token.units, token.metadata.decimals)) * token.price, snapshot.currency) : '—'}</Text></View>
      </IdlePressable>)}
      {row.collectibles.length > 0 && <Text style={s.collectibles}>{t('mobile.accountPortfolio.collectibles', { count: row.collectibles.length, network: row.choice.networkName })}</Text>}
    </Card>)}
    {snapshot.status === 'unavailable' && <Text style={s.help}>{t('mobile.accountPortfolio.unavailable')}</Text>}
    {snapshot.status === 'ready' && !snapshot.rows.length && <Text style={s.help}>{t('mobile.accountPortfolio.noAddress')}</Text>}
    {error && <Text accessibilityRole="alert" style={s.error}>{t('mobile.accountPortfolio.error')}</Text>}
    {portfolio.onActivity && <Card><Row title={t('buttons.activity')} subtitle={selectedNetwork ? t('mobile.accountPortfolio.activityNetwork', { network: selectedNetwork.networkName }) : t('mobile.accountPortfolio.activityAll')} icon="clock" onPress={() => {
      if (selectedNetwork) void run(async check => { await selectNetwork(selectedNetwork, check); check(); portfolio.onActivity?.(); });
      else portfolio.onActivity?.();
    }} last /></Card>}
  </Screen><Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={closeSheet}>
    <NetworkSourceSheet purpose={sheet ?? 'filter'} options={options} selectedId={sheet === 'filter' ? snapshot.filter ?? '' : sources.find(entry => !('token' in entry) && entry.row.choice.scope.network.id === portfolio.source.getSnapshot().account?.network)?.id ?? ''}
      busy={busy} overContent onSelect={selectSource} onClose={closeSheet} />
  </Modal></SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, flex: { flex: 1 }, actions: { flexDirection: 'row', gap: 10 },
  account: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 9, minHeight: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surface },
  accountName: { fontSize: 14, fontWeight: '500', flexShrink: 1 }, hero: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  label: { color: colors.muted, fontSize: 11, letterSpacing: 1, fontWeight: '600' }, value: { fontSize: 32, lineHeight: 42, fontWeight: '600' },
  help: { color: colors.muted, fontSize: 12, lineHeight: 18 }, filter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 46, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.surface },
  heading: { fontSize: 17, fontWeight: '600' }, card: { padding: 0 }, row: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10, minHeight: 78 },
  names: { flex: 1, minWidth: 0, gap: 4 }, name: { fontSize: 14, fontWeight: '500' }, amounts: { maxWidth: '47%', alignItems: 'flex-end', gap: 4 },
  tokenAmount: { fontSize: 14, fontWeight: '500', maxWidth: '47%' }, divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  collectibles: { color: colors.muted, fontSize: 12, padding: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }, error: { color: colors.red, fontSize: 13, lineHeight: 20 },
});
