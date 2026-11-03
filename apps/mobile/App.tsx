import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  Modal,
  TextInput,
  Platform,
  AppState,
  AccessibilityInfo,
  BackHandler,
  Share,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import {
  colors,
  Text,
  Icon,
  Coin,
  PaliMark,
  Button,
  Card,
  Screen,
  Header,
  Row,
  Notice,
  Label,
  styles,
} from './src/ui';
import { Welcome, AddWatchAccount } from './src/screens/Onboarding';
import { NativeWalletScreen } from './src/screens/NativeWallet';
import { DesignStudio } from './src/design/Studio';
import { SettingsScreen, InformationScreen } from './src/screens/Settings';
import {
  WatchOnlyAuthority,
  NETWORKS,
  getNetwork,
  normalizePublicAddress,
  formatBaseUnits,
  parseDecimalAmount,
} from './src/core/index';
import type {
  PublicAccount,
  PublicSnapshot,
  NetworkId,
} from './src/core/types';
import {
  loadPublicAccounts,
  savePublicAccounts,
  balanceReader,
  isNativePersistence,
} from './src/platform';

type Asset = {
  id: string;
  name: string;
  networkId: NetworkId;
  network: string;
  symbol: string;
  amount: string;
  fiat: string;
  change: string;
};
const sampleAssets: Asset[] = [
  {
    id: 'bitcoin',
    name: 'Bitcoin',
    networkId: 'bitcoin',
    network: 'Bitcoin',
    symbol: 'BTC',
    amount: '0.0842',
    fiat: '$6,589.37',
    change: '+2.41%',
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    networkId: 'ethereum',
    network: 'Ethereum',
    symbol: 'ETH',
    amount: '1.82',
    fiat: '$4,461.64',
    change: '+1.26%',
  },
  {
    id: 'syscoin',
    name: 'Syscoin',
    networkId: 'syscoin',
    network: 'Syscoin UTXO',
    symbol: 'SYS',
    amount: '24,810.42',
    fiat: '$789.35',
    change: '+3.08%',
  },
  {
    id: 'usdc',
    name: 'USD Coin',
    networkId: 'base',
    network: 'Base',
    symbol: 'USDC',
    amount: '1,000.00',
    fiat: '$1,000.00',
    change: '0.00%',
  },
  {
    id: 'syscoin-nevm',
    name: 'Syscoin',
    networkId: 'syscoin-nevm',
    network: 'Syscoin NEVM',
    symbol: 'SYS',
    amount: '4,815.30',
    fiat: '$153.20',
    change: '+3.08%',
  },
];
const sampleActivity = [
  {
    id: '1',
    type: 'Received',
    symbol: 'ETH',
    amount: '+0.25',
    network: 'Ethereum',
    when: 'Today · 10:42',
    incoming: true,
  },
  {
    id: '2',
    type: 'Sent',
    symbol: 'SYS',
    amount: '−125.00',
    network: 'Syscoin NEVM',
    when: 'Yesterday · 16:08',
    incoming: false,
  },
  {
    id: '3',
    type: 'Received',
    symbol: 'BTC',
    amount: '+0.012',
    network: 'Bitcoin',
    when: 'Oct 30 · 09:15',
    incoming: true,
  },
];
const blankSnapshot: PublicSnapshot = {
  status: 'empty',
  accounts: [],
  selectedAccountId: null,
  selectedNetworkId: 'ethereum',
  generation: 0,
  balance: { status: 'unknown' },
  capabilities: {
    watchOnly: true,
    receive: false,
    send: false,
    createWallet: false,
    importRecoveryPhrase: false,
    biometrics: false,
    walletConnect: false,
  },
};
type Route =
  | 'welcome'
  | 'native'
  | 'design'
  | 'add'
  | 'home'
  | 'asset'
  | 'activity'
  | 'settings'
  | 'receive'
  | 'send'
  | 'review'
  | 'done'
  | 'transaction'
  | 'security'
  | 'backup'
  | 'connections'
  | 'about'
  | 'locked';
type Sheet = 'send' | 'receive' | 'filter' | 'accounts';
function AppContent() {
  const [requestedRoute, setRoute] = useState<Route>('welcome');
  const [preview, setPreview] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReducedMotion)
      .catch(() => undefined);
    const motion = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion
    );
    return () => motion.remove();
  }, []);
  const [hiddenLive, setHiddenLive] = useState(false);
  const [hiddenPreview, setHiddenPreview] = useState(false);
  const hideBalances = preview ? hiddenPreview : hiddenLive;
  const setHideBalances = preview ? setHiddenPreview : setHiddenLive;
  const [selected, setSelected] = useState<Asset>(sampleAssets[0]!);
  const [sheet, setSheetState] = useState<Sheet | null>(null);
  const [displayedSheet, setDisplayedSheet] = useState<Sheet>('filter');
  const setSheet = useCallback((next: Sheet | null) => {
    if (next) setDisplayedSheet(next);
    setSheetState(next);
  }, []);
  const [filter, setFilter] = useState<NetworkId | 'all'>('all');
  const [snapshot, setSnapshot] = useState(blankSnapshot);
  const route: Route =
    !preview &&
    !['welcome', 'add', 'locked', 'design', 'native'].includes(requestedRoute) &&
    snapshot.status !== 'ready'
      ? snapshot.accounts.length
        ? 'locked'
        : 'welcome'
      : requestedRoute;
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState('');
  const [toast, setToast] = useState('');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [sendError, setSendError] = useState('');
  const [txIndex, setTxIndex] = useState(0);
  const [activityFilter, setActivityFilter] = useState('All activity');
  const authority = useRef<WatchOnlyAuthority | null>(null);
  const addingAccount = useRef(false);
  const removeListener = useRef<(() => void) | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationGeneration = useRef(0);
  const lifecycleGeneration = useRef(0);
  const foreground = useRef(
    Platform.OS === 'web' || AppState.currentState === 'active'
  );
  const go = (next: Route) => {
    navigationGeneration.current++;
    setRoute(next);
  };
  const announce = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2800);
  };
  const connect = (accounts: readonly PublicAccount[]) => {
    removeListener.current?.();
    authority.current?.lock();
    const next = new WatchOnlyAuthority(accounts, balanceReader);
    authority.current = next;
    setSnapshot(next.getSnapshot());
    removeListener.current = next.subscribe(setSnapshot);
    return next;
  };
  useEffect(() => {
    let active = true;
    loadPublicAccounts()
      .then((accounts) => {
        if (active) {
          connect(accounts);
          if (accounts.length) go('locked');
        }
      })
      .catch(() => {
        if (active)
          setStartupError(
            'Your saved accounts could not be read. Nothing has been replaced. Try reopening Pali.'
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      removeListener.current?.();
      authority.current?.lock();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (state !== 'active') {
        lifecycleGeneration.current++;
        authority.current?.lock();
        setSheet(null);
        setAmount('');
        setRecipient('');
        if (requestedRoute !== 'native' && !preview && authority.current?.getSnapshot().accounts.length)
          go('locked');
      }
    });
    return () => sub.remove();
  }, [preview, requestedRoute, setSheet]);
  useEffect(() => {
    if (route === 'design' || route === 'native' || Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheet) {
        setSheet(null);
        return true;
      }
      if (!['welcome', 'home', 'locked'].includes(route)) {
        go(route === 'review' ? 'send' : 'home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [route, sheet, setSheet]);
  const activeAccount = snapshot.accounts.find(
    (a) => a.id === snapshot.selectedAccountId
  );
  const liveNetwork = getNetwork(snapshot.selectedNetworkId);
  const liveAmount =
    snapshot.balance.status === 'available'
      ? formatBaseUnits(snapshot.balance.units, liveNetwork.decimals)
      : null;
  const liveAsset: Asset = {
    id: liveNetwork.id,
    name: liveNetwork.name,
    networkId: liveNetwork.id,
    network: liveNetwork.name,
    symbol: liveNetwork.symbol,
    amount: liveAmount ?? 'Unavailable',
    fiat: 'Price unavailable',
    change: '',
  };
  const assets = preview
    ? sampleAssets.filter((a) => filter === 'all' || a.networkId === filter)
    : [liveAsset];
  const current = preview ? selected : liveAsset;
  const exit = () => {
    authority.current?.lock();
    setPreview(false);
    setSheet(null);
    setAmount('');
    setRecipient('');
    go(snapshot.accounts.length ? 'locked' : 'welcome');
  };
  const openDesign = () => {
    authority.current?.lock();
    setPreview(true);
    go('design');
  };
  const startPreview = () => {
    authority.current?.lock();
    setHiddenPreview(false);
    setPreview(true);
    go('home');
    setFilter('all');
    setSelected(sampleAssets[0]!);
  };
  const addAccount = async ({
    name,
    address,
  }: {
    name: string;
    address: string;
  }) => {
    if (addingAccount.current)
      throw new Error('Another account is still saving. Please wait.');
    addingAccount.current = true;
    try {
      const startNavigation = navigationGeneration.current;
      const startLifecycle = lifecycleGeneration.current;
      const normalized = normalizePublicAddress(address, 'ethereum');
      const accounts = authority.current?.getSnapshot().accounts ?? [];
      if (accounts.some((a) => a.addresses.ethereum === normalized))
        throw new Error('This address is already in Pali.');
      const newAccount: PublicAccount = {
        id: `watch_${Date.now()}`,
        name: name.trim(),
        addresses: {
          ethereum: normalized,
          base: normalized,
          arbitrum: normalized,
          'syscoin-nevm': normalized,
        },
      };
      await savePublicAccounts([...accounts, newAccount]);
      const next = connect([...accounts, newAccount]);
      if (
        !foreground.current ||
        startNavigation !== navigationGeneration.current ||
        startLifecycle !== lifecycleGeneration.current
      ) {
        return;
      }
      next.unlock();
      next.selectAccount(newAccount.id);
      setPreview(false);
      go('home');
      void next.refresh().catch(() => undefined);
    } finally {
      addingAccount.current = false;
    }
  };
  const chooseAsset = (asset: Asset, action: 'send' | 'receive' | 'filter') => {
    setSheet(null);
    if (action === 'filter') {
      setFilter(asset.networkId);
      return;
    }
    setSelected(asset);
    setAmount('');
    setRecipient('');
    setSendError('');
    go(action);
  };
  const address = preview
    ? `PALI-PREVIEW:${current.networkId}:NOT-A-PAYMENT-ADDRESS`
    : activeAccount?.addresses[snapshot.selectedNetworkId] ?? '';
  const copyAddress = async () => {
    try {
      await Clipboard.setStringAsync(address);
      announce(preview ? 'Preview text copied' : 'Address copied');
    } catch {
      announce('Copy failed. Try again.');
    }
  };
  const review = () => {
    try {
      if (!preview) throw new Error('This account is watch-only.');
      if (recipient.trim().length < 3)
        throw new Error('Enter a sample recipient to continue.');
      const units = parseDecimalAmount(
        amount,
        current.id === 'usdc' ? 6 : getNetwork(current.networkId).decimals
      );
      const balance = parseDecimalAmount(
        current.amount.replaceAll(',', ''),
        current.id === 'usdc' ? 6 : getNetwork(current.networkId).decimals
      );
      const maxFee =
        current.id === 'usdc'
          ? 0n
          : parseDecimalAmount(
              '0.000042',
              getNetwork(current.networkId).decimals
            );
      if (units + maxFee > balance)
        throw new Error(
          'Amount plus the maximum fee exceeds the sample balance.'
        );
      setSendError('');
      go('review');
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Check your amount.');
    }
  };
  const navigateInfo = (s: string) => go(s as Route);
  const back = () => go('home');
  if (route === 'design') return <DesignStudio onExit={exit} />;
  if (route === 'native') return <NativeWalletScreen onExit={exit} />;
  let content: React.ReactNode;
  if (loading)
    content = (
      <View style={s.center}>
        <ActivityIndicator color={colors.blue} />
        <Text style={styles.muted}>Opening Pali…</Text>
      </View>
    );
  else if (startupError)
    content = (
      <Screen
        footer={
          <Button
            title="Try again"
            onPress={() => {
              setStartupError('');
              setLoading(true);
              loadPublicAccounts()
                .then((a) => {
                  connect(a);
                  go(a.length ? 'locked' : 'welcome');
                })
                .catch(() =>
                  setStartupError(
                    'Saved accounts are still unavailable. Nothing has been replaced.'
                  )
                )
                .finally(() => setLoading(false));
            }}
          />
        }
      >
        <Header title="Unable to open accounts" />
        <Notice
          title="Your saved data is preserved"
          body={startupError}
          tone="amber"
        />
      </Screen>
    );
  else if (route === 'welcome')
    content = (
      <Welcome
        onPreview={startPreview}
        onWatch={() => go('add')}
        onDesign={openDesign}
        onWallet={Platform.OS !== 'web' ? () => {
          authority.current?.lock(); setSheet(null); setPreview(false); go('native');
        } : undefined}
      />
    );
  else if (route === 'add')
    content = (
      <AddWatchAccount
        onCancel={() =>
          go(
            snapshot.status === 'ready'
              ? 'home'
              : snapshot.accounts.length
              ? 'locked'
              : 'welcome'
          )
        }
        onAdd={addAccount}
      />
    );
  else if (route === 'locked')
    content = (
      <Screen
        footer={
          <>
            <Button
              title="View my accounts"
              icon="eye"
              onPress={() => {
                authority.current?.unlock();
                go('home');
                void authority.current?.refresh().catch(() => undefined);
              }}
            />
            <Button
              title="Explore the design"
              variant="quiet"
              onPress={startPreview}
            />
          </>
        }
      >
        <View style={[s.center, { flex: 1 }]}>
          <PaliMark size={64} />
          <Text style={[styles.h1, { textAlign: 'center' }]}>
            Welcome back.
          </Text>
          <Text style={[styles.muted, { textAlign: 'center', maxWidth: 280 }]}>
            Your watch-only accounts are hidden while Pali is in the background.
          </Text>
          <Notice
            title="Privacy screen"
            body="No keys are stored. Viewing public accounts does not require wallet authentication."
          />
        </View>
      </Screen>
    );
  else if (route === 'home')
    content = (
      <Screen>
        <View style={s.topline}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <PaliMark />
            <Text
              style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.7 }}
            >
              pali
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch account"
            onPress={() => setSheet('accounts')}
            style={s.account}
          >
            <View style={s.avatar}>
              <Text
                style={{ fontSize: 12, fontWeight: '600', color: colors.blue }}
              >
                P
              </Text>
            </View>
            <Text style={{ fontSize: 13, maxWidth: 150 }} numberOfLines={1}>
              {preview ? 'Personal wallet' : activeAccount?.name}
            </Text>
            <Icon name="chevron-down" size={15} color={colors.muted} />
          </Pressable>
        </View>
        <View style={s.balanceBlock}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
            }}
          >
            <Text style={styles.muted}>
              {preview ? 'Total balance' : 'Observed balance'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                hideBalances ? 'Show balances' : 'Hide balances'
              }
              style={s.eye}
              onPress={() => setHideBalances(!hideBalances)}
            >
              <Icon name="eye" size={18} color={colors.muted} />
            </Pressable>
          </View>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            numberOfLines={1}
            style={s.total}
          >
            {hideBalances
              ? '••••••'
              : preview
              ? '$12,993.56'
              : liveAmount ?? '—'}
          </Text>
          <Text
            style={{
              color: preview ? colors.green : colors.muted,
              fontSize: 13,
            }}
          >
            {hideBalances
              ? 'Balances hidden'
              : preview
              ? '+$246.80  (1.94%)  today'
              : `${liveNetwork.symbol} · ${
                  snapshot.balance.status === 'loading'
                    ? 'Updating…'
                    : snapshot.balance.status === 'available'
                    ? 'On-chain balance'
                    : 'Balance unavailable'
                }`}
          </Text>
        </View>
        <View style={styles.split}>
          <Button
            style={{ flex: 1 }}
            title={preview ? 'Preview send' : 'Send unavailable'}
            disabled={!preview}
            icon="arrow-up-right"
            onPress={() => setSheet('send')}
          />
          <Button
            style={{ flex: 1 }}
            title={preview ? 'Receive' : 'View address'}
            variant="secondary"
            icon="arrow-down-left"
            onPress={() => (preview ? setSheet('receive') : go('receive'))}
          />
        </View>
        {!preview && (
          <View style={{ marginTop: 18 }}>
            <Notice
              title="You’re watching this account"
              body="Pali can show its public balance. Spending requires the wallet that holds its keys."
            />
          </View>
        )}
        <View style={[s.sectionLine, { marginTop: 32 }]}>
          <Text style={styles.sectionHeading}>Assets</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setSheet('filter')}
            style={s.smallButton}
          >
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {filter === 'all' && preview
                ? 'All networks'
                : preview
                ? getNetwork(filter as NetworkId).name
                : liveNetwork.name}
            </Text>
            <Icon name="chevron-down" size={14} color={colors.muted} />
          </Pressable>
        </View>
        <Card>
          {assets.map((a, index) => (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              accessibilityLabel={`${a.name}, ${a.network}, ${
                hideBalances ? 'balance hidden' : a.amount + ' ' + a.symbol
              }`}
              onPress={() => {
                setSelected(a);
                go('asset');
              }}
              style={({ pressed }) => [
                s.assetRow,
                index !== assets.length - 1 && s.line,
                pressed && { backgroundColor: colors.raised },
              ]}
            >
              <Coin id={a.id} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '500' }}>{a.name}</Text>
                <Text style={s.subtext}>{a.network}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', maxWidth: '48%' }}>
                <Text numberOfLines={1} style={{ fontWeight: '500' }}>
                  {hideBalances ? '••••' : preview ? a.fiat : a.amount}
                </Text>
                <Text style={s.subtext}>
                  {hideBalances
                    ? '••••'
                    : preview
                    ? `${a.amount} ${a.symbol}`
                    : a.symbol}
                </Text>
              </View>
            </Pressable>
          ))}
        </Card>
        {!preview && (
          <Button
            title={
              snapshot.balance.status === 'loading'
                ? 'Updating balance…'
                : 'Refresh balance'
            }
            variant="quiet"
            icon="refresh"
            disabled={snapshot.balance.status === 'loading'}
            onPress={() => void authority.current?.refresh()}
          />
        )}
        <View style={[s.sectionLine, { marginTop: 28 }]}>
          <Text style={styles.sectionHeading}>Recent activity</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => go('activity')}
            style={s.smallButton}
          >
            <Text style={{ color: colors.blue, fontSize: 13 }}>View all</Text>
            <Icon name="arrow-right" size={15} color={colors.blue} />
          </Pressable>
        </View>
        {preview ? (
          <Card>
            {sampleActivity.slice(0, 2).map((tx, index) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                last={index === 1}
                onPress={() => {
                  setTxIndex(sampleActivity.findIndex((t) => t.id === tx.id));
                  go('transaction');
                }}
              />
            ))}
          </Card>
        ) : (
          <Card style={{ padding: 20 }}>
            <Text style={styles.muted}>
              Transaction history is not available in this build.
            </Text>
          </Card>
        )}
      </Screen>
    );
  else if (route === 'activity')
    content = (
      <Screen>
        <Header title="Activity" subtitle="Your transactions, at a glance" />
        {preview ? (
          <>
            <View style={s.chips}>
              {['All activity', 'Received', 'Sent'].map((f) => (
                <Pressable
                  key={f}
                  accessibilityRole="button"
                  style={[
                    s.chip,
                    f === activityFilter && { backgroundColor: '#203c52' },
                  ]}
                  onPress={() => setActivityFilter(f)}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      color: f === activityFilter ? colors.blue : colors.muted,
                    }}
                  >
                    {f}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Label>Recent transactions</Label>
            <Card>
              {sampleActivity
                .filter(
                  (tx) =>
                    activityFilter === 'All activity' ||
                    tx.type === activityFilter
                )
                .map((tx, index) => (
                  <TransactionRow
                    key={tx.id}
                    tx={tx}
                    last={index === 2}
                    onPress={() => {
                      setTxIndex(
                        sampleActivity.findIndex((t) => t.id === tx.id)
                      );
                      go('transaction');
                    }}
                  />
                ))}
            </Card>
            <Text style={[s.subtext, { textAlign: 'center', marginTop: 24 }]}>
              All activity shown here is sample data.
            </Text>
          </>
        ) : (
          <Notice
            title="Activity isn’t connected yet"
            body="You can view this account’s balance and address in Wallet. Transaction history is not available yet."
          />
        )}
      </Screen>
    );
  else if (route === 'settings')
    content = (
      <SettingsScreen
        preview={preview}
        hideBalances={hideBalances}
        onHideBalances={setHideBalances}
        onNavigate={navigateInfo}
        onExit={exit}
      />
    );
  else if (['security', 'backup', 'connections', 'about'].includes(route))
    content = (
      <InformationScreen
        screen={route}
        preview={preview}
        onBack={() => go('settings')}
      />
    );
  else if (route === 'asset')
    content = (
      <Screen
        footer={
          <View style={styles.split}>
            <Button
              title={preview ? 'Preview send' : 'Send unavailable'}
              disabled={!preview}
              icon="arrow-up-right"
              style={{ flex: 1 }}
              onPress={() => {
                setAmount('');
                setRecipient('');
                go('send');
              }}
            />
            <Button
              title={preview ? 'Receive' : 'View address'}
              variant="secondary"
              icon="arrow-down-left"
              style={{ flex: 1 }}
              onPress={() => go('receive')}
            />
          </View>
        }
      >
        <Header title={current.name} onBack={back} />
        <View style={[s.center, { paddingVertical: 25 }]}>
          <Coin id={current.id} size={64} />
          <Text
            style={{
              fontSize: 34,
              lineHeight: 44,
              fontWeight: '500',
              letterSpacing: -1,
            }}
          >
            {hideBalances ? '••••' : `${current.amount} ${current.symbol}`}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 18 }}>
            {hideBalances ? '••••' : current.fiat}
          </Text>
        </View>
        <Label>Asset details</Label>
        <Card>
          <Row
            title="Network"
            right={<Text style={{ fontSize: 14 }}>{current.network}</Text>}
          />
          <Row
            title="Asset type"
            right={
              <Text style={{ fontSize: 14 }}>
                {current.id === 'usdc' ? 'ERC-20 token' : 'Native asset'}
              </Text>
            }
            last
          />
        </Card>
        <View style={{ marginTop: 24 }}>
          <Notice
            title={preview ? 'Sample portfolio' : 'Public account'}
            body={
              preview
                ? 'These illustrative balances do not represent assets held by this app.'
                : 'This app observes the public address. It cannot sign or send transactions.'
            }
          />
        </View>
      </Screen>
    );
  else if (route === 'receive')
    content = (
      <Screen
        footer={
          <View style={styles.split}>
            <Button
              title="Copy"
              icon="copy"
              style={{ flex: 1 }}
              onPress={() => void copyAddress()}
            />
            <Button
              title="Share"
              icon="share"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() =>
                void Share.share({
                  message: `${
                    preview
                      ? 'Pali design preview'
                      : 'Public address on ' + current.network
                  }\n${address}`,
                }).catch(() => announce('Sharing was cancelled.'))
              }
            />
          </View>
        }
      >
        <Header title={preview ? 'Receive' : 'Public address'} onBack={back} />
        <View style={[s.center, { gap: 9, marginTop: 5 }]}>
          <Coin id={current.id} size={46} />
          <Text style={{ fontWeight: '500', fontSize: 19 }}>
            {current.network}
          </Text>
          <Text style={styles.muted}>
            {preview ? 'Sample address screen' : 'Watch-only account'}
          </Text>
        </View>
        <View style={s.qrCard}>
          <QRCode
            value={address || 'PALI:ADDRESS-UNAVAILABLE'}
            size={208}
            backgroundColor="#ffffff"
            color="#071325"
            ecl="M"
          />
        </View>
        <Text
          selectable
          style={{
            fontSize: 13,
            lineHeight: 21,
            textAlign: 'center',
            color: colors.text,
            marginHorizontal: 8,
            marginBottom: 24,
          }}
        >
          {address}
        </Text>
        <Notice
          title={
            preview ? 'Preview QR · not a payment address' : 'Check the network'
          }
          body={
            preview
              ? 'This code contains sample text. It cannot receive funds.'
              : `Only use this address on ${current.network}. This app does not hold its keys; verify you control it in your signing wallet.`
          }
          tone={preview ? 'amber' : 'blue'}
        />
      </Screen>
    );
  else if (route === 'send')
    content = (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen
          footer={
            <Button
              title="Preview review"
              onPress={review}
              disabled={!amount || !recipient}
            />
          }
        >
          <Header title={`Send ${current.symbol}`} onBack={back} />
          <Pressable
            accessibilityRole="button"
            onPress={() => setSheet('send')}
            style={[s.assetRow, styles.card, { marginBottom: 24 }]}
          >
            <Coin id={current.id} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '500' }}>{current.name}</Text>
              <Text style={s.subtext}>{current.network}</Text>
            </View>
            <Icon name="chevron-down" color={colors.muted} />
          </Pressable>
          <Text style={{ fontWeight: '500', marginBottom: 10 }}>To</Text>
          <TextInput
            accessibilityLabel="Sample recipient"
            value={recipient}
            onChangeText={setRecipient}
            placeholder="Enter a sample recipient"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={120}
            style={styles.input}
          />
          <Label>Amount</Label>
          <View style={s.amountInput}>
            <TextInput
              accessibilityLabel={`Amount in ${current.symbol}`}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor="#5e728b"
              keyboardType="decimal-pad"
              maxLength={40}
              style={{
                color: colors.text,
                fontSize: 40,
                fontWeight: '500',
                flex: 1,
                paddingVertical: 12,
              }}
            />
            <Text style={{ fontWeight: '500', fontSize: 18 }}>
              {current.symbol}
            </Text>
          </View>
          <Text style={[s.subtext, { marginTop: 10 }]}>
            Sample balance: {current.amount} {current.symbol}
          </Text>
          <View style={{ marginTop: 28 }}>
            <Notice
              title="Try the review flow"
              body="Use sample details only. No transaction is prepared, signed, or sent."
            />
          </View>
          {!!sendError && (
            <Text
              accessibilityRole="alert"
              style={{ color: colors.red, marginTop: 16 }}
            >
              {sendError}
            </Text>
          )}
        </Screen>
      </KeyboardAvoidingView>
    );
  else if (route === 'review')
    content = (
      <Screen
        gap={8}
        footer={
          <>
            <Button title="Finish preview" onPress={() => go('done')} />
            <Text
              style={{ fontSize: 12, color: colors.muted, textAlign: 'center' }}
            >
              No transaction will be sent.
            </Text>
          </>
        }
      >
        <Header title="Review send" onBack={() => go('send')} />
        <View style={[s.center, { paddingVertical: 6, gap: 8 }]}>
          <View
            style={[s.reviewIcon, { width: 44, height: 44, borderRadius: 16 }]}
          >
            <Icon name="arrow-up-right" size={23} color={colors.pink} />
          </View>
          <Text
            style={{
              fontSize: 36,
              lineHeight: 44,
              fontWeight: '500',
              letterSpacing: -1,
            }}
          >
            {amount} {current.symbol}
          </Text>
          <Text style={styles.muted}>{current.network}</Text>
        </View>
        <Label>Transaction details</Label>
        <Card>
          <Row dense title="From" subtitle="Personal wallet · sample account" />
          <Row dense title="To" subtitle={recipient} />
          <Row
            dense
            title="Network"
            right={<Text style={{ fontSize: 14 }}>{current.network}</Text>}
          />
          <Row
            dense
            title="Amount"
            right={
              <Text style={{ fontSize: 14 }}>
                {amount} {current.symbol}
              </Text>
            }
          />
          <Row
            dense
            title="Maximum network fee"
            subtitle="Illustrative estimate"
            right={
              <Text style={{ fontSize: 14 }}>
                0.000042 {getNetwork(current.networkId).symbol}
              </Text>
            }
            last
          />
        </Card>
        <View style={{ marginTop: 22 }}>
          <Notice
            title="Review every detail"
            body="Check the recipient, network, amount and fee before you approve a transfer."
            tone="amber"
          />
        </View>
      </Screen>
    );
  else if (route === 'done')
    content = (
      <Screen footer={<Button title="Back to wallet" onPress={back} />}>
        <View style={[s.center, { flex: 1, paddingVertical: 50 }]}>
          <View style={s.doneIcon}>
            <Icon name="check" color={colors.blue} size={44} />
          </View>
          <Text style={[styles.h1, { textAlign: 'center' }]}>
            Review complete.
          </Text>
          <Text
            style={{ color: colors.muted, textAlign: 'center', maxWidth: 280 }}
          >
            You’ve reached the end of the sample send flow. No assets have
            moved.
          </Text>
        </View>
      </Screen>
    );
  else if (route === 'transaction') {
    const tx = sampleActivity[txIndex]!;
    content = (
      <Screen
        footer={
          <Button
            title="Back to activity"
            variant="secondary"
            onPress={() => go('activity')}
          />
        }
      >
        <Header title="Transaction" onBack={() => go('activity')} />
        <View style={[s.center, { paddingVertical: 25 }]}>
          <View style={s.doneIcon}>
            <Icon
              name={tx.incoming ? 'arrow-down-left' : 'arrow-up-right'}
              size={34}
              color={tx.incoming ? colors.green : colors.pink}
            />
          </View>
          <Text style={{ fontSize: 32, lineHeight: 42, fontWeight: '500' }}>
            {tx.amount} {tx.symbol}
          </Text>
          <Text style={styles.muted}>{tx.type} · sample activity</Text>
        </View>
        <Card>
          <Row title="Network" right={<Text>{tx.network}</Text>} />
          <Row title="Date" right={<Text>{tx.when}</Text>} />
          <Row
            title="Status"
            right={<Text style={{ color: colors.blue }}>Example only</Text>}
            last
          />
        </Card>
        <View style={{ marginTop: 22 }}>
          <Notice
            title="Sample transaction"
            body="This activity has no blockchain transaction ID and cannot be opened in an explorer."
          />
        </View>
      </Screen>
    );
  } else content = null;
  return (
    <View style={s.appOuter}>
      <SafeAreaView style={s.app} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <View
          style={{ flex: 1 }}
          pointerEvents={sheet ? 'none' : 'auto'}
          accessibilityElementsHidden={!!sheet}
          importantForAccessibility={sheet ? 'no-hide-descendants' : 'auto'}
        >
          {preview && (
            <View style={s.previewBar}>
              <View style={s.previewDot} />
              <Text
                style={{
                  fontSize: 11,
                  color: colors.blue,
                  fontWeight: '500',
                  flex: 1,
                }}
              >
                DESIGN PREVIEW · SAMPLE DATA
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={exit}
                style={{ padding: 8, minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 12, color: colors.muted }}>Exit</Text>
              </Pressable>
            </View>
          )}
          {!preview &&
            !['welcome', 'add', 'locked', 'design'].includes(route) && (
              <View style={s.watchBar}>
                <Icon name="eye" size={14} color={colors.blue} />
                <Text style={{ fontSize: 11, color: colors.blue }}>
                  WATCH-ONLY {isNativePersistence ? '' : '· WEB SESSION ONLY'}
                </Text>
              </View>
            )}
          <View style={{ flex: 1 }}>{content}</View>
          {['home', 'activity', 'settings'].includes(route) && (
            <View style={s.tabs}>
              {(
                [
                  { id: 'home', label: 'Wallet', icon: 'wallet' },
                  { id: 'activity', label: 'Activity', icon: 'activity' },
                  { id: 'settings', label: 'Settings', icon: 'settings' },
                ] as const
              ).map((tab) => (
                <Pressable
                  key={tab.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: route === tab.id }}
                  onPress={() => go(tab.id)}
                  style={s.tab}
                >
                  <View
                    style={[
                      s.tabIcon,
                      route === tab.id && { backgroundColor: '#173249' },
                    ]}
                  >
                    <Icon
                      name={tab.icon}
                      color={route === tab.id ? colors.blue : colors.muted}
                    />
                  </View>
                  <Text
                    style={{
                      fontSize: 11,
                      color: route === tab.id ? colors.blue : colors.muted,
                      fontWeight: route === tab.id ? '600' : '400',
                    }}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {!!toast && (
            <View accessibilityLiveRegion="polite" style={s.toast}>
              <Icon name="check" size={18} color={colors.blue} />
              <Text style={{ fontSize: 13 }}>{toast}</Text>
            </View>
          )}
        </View>
        <Modal
          visible={sheet !== null}
          transparent
          animationType={reducedMotion ? 'none' : 'slide'}
          onRequestClose={() => setSheet(null)}
        >
          <View style={s.modal}>
            <Pressable
              accessibilityLabel="Close sheet"
              accessibilityRole="button"
              style={StyleSheet.absoluteFill}
              onPress={() => setSheet(null)}
            />
            <View style={s.sheet} accessibilityViewIsModal>
              <View style={s.handle} />
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View style={s.sectionLine}>
                  <View>
                    <Text
                      style={{
                        fontSize: 23,
                        fontWeight: '600',
                        lineHeight: 30,
                      }}
                    >
                      {displayedSheet === 'send'
                        ? 'Send from'
                        : displayedSheet === 'receive'
                        ? 'Receive on'
                        : displayedSheet === 'accounts'
                        ? 'Your accounts'
                        : 'Networks'}
                    </Text>
                    <Text style={s.subtext}>
                      {displayedSheet === 'accounts'
                        ? 'Keep every wallet in view'
                        : displayedSheet === 'filter'
                        ? 'Choose what you see'
                        : 'Choose an asset and network'}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    onPress={() => setSheet(null)}
                    style={styles.iconButton}
                  >
                    <Icon name="close" />
                  </Pressable>
                </View>
                {displayedSheet === 'accounts' ? (
                  <>
                    <Card>
                      {preview ? (
                        <Row
                          title="Personal wallet"
                          subtitle="Sample account"
                          icon="wallet"
                          right={<Icon name="check" color={colors.blue} />}
                          last
                        />
                      ) : (
                        snapshot.accounts.map((account, index) => (
                          <Row
                            key={account.id}
                            title={account.name}
                            subtitle="Watch-only · public address"
                            icon="wallet"
                            right={
                              account.id === snapshot.selectedAccountId ? (
                                <Icon name="check" color={colors.blue} />
                              ) : undefined
                            }
                            last={index === snapshot.accounts.length - 1}
                            onPress={() => {
                              authority.current?.selectAccount(account.id);
                              setSheet(null);
                              go('home');
                              void authority.current
                                ?.refresh()
                                .catch(() => undefined);
                            }}
                          />
                        ))
                      )}
                    </Card>
                    <View style={{ marginTop: 16 }}>
                      <Button
                        title="Watch another address"
                        icon="plus"
                        variant="secondary"
                        onPress={() => {
                          setPreview(false);
                          setSheet(null);
                          go('add');
                        }}
                      />
                    </View>
                  </>
                ) : (
                  <Card>
                    {displayedSheet === 'filter' && preview && (
                      <Row
                        title="All networks"
                        icon="globe"
                        onPress={() => {
                          setFilter('all');
                          setSheet(null);
                        }}
                      />
                    )}
                    {(preview
                      ? sampleAssets
                      : NETWORKS.filter((n) => n.canWatch).map((n) => ({
                          ...liveAsset,
                          id: n.id,
                          name: n.name,
                          networkId: n.id,
                          network: n.name,
                          symbol: n.symbol,
                        }))
                    ).map((a, index) => (
                      <Pressable
                        key={a.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Choose ${a.name} on ${a.network}`}
                        onPress={() => {
                          if (!preview && displayedSheet === 'filter') {
                            authority.current?.selectNetwork(a.networkId);
                            void authority.current
                              ?.refresh()
                              .catch(() => undefined);
                            setSheet(null);
                          } else
                            chooseAsset(
                              a,
                              displayedSheet === 'send'
                                ? 'send'
                                : displayedSheet === 'receive'
                                ? 'receive'
                                : 'filter'
                            );
                        }}
                        style={[
                          s.assetRow,
                          index !== (preview ? sampleAssets.length : 4) - 1 &&
                            s.line,
                        ]}
                      >
                        <Coin id={a.id} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: '500' }}>{a.name}</Text>
                          <Text style={s.subtext}>{a.network}</Text>
                        </View>
                        <Icon
                          name="chevron-right"
                          size={18}
                          color={colors.muted}
                        />
                      </Pressable>
                    ))}
                  </Card>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
function TransactionRow({
  tx,
  last,
  onPress,
}: {
  tx: (typeof sampleActivity)[number];
  last: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[s.assetRow, !last && s.line]}
    >
      <View
        style={[
          s.txIcon,
          { backgroundColor: tx.incoming ? '#123435' : '#382037' },
        ]}
      >
        <Icon
          name={tx.incoming ? 'arrow-down-left' : 'arrow-up-right'}
          size={20}
          color={tx.incoming ? colors.green : colors.pink}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '500' }}>{tx.type}</Text>
        <Text style={s.subtext}>{tx.network}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text
          style={{
            color: tx.incoming ? colors.green : colors.text,
            fontSize: 14,
            fontWeight: '500',
          }}
        >
          {tx.amount} {tx.symbol}
        </Text>
        <Text style={s.subtext}>{tx.when.split(' · ')[0]}</Text>
      </View>
    </Pressable>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  appOuter: { flex: 1, backgroundColor: '#040b16', alignItems: 'center' },
  app: { width: '100%', maxWidth: 520, flex: 1, backgroundColor: colors.bg },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 8,
  },
  topline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: 8,
    minHeight: 46,
    borderRadius: 25,
    backgroundColor: colors.surface,
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1d3e55',
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceBlock: { alignItems: 'center', paddingTop: 26, paddingBottom: 28 },
  eye: { padding: 10, minWidth: 44, minHeight: 44 },
  total: {
    fontSize: 43,
    lineHeight: 58,
    fontWeight: '500',
    letterSpacing: -1.6,
    marginVertical: 5,
  },
  sectionLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 16,
  },
  smallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 5,
  },
  assetRow: {
    minHeight: 86,
    padding: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  line: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#26364a',
  },
  subtext: { fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 4 },
  txIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', gap: 9, flexWrap: 'wrap' },
  chip: {
    padding: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    minHeight: 46,
  },
  qrCard: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 28,
    alignSelf: 'center',
    marginTop: 24,
    marginBottom: 22,
  },
  amountInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  reviewIcon: {
    height: 64,
    width: 64,
    borderRadius: 24,
    backgroundColor: '#352035',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneIcon: {
    height: 86,
    width: 86,
    borderRadius: 43,
    backgroundColor: '#193b4c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBar: {
    paddingLeft: 22,
    paddingRight: 10,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#173048',
  },
  previewDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.blue,
  },
  watchBar: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#173048',
  },
  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#203047',
    paddingTop: 7,
    paddingBottom: 7,
    backgroundColor: '#0a172a',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60,
    gap: 3,
  },
  tabIcon: {
    width: 55,
    height: 32,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toast: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    backgroundColor: '#1c344c',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#3d5c77',
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    maxWidth: '90%',
  },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000a8' },
  sheet: {
    backgroundColor: '#102038',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 22,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  handle: {
    height: 4,
    width: 35,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: '#4a5b73',
    marginBottom: 22,
  },
});
