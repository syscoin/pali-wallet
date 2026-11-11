import { HIDDEN_BALANCE, useBalancePrivacy } from '../platform/balancePrivacy';
import { IdleTextInput, IdlePressable } from './IdleActivityBoundary';
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
  BackHandler,
  Keyboard,
  StyleSheet,
  View,
} from 'react-native';
import { formatTokenUnits } from '../../../../source/shared/erc20';
import { normalizeNftTokenId } from '../../../../source/utils/nftTokenId';
import type { Erc20Metadata } from '../../../../source/shared/erc20';
import { normalizeErc20Address } from '../portfolio/erc20Metadata';
import type { OwnedCollectibleSuggestion } from '../portfolio/ownedTokenReader';
import type {
  CollectibleQuery,
  CollectibleSaveTicket,
  NativeTokenSnapshot,
  NativeTokenView,
} from '../portfolio/nativeTokens';
import type { SavedCollectible } from '../portfolio/tokenRegistry';
import { Button, Card, Coin, colors, Icon, IconButton, Notice, styles, Text } from '../ui';
import { AssetMarketCard } from '../portfolio/AssetMarketCard';
import type { NativeNetworkRegistration } from '../custody/networkContext';

type Props = {
  initialContract?: string;
  registration?: NativeNetworkRegistration | null;
  nativeAsset?: React.ReactNode;
  controller: NativeTokenView;
  onReceive(): void;
  onSend?(token: Erc20Metadata): void;
  onSendCollectible?(collectible: SavedCollectible): void;
  onBackHandlerChange?(handler: (() => boolean) | null): void;
  onModeChange?(title: string | null): void;
};
type CollectibleSource =
  | { source: 'manual' }
  | { source: 'explorer'; item: OwnedCollectibleSuggestion }
  | { source: 'saved'; item: SavedCollectible };
type Route =
  | { kind: 'list' }
  | { kind: 'import' }
  | { kind: 'collectibles' }
  | ({ kind: 'collectible'; account: NonNullable<NativeTokenSnapshot['account']> } & CollectibleSource)
  | { kind: 'detail' | 'remove'; contract: string };
const scopeOf = (snapshot: NativeTokenSnapshot) =>
  snapshot.account
    ? `${snapshot.account.revision}:${snapshot.account.network}:${snapshot.account.address}`
    : 'unavailable';

/** Issuer metadata is display-only. The controller owns all reads and mutations. */
export function NativeTokens({ controller, ...props }: Props) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useLayoutEffect(() => controller.connect(), [controller]);
  return (
    <TokenContent
      key={scopeOf(snapshot)}
      controller={controller}
      snapshot={snapshot}
      {...props}
    />
  );
}

function TokenContent({
  controller,
  snapshot,
  registration,
  nativeAsset,
  onReceive,
  onSend,
  onSendCollectible,
  onBackHandlerChange,
  onModeChange,
  initialContract,
}: Props & { snapshot: NativeTokenSnapshot }) {
  const { hidden: hideBalances } = useBalancePrivacy();
  const [route, setRoute] = useState<Route>(initialContract ? { kind: 'detail', contract: initialContract } : { kind: 'list' });
  const [contract, setContract] = useState('');
  const [localError, setLocalError] = useState('');
  const lifetime = useRef({ alive: false, epoch: 0, running: false });
  const leaveCollectible = useRef<(() => void) | null>(null);
  const setCollectibleLeave = useCallback((leave: (() => void) | null) => {
    leaveCollectible.current = leave;
  }, []);
  const network = snapshot.network ?? { name: snapshot.account?.network ?? 'Network', chainId: '', symbol: '', testnet: false };
  const token =
    route.kind === 'detail' || route.kind === 'remove'
      ? snapshot.items.find(
          (item) =>
            item.metadata.contractAddress.toLowerCase() ===
            route.contract.toLowerCase()
        )
      : undefined;
  const busy = snapshot.busy || snapshot.previewStatus === 'loading';
  const hasNativeAsset = nativeAsset != null;
  const canSendToken = !!onSend && !!snapshot.account;
  const title =
    route.kind === 'import'
      ? 'Import token'
      : route.kind === 'collectibles'
      ? 'Collectibles'
      : route.kind === 'collectible'
      ? route.source === 'manual' ? 'Check collectible' : 'Collectible'
      : route.kind === 'detail'
      ? 'Token details'
      : route.kind === 'remove'
      ? 'Remove token'
      : hasNativeAsset ? 'Assets' : 'Tokens';
  useLayoutEffect(() => {
    onModeChange?.(route.kind === 'list' ? null : title);
    return () => onModeChange?.(null);
  }, [onModeChange, route.kind, title]);
  const back = useCallback(() => {
    if (route.kind === 'list') return false;
    if (snapshot.busy) return true;
    lifetime.current.epoch++;
    lifetime.current.running = false;
    if (route.kind === 'collectible') leaveCollectible.current?.();
    if ((route.kind === 'import' || route.kind === 'collectibles') &&
      controller.getSnapshot().account === snapshot.account) {
      controller.closeDiscovery();
      if (route.kind === 'import') controller.cancelPreview();
    }
    Keyboard.dismiss();
    setLocalError('');
    setRoute(
      route.kind === 'remove'
        ? { kind: 'detail', contract: route.contract }
        : route.kind === 'collectible'
        ? { kind: 'collectibles' }
        : { kind: 'list' }
    );
    return true;
  }, [controller, route, snapshot.account, snapshot.busy]);
  useLayoutEffect(() => {
    onBackHandlerChange?.(back);
    return () => onBackHandlerChange?.(null);
  }, [back, onBackHandlerChange]);
  useEffect(() => {
    const state = lifetime.current;
    state.alive = true;
    return () => {
      state.alive = false;
      state.epoch++;
    };
  }, [controller]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', back);
    return () => listener.remove();
  }, [back]);

  const run = async (action: () => Promise<void>, complete?: () => void) => {
    if (
      lifetime.current.running || busy || !snapshot.account ||
      controller.getSnapshot().account !== snapshot.account
    ) return;
    lifetime.current.running = true;
    const epoch = ++lifetime.current.epoch;
    setLocalError('');
    Keyboard.dismiss();
    try {
      await action();
      if (
        lifetime.current.alive &&
        lifetime.current.epoch === epoch &&
        controller.getSnapshot().account === snapshot.account
      )
        complete?.();
    } catch {
      if (
        lifetime.current.alive &&
        lifetime.current.epoch === epoch &&
        controller.getSnapshot().account === snapshot.account
      )
        setLocalError(
          'This token request could not be completed. Your saved tokens have been preserved.'
        );
    } finally {
      if (lifetime.current.epoch === epoch) lifetime.current.running = false;
    }
  };
  const openImport = () => {
    if (busy || controller.getSnapshot().account !== snapshot.account) return;
    controller.cancelPreview();
    setContract('');
    setLocalError('');
    setRoute({ kind: 'import' });
  };
  const discovery = snapshot.discovery;
  const openCollectible = (entry: CollectibleSource) => {
    const current = controller.getSnapshot();
    if (!current.account || current.account !== snapshot.account || current.busy ||
      (entry.source === 'manual' && !current.canCheckCollectible) ||
      (entry.source === 'explorer' && !current.discovery?.collectibles?.includes(entry.item)) ||
      (entry.source === 'saved' && !current.collectibles?.includes(entry.item))) return;
    const account = current.account;
    setRoute((previous) => previous.kind === 'collectibles'
      ? { kind: 'collectible', account, ...entry }
      : previous);
  };
  const returnToCollectibles = () => setRoute({ kind: 'collectibles' });
  const metadata =
    route.kind === 'import' ? snapshot.preview?.metadata : token?.metadata;
  const balance = (item: {
    status: string;
    units: string | null;
    metadata: { decimals: number };
  }) =>
    item.status === 'available' && item.units !== null
      ? hideBalances ? HIDDEN_BALANCE : formatTokenUnits(item.units, item.metadata.decimals)
      : item.status === 'loading'
      ? 'Loading…'
      : item.status === 'error'
      ? 'Balance unavailable'
      : 'Balance not loaded';
  const identity = metadata ? (
    <Card style={s.identity}>
      <View style={s.identityTop}>
        <View style={s.coin}>
          <Coin id="custom-token" asset={snapshot.network ? { kind: 'evm', chainId: snapshot.network.chainId, contractAddress: metadata.contractAddress, decimals: metadata.decimals } : undefined} registrationHash={registration?.registrationHash} fallbackSymbol={metadata.symbol} size={34} />
        </View>
        <Text style={s.name}>{metadata.name}</Text>
      </View>
      <Text style={styles.muted}>
        Custom token · Unverified issuer metadata
      </Text>
      <Text style={s.label}>NETWORK</Text>
      <Text>
        {network.name} · Chain {network.chainId}
        {network.testnet ? ' · Test network' : ''}
      </Text>
      <Text style={s.label}>CONTRACT ADDRESS</Text>
      <Text
        selectable
        style={s.contract}
        accessibilityLabel={`Token contract address ${metadata.contractAddress}`}
        testID="native-token-contract"
      >
        {metadata.contractAddress}
      </Text>
      <Text style={s.label}>SYMBOL · DECIMALS</Text>
      <Text>
        {metadata.symbol} · {metadata.decimals}
      </Text>
    </Card>
  ) : null;
  const error = localError || snapshot.error;

  return (
    <View style={s.section} testID="native-tokens">
      {(!onModeChange || route.kind === 'list') && (
        <View style={s.heading}>
          <Text accessibilityRole="header" style={s.title}>
            {title}
          </Text>
          {route.kind === 'list' && hasNativeAsset && (
            <View style={s.actionRow}>
              <Button title="Import token" icon="plus" size="compact" variant="secondary"
                disabled={busy || snapshot.status !== 'ready'} onPress={openImport} testID="native-token-import" />
              <IconButton label={snapshot.status === 'loading' ? 'Refreshing tokens' : 'Refresh tokens'} icon="refresh"
                disabled={busy || snapshot.status === 'loading'} onPress={() => run(() => controller.refresh())} />
            </View>
          )}
          {route.kind !== 'list' && (
            <Button
              title={route.kind === 'collectible' ? 'Back to collectibles' : 'Back to tokens'}
              variant="secondary" size="compact" icon="arrow-left"
              disabled={snapshot.busy}
              onPress={() => {
                back();
              }}
            />
          )}
        </View>
      )}
      {route.kind === 'list' && nativeAsset}
      {!snapshot.account || snapshot.status === 'unavailable' ? (
        <Notice
          title="Tokens unavailable"
          body="Unlock this wallet to view its saved tokens."
        />
      ) : (
        <>
          {route.kind === 'list' ? (
            <>
              {snapshot.status === 'loading' && (
                <ActivityIndicator
                  color={colors.pink}
                  accessibilityLabel="Loading saved tokens"
                />
              )}
              {snapshot.status === 'error' ? (
                <Notice
                  title="Saved tokens unavailable"
                  body="Your saved token list has been preserved. Retry to load it again."
                  tone="amber"
                />
              ) : snapshot.status === 'ready' && snapshot.items.length === 0 ? (
                hasNativeAsset ? <Text style={s.provenance}>No custom tokens added</Text> : <Notice
                  title="No custom tokens added"
                  body="Add a token by its contract address on this network."
                />
              ) : null}
              {snapshot.items.map((item) => (
                <IdlePressable
                  key={item.metadata.contractAddress}
                  accessibilityRole="button"
                  accessibilityLabel={`View token contract ${item.metadata.contractAddress} on ${network.name}`}
                  disabled={busy}
                  onPress={() => {
                    setLocalError('');
                    setRoute({
                      kind: 'detail',
                      contract: item.metadata.contractAddress,
                    });
                  }}
                >
                  <Card style={s.tokenRow}>
                    <View style={s.identityTop}>
                      <Coin id="custom-token" asset={snapshot.network ? { kind: 'evm', chainId: snapshot.network.chainId, contractAddress: item.metadata.contractAddress, decimals: item.metadata.decimals } : undefined} registrationHash={registration?.registrationHash} size={34} fallbackSymbol={item.metadata.symbol} />
                      <View style={s.tokenName}>
                        <Text style={s.name}>{item.metadata.name}</Text>
                        <Text style={s.provenance}>{item.metadata.symbol}</Text>
                      </View>
                      <Text style={s.rowBalance} testID="native-token-row-balance">{balance(item)}</Text>
                    </View>
                  </Card>
                </IdlePressable>
              ))}
              {!hasNativeAsset && <View style={s.actionRow}>
                <Button title="Import token" icon="plus" size="compact" variant="secondary"
                  style={s.action} disabled={busy || snapshot.status !== 'ready'} onPress={openImport} testID="native-token-import" />
                <IconButton label={snapshot.status === 'loading' ? 'Refreshing tokens' : 'Refresh tokens'} icon="refresh"
                  disabled={busy || snapshot.status === 'loading'} onPress={() => run(() => controller.refresh())} />
              </View>}
              {(discovery || snapshot.canCheckCollectible || !!snapshot.collectibles?.length) && (
                <Button
                  title="Collectibles"
                  variant="secondary"
                  disabled={busy || (!snapshot.canCheckCollectible && snapshot.status !== 'ready')}
                  onPress={() => {
                    if (controller.getSnapshot().account !== snapshot.account) return;
                    controller.closeDiscovery();
                    setLocalError('');
                    setRoute({ kind: 'collectibles' });
                  }}
                />
              )}
            </>
          ) : route.kind === 'collectibles' ? (
            <View style={s.section} testID="native-collectibles">
              {!!snapshot.collectibles?.length && <>
                <Text accessibilityRole="header" style={s.name}>Saved</Text>
                {snapshot.collectibles.map((item) => {
                  const id = 'tokenId' in item ? item.tokenId : undefined;
                  const label = id === undefined ? 'Saved collection' : `Saved token ${id}`;
                  return (
                    <Card key={`${item.contractAddress}:${id ?? ''}`} style={s.tokenRow}>
                      <Coin id="collectible" asset={snapshot.network ? { kind: 'evm', chainId: snapshot.network.chainId, contractAddress: item.contractAddress } : undefined} registrationHash={registration?.registrationHash} fallbackSymbol="NFT" size={32} />
                      <Text style={s.name}>{label}</Text>
                      <Text style={styles.muted}>{item.tokenStandard}</Text>
                      <Text selectable style={s.contract}>{item.contractAddress}</Text>
                      <IdlePressable
                        accessibilityRole="button"
                        accessibilityLabel={`View ${label.toLowerCase()}, ${item.contractAddress}`}
                        style={s.collectibleLink}
                        onPress={() => openCollectible({ source: 'saved', item })}
                      >
                        <Text style={s.collectibleAction}>View collectible</Text><Icon name="chevron-right" size={18} color={colors.text} />
                      </IdlePressable>
                    </Card>
                  );
                })}
              </>}
              {snapshot.canCheckCollectible && (
                <Button title="Check by contract" variant="secondary" onPress={() => openCollectible({ source: 'manual' })} />
              )}
              {discovery && <Text style={styles.muted}>
                Reported by the explorer. Ownership hasn’t been verified.
              </Text>}
              {discovery?.status === 'loading' && (
                <ActivityIndicator color={colors.pink} accessibilityLabel="Looking up collectibles" />
              )}
              {discovery?.status === 'error' && (
                <Notice title="Collectibles unavailable" body="The explorer did not return results. Try again." tone="amber" />
              )}
              {discovery?.status === 'ready' && !discovery.collectibles?.length && (
                <Notice title="No collectibles found" body="The explorer returned no collectible suggestions for this account." />
              )}
              {discovery?.collectibles?.map((item) => {
                const { contractAddress, name, tokenStandard, tokenId, units } = item;
                return <Card key={`${contractAddress}:${tokenId ?? ''}`} style={s.tokenRow}>
                  <Coin id="collectible" asset={snapshot.network ? { kind: 'evm', chainId: snapshot.network.chainId, contractAddress } : undefined} registrationHash={registration?.registrationHash} fallbackSymbol="NFT" size={32} />
                  <Text style={s.name}>{name}</Text>
                  <Text style={styles.muted}>{tokenStandard}</Text>
                  <Text selectable style={s.contract}>{contractAddress}</Text>
                  {tokenId !== undefined && <Text selectable style={s.contract}>Token ID {tokenId}</Text>}
                  <Text selectable style={s.contract}>
                    {tokenStandard === 'ERC-721' ? 'Items reported' : 'Quantity reported'}: {hideBalances ? HIDDEN_BALANCE : units}
                  </Text>
                  {snapshot.canCheckCollectible && <IdlePressable accessibilityRole="button"
                    accessibilityLabel={`View ${name} ${tokenId === undefined ? 'collection' : `token ${tokenId}`}`}
                    style={s.collectibleLink}
                    onPress={() => openCollectible({ source: 'explorer', item })}><Text style={s.collectibleAction}>View collectible</Text><Icon name="chevron-right" size={18} color={colors.text} /></IdlePressable>}
                </Card>;
              })}
              {discovery?.limited && <Text style={styles.muted}>Showing up to 20 results.</Text>}
              {discovery && discovery.status !== 'loading' && (
                <Button
                  title={discovery.status === 'ready' ? 'Refresh results' : discovery.status === 'error' ? 'Try again' : 'Find collectibles'}
                  variant="secondary"
                  disabled={busy || snapshot.status !== 'ready'}
                  onPress={() => {
                    if (controller.getSnapshot().account === snapshot.account)
                      void controller.discover('collectibles');
                  }}
                />
              )}
            </View>
          ) : route.kind === 'collectible' && route.account === snapshot.account &&
            (route.source === 'explorer' ? discovery?.collectibles?.includes(route.item)
              : route.source === 'saved' ? snapshot.collectibles?.includes(route.item)
              : snapshot.canCheckCollectible) ? (
            <CollectibleOwnership
              item={route.source === 'manual' ? null : route.item}
              network={network.name}
              busy={busy}
              canCheck={snapshot.canCheckCollectible === true}
              enumerate={snapshot.canEnumerateCollectible ? (query, signal) =>
                controller.enumerateCollectible(route.account, query, signal) : undefined}
              check={(query, signal) => route.source === 'explorer'
                ? controller.checkCollectible(route.item, query.tokenId, signal)
                : route.source === 'saved'
                ? controller.checkSavedCollectible(route.account, route.item, query.tokenId, signal)
                : controller.checkManualCollectible(route.account, query, signal)}
              onSave={(ticket) => run(async () => {
                if (!(await controller.saveCollectible(ticket))) throw new Error('CHANGED');
              }, returnToCollectibles)}
              onRemove={route.source === 'saved' ? () => run(async () => {
                if (!(await controller.removeCollectible(route.account, route.item)))
                  throw new Error('CHANGED');
              }, returnToCollectibles) : undefined}
              onSend={route.source === 'saved' && onSendCollectible ? () => {
                const current = controller.getSnapshot();
                if (!lifetime.current.alive || lifetime.current.running || current.busy || current.account !== route.account ||
                    !current.collectibles?.includes(route.item)) return;
                onSendCollectible(route.item);
              } : undefined}
              onLeaveChange={setCollectibleLeave}
            />
          ) : route.kind === 'import' ? (
            <>
              <Text style={styles.muted}>
                Enter the token contract on {network.name}. Its name and symbol
                do not verify its identity.
              </Text>
              <View style={s.field}>
                <Text style={s.label}>CONTRACT ADDRESS</Text>
                <IdleTextInput
                  accessibilityLabel="Token contract address"
                  value={contract}
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  autoComplete="off"
                  textContentType="none"
                  maxLength={128}
                  onChangeText={(value) => {
                    controller.cancelPreview();
                    setLocalError('');
                    setContract(value);
                  }}
                  style={s.input}
                  placeholder="0x…"
                  placeholderTextColor={colors.muted}
                  testID="native-token-address-input"
                />
              </View>
              <Button
                title={
                  snapshot.previewStatus === 'loading'
                    ? 'Reading token…'
                    : 'Review token'
                }
                disabled={busy || !contract.trim()}
                onPress={() => run(() => controller.preview(contract))}
                testID="native-token-review"
              />
              {snapshot.previewStatus === 'loading' && (
                <ActivityIndicator
                  color={colors.pink}
                  accessibilityLabel="Reading token metadata and balance"
                />
              )}
              {discovery && ['idle', 'error'].includes(snapshot.previewStatus) && (
                <View style={s.section} testID="native-token-holdings">
                  <Text accessibilityRole="header" style={s.title}>
                    Wallet holdings
                  </Text>
                  <Text style={styles.muted}>
                    Suggestions from the network explorer for this address.
                    Check the contract before adding a token.
                  </Text>
                  {discovery.status === 'loading' && (
                    <ActivityIndicator
                      color={colors.pink}
                      accessibilityLabel="Looking up wallet holdings"
                    />
                  )}
                  {discovery.status === 'error' && (
                    <Notice
                      title="Holdings unavailable"
                      body="Retry the explorer or enter a contract above."
                      tone="amber"
                    />
                  )}
                  {discovery.status === 'idle' || discovery.status === 'error' ? (
                    <Button
                      title={discovery.status === 'error' ? 'Retry holdings' : 'Find holdings'}
                      variant="secondary"
                      disabled={busy}
                      onPress={() => {
                        if (controller.getSnapshot().account === snapshot.account)
                          void controller.discover();
                      }}
                    />
                  ) : null}
                  {discovery.status === 'ready' && !discovery.tokens.length && (
                    <Text style={styles.muted}>
                      The explorer returned no new token suggestions. You can
                      still enter a contract above.
                    </Text>
                  )}
                  {discovery.tokens.map(({ contractAddress, name, symbol }) => (
                    <IdlePressable
                      key={contractAddress}
                      accessibilityRole="button"
                      accessibilityLabel={`Review ${symbol} token contract ${contractAddress}`}
                      disabled={busy}
                      onPress={() => {
                        if (controller.getSnapshot().discovery !== discovery) return;
                        void run(() => {
                          setContract(contractAddress);
                          return controller.preview(contractAddress);
                        });
                      }}
                    >
                      <Card style={s.tokenRow}>
                        <Text style={s.name}>{name} · {symbol}</Text>
                        <Text style={s.contract}>{contractAddress}</Text>
                      </Card>
                    </IdlePressable>
                  ))}
                  {discovery.limited && (
                    <Text style={styles.muted}>
                      Showing up to 20 suggestions. Enter other contracts above.
                    </Text>
                  )}
                </View>
              )}
              {snapshot.previewStatus === 'ready' && snapshot.preview && (
                <>
                  {identity}
                  <Text
                    style={s.balance}
                    accessibilityLabel={hideBalances ? 'Balance hidden' : `Token balance ${formatTokenUnits(
                      snapshot.preview.units,
                      snapshot.preview.metadata.decimals
                    )}`}
                    testID="native-token-preview-balance"
                  >
                    {hideBalances ? HIDDEN_BALANCE : formatTokenUnits(
                      snapshot.preview.units,
                      snapshot.preview.metadata.decimals
                    )}{' '}
                    {snapshot.preview.metadata.symbol}
                  </Text>
                  <Notice
                    title="Check the contract"
                    body="Anyone can create a token with a familiar name or symbol. Compare this complete contract address with a source you trust."
                    tone="amber"
                  />
                  <Button
                    title="Add token"
                    disabled={busy}
                    onPress={() => {
                      const selected =
                        snapshot.preview!.metadata.contractAddress;
                      void run(
                        () => controller.confirmPreview(),
                        () => {
                          if (
                            controller
                              .getSnapshot()
                              .items.some(
                                (item) =>
                                  item.metadata.contractAddress === selected
                              )
                          ) {
                            controller.closeDiscovery();
                            setRoute({ kind: 'detail', contract: selected });
                          }
                        }
                      );
                    }}
                    testID="native-token-add"
                  />
                </>
              )}
            </>
          ) : !token ? (
            <Notice
              title="Token is no longer in this list"
              body="Return to your tokens to refresh the current account."
            />
          ) : (
            <>
              {route.kind === 'remove' ? (
                <>
                  {identity}
                  <Notice
                    title="Remove from this token list?"
                    body="This removes the saved token entry for this account and network. Your funds stay at this address, and you can add the contract again."
                    tone="amber"
                  />
                  <Button
                    title="Remove token from list"
                    variant="danger"
                    disabled={busy}
                    onPress={() => {
                      const selected = token.metadata.contractAddress;
                      void run(
                        () => controller.remove(selected),
                        () => {
                          if (
                            !controller
                              .getSnapshot()
                              .items.some(
                                (item) =>
                                  item.metadata.contractAddress === selected
                              )
                          )
                            setRoute({ kind: 'list' });
                        }
                      );
                    }}
                    testID="native-token-remove-confirm"
                  />
                  <Button
                    title="Keep token"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => {
                      back();
                    }}
                  />
                </>
              ) : (
                <>
                  <View style={s.assetHero}>
                    <Coin id="custom-token" asset={snapshot.network ? { kind: 'evm', chainId: snapshot.network.chainId, contractAddress: token.metadata.contractAddress, decimals: token.metadata.decimals } : undefined} registrationHash={registration?.registrationHash} size={44} fallbackSymbol={token.metadata.symbol} />
                    <Text style={s.name}>{token.metadata.name}</Text>
                  <Text
                    style={s.balance}
                    accessibilityLabel={hideBalances ? 'Balance hidden' : `Token balance ${balance(token)}`}
                    testID="native-token-detail-balance"
                  >
                    {balance(token)}
                    {token.status === 'available'
                      ? ` ${token.metadata.symbol}`
                      : ''}
                  </Text>
                  {token.updatedAt !== null && token.status === 'available' && (
                    <Text style={s.provenance}>
                      Observed{' '}
                      {new Date(token.updatedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  )}
                  </View>
                  {!canSendToken && <Notice
                    title="Receive only"
                    body="Sending this token is not available in this build."
                  />}
                  <View style={s.actionRow}>
                    {canSendToken && <Button title="Send" icon="arrow-up-right" size="compact" style={s.action} disabled={busy}
                      onPress={() => onSend?.(token.metadata)} />}
                    <Button title="Receive" icon="arrow-down-left" size="compact" style={s.action} variant="secondary" disabled={busy} onPress={onReceive} />
                  </View>
                  <AssetMarketCard asset={{ kind: 'token', networkId: snapshot.account.network, contractAddress: token.metadata.contractAddress, registration }} />
                  {identity}
                  <Button
                    title="Refresh token balance"
                    size="compact"
                    icon="refresh"
                    variant="secondary"
                    disabled={busy || token.status === 'loading'}
                    onPress={() =>
                      run(() =>
                        controller.refresh(token.metadata.contractAddress)
                      )
                    }
                  />
                  <Button
                    title="Remove token"
                    variant="danger" size="compact" icon="trash"
                    disabled={busy}
                    onPress={() =>
                      setRoute({
                        kind: 'remove',
                        contract: token.metadata.contractAddress,
                      })
                    }
                  />
                </>
              )}
            </>
          )}
          {snapshot.busy && (
            <ActivityIndicator
              color={colors.pink}
              accessibilityLabel="Saving token list"
            />
          )}
          {!!error && (
            <Text
              style={s.error}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {error}
            </Text>
          )}

        </>
      )}
    </View>
  );
}

const collectibleStandards = ['ERC-721', 'ERC-1155'] as const;

export function CollectibleOwnership({ item, network, check, enumerate, busy, canCheck, onSave, onRemove, onSend, onLeaveChange }: {
  item: OwnedCollectibleSuggestion | SavedCollectible | null;
  network: string;
  busy: boolean;
  canCheck: boolean;
  check(query: CollectibleQuery, signal: AbortSignal): ReturnType<NativeTokenView['checkCollectible']>;
  enumerate?(query: { contractAddress: string; tokenStandard: 'ERC-721' }, signal: AbortSignal): ReturnType<NativeTokenView['enumerateCollectible']>;
  onSave(ticket: CollectibleSaveTicket): Promise<void>;
  onRemove?(): Promise<void>;
  onSend?(): void;
  onLeaveChange(leave: (() => void) | null): void;
}) {
  const { hidden: hideBalances } = useBalancePrivacy();
  const fixedId = item && 'tokenId' in item ? item.tokenId : undefined;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [draft, setDraft] = useState<{
    contractAddress: string;
    tokenId: string;
    tokenStandard: CollectibleQuery['tokenStandard'] | null;
  }>({ contractAddress: item?.contractAddress ?? '', tokenId: fixedId ?? '', tokenStandard: item?.tokenStandard ?? null });
  const currentDraft = useRef(draft);
  type Enumeration = { kind: 'idle' | 'loading' | 'error' } | {
    kind: 'ready'; draft: typeof draft; tokenIds: readonly string[]; hasMore: boolean; method: 'enumeration' | 'manual'; totalOwned?: string;
  };
  const [enumeration, setEnumeration] = useState<Enumeration>({ kind: 'idle' });
  const enumerationRequest = useRef<AbortController | null>(null);
  const enumerationResult = useRef<Extract<Enumeration, { kind: 'ready' }> | null>(null);
  const autoEnumerated = useRef<{ item: NonNullable<typeof item> } | null>(null);
  const [result, setResult] = useState<
    | { kind: 'idle' | 'loading' | 'error' }
    | { kind: 'invalid'; message: string }
    | { kind: 'ready'; units: string; ticket?: CollectibleSaveTicket; alreadySaved?: true }
  >({ kind: 'idle' });
  const active = useRef<AbortController | null>(null);
  const reviewed = useRef<{ request: AbortController; ticket: CollectibleSaveTicket } | null>(null);
  const alive = useRef(false);
  const cancel = useCallback((preserveEnumeration = false) => {
    const request = active.current;
    active.current = null;
    request?.abort();
    const review = reviewed.current;
    reviewed.current = null;
    review?.request.abort();
    if (!preserveEnumeration) {
      const enumeration = enumerationRequest.current;
      enumerationRequest.current = null;
      enumeration?.abort();
      enumerationResult.current = null;
    }
  }, []);
  useLayoutEffect(() => {
    alive.current = true;
    const leave = () => {
      alive.current = false;
      autoEnumerated.current = null;
      cancel();
    };
    onLeaveChange(leave);
    return () => {
      onLeaveChange(null);
      leave();
    };
  }, [cancel, item, onLeaveChange]);
  const edit = (fields: Partial<typeof draft>) => {
    if (!alive.current || busy) return;
    cancel();
    const next = { ...currentDraft.current, ...fields };
    currentDraft.current = next;
    setDraft(next);
    setResult({ kind: 'idle' });
    setEnumeration({ kind: 'idle' });
  };
  const read = async (selected?: CollectibleQuery) => {
    if (!alive.current || active.current || enumerationRequest.current || busy || !canCheck) return;
    const preserveEnumeration = enumerationResult.current?.draft === currentDraft.current;
    cancel(preserveEnumeration);
    if (!preserveEnumeration) setEnumeration({ kind: 'idle' });
    const { contractAddress: address, tokenId: id, tokenStandard } = selected ?? currentDraft.current;
    if (!tokenStandard) return;
    let contractAddress: string, tokenId: string;
    try { contractAddress = normalizeErc20Address(address.trim()); }
    catch { setResult({ kind: 'invalid', message: 'Enter a valid contract address.' }); return; }
    try { tokenId = normalizeNftTokenId(id.trim()); }
    catch { setResult({ kind: 'invalid', message: 'Enter a valid token ID.' }); return; }
    const request = new AbortController();
    active.current = request;
    Keyboard.dismiss();
    setResult({ kind: 'loading' });
    try {
      const { units, saveTicket, alreadySaved } = await check({ contractAddress, tokenId, tokenStandard }, request.signal);
      if (active.current === request) {
        if (saveTicket) reviewed.current = { request, ticket: saveTicket };
        setResult({ kind: 'ready', units, ticket: saveTicket, alreadySaved });
      }
    } catch {
      if (active.current === request) setResult({ kind: 'error' });
    } finally {
      if (active.current === request) active.current = null;
    }
  };
  const findTokenIds = async () => {
    if (!alive.current || busy || active.current || enumerationRequest.current || !enumerate) return;
    const selected = currentDraft.current;
    if (selected.tokenStandard !== 'ERC-721' || fixedId !== undefined) return;
    let contractAddress: string;
    try { contractAddress = normalizeErc20Address(selected.contractAddress.trim()); }
    catch { setResult({ kind: 'invalid', message: 'Enter a valid contract address.' }); return; }
    cancel();
    setResult({ kind: 'idle' });
    const request = new AbortController();
    enumerationRequest.current = request;
    setEnumeration({ kind: 'loading' });
    Keyboard.dismiss();
    try {
      const result = await enumerate({ contractAddress, tokenStandard: 'ERC-721' }, request.signal);
      if (!alive.current || enumerationRequest.current !== request || currentDraft.current !== selected) return;
      const next = { kind: 'ready' as const, draft: selected, ...result };
      enumerationResult.current = next;
      setEnumeration(next);
    } catch {
      if (alive.current && enumerationRequest.current === request) setEnumeration({ kind: 'error' });
    } finally {
      if (enumerationRequest.current === request) enumerationRequest.current = null;
      request.abort();
    }
  };
  const selectTokenId = (listing: Extract<Enumeration, { kind: 'ready' }>, tokenId: string) => {
    if (!alive.current || busy || active.current || enumerationResult.current !== listing || currentDraft.current !== listing.draft || !listing.tokenIds.includes(tokenId)) return;
    const selected = { contractAddress: listing.draft.contractAddress, tokenStandard: 'ERC-721' as const, tokenId };
    currentDraft.current = selected;
    setDraft(selected);
    const next = { ...listing, draft: selected };
    enumerationResult.current = next;
    setEnumeration(next);
    void read(selected);
  };
  useEffect(() => {
    if (!alive.current || !item || item.tokenStandard !== 'ERC-721' || fixedId !== undefined || !enumerate || busy || autoEnumerated.current?.item === item) return;
    const request = { item };
    autoEnumerated.current = request;
    void Promise.resolve().then(() => {
      if (alive.current && autoEnumerated.current === request) return findTokenIds();
    });
  });
  return <View style={s.section} testID="native-collectible-ownership">
    {item ? <Card style={s.tokenRow}>
      {'name' in item && <Text style={s.provenance}>Explorer-reported name</Text>}
      <Text style={s.name}>{'name' in item ? item.name : fixedId === undefined ? 'Saved collection' : 'Saved collectible'}</Text>
      <Text style={styles.muted}>{item.tokenStandard}</Text>
      <Text selectable style={s.contract}>{item.contractAddress}</Text>
      {fixedId !== undefined && <Text selectable style={s.contract}>Token ID {fixedId}</Text>}
    </Card> : <>
      <Text style={styles.muted}>Check this account on {network}.</Text>
      <View style={s.field}>
        <Text style={s.label}>CONTRACT ADDRESS</Text>
        <IdleTextInput accessibilityLabel="Collectible contract address" value={draft.contractAddress} editable={!busy}
          onChangeText={(contractAddress) => edit({ contractAddress })}
          autoCapitalize="none" autoCorrect={false} spellCheck={false}
          autoComplete="off" textContentType="none" maxLength={128} style={s.input}
          placeholder="0x…" placeholderTextColor={colors.muted} />
      </View>
      <View style={s.field}>
        <Text style={s.label}>TOKEN STANDARD</Text>
        <View style={s.standardChoices}>
          {collectibleStandards.map((tokenStandard) => {
            const selected = draft.tokenStandard === tokenStandard;
            return (
              <IdlePressable
                key={tokenStandard}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                aria-pressed={selected}
                disabled={busy}
                onPress={() => {
                  if (currentDraft.current.tokenStandard !== tokenStandard)
                    edit({ tokenStandard });
                }}
                style={({ pressed }) => [
                  styles.button, s.standardButton, selected && s.standardSelected,
                  pressed && { opacity: 0.72 },
                ]}
              >
                <Text style={s.standardLabel}>{tokenStandard}</Text>
              </IdlePressable>
            );
          })}
        </View>
      </View>
    </>}
    {!confirmRemove && onSend && <Button title="Send collectible" icon="arrow-up-right" disabled={busy || result.kind === 'loading' || enumeration.kind === 'loading'}
      onPress={() => {
        if (!alive.current || active.current || enumerationRequest.current || busy) return;
        cancel();
        setResult({ kind: 'idle' });
        onSend();
      }} />}
    {!confirmRemove && canCheck && fixedId === undefined && <View style={s.field}>
      <Text style={s.label}>TOKEN ID</Text>
      <IdleTextInput accessibilityLabel="Token ID" value={draft.tokenId} editable={!busy}
        onChangeText={(tokenId) => edit({ tokenId })}
        keyboardType="number-pad" autoCapitalize="none" autoCorrect={false}
        maxLength={256} style={s.input} />
    </View>}
    {!confirmRemove && enumerate && draft.tokenStandard === 'ERC-721' && fixedId === undefined && <>
      <Button title={enumeration.kind === 'loading' ? 'Finding token IDs…' : enumeration.kind === 'ready' ? 'Refresh token IDs' : 'Find token IDs'} variant="secondary"
        disabled={busy || !draft.contractAddress.trim() || result.kind === 'loading' || enumeration.kind === 'loading'} onPress={() => void findTokenIds()} />
      {enumeration.kind === 'loading' && <ActivityIndicator color={colors.pink} accessibilityLabel="Finding token IDs" />}
      {enumeration.kind === 'error' && <Notice title="Token IDs unavailable" body="The network couldn’t list token IDs. Try again or enter a token ID manually." tone="amber" />}
      {enumeration.kind === 'ready' && <Card style={s.tokenRow} testID="native-collectible-enumeration">
        {enumeration.totalOwned !== undefined && <Text selectable style={s.contract} testID="native-collection-balance"
          accessibilityLabel={hideBalances ? 'Collection balance hidden' : `Collection balance: ${enumeration.totalOwned} NFTs`}>
          Collection balance: {hideBalances ? HIDDEN_BALANCE : `${enumeration.totalOwned} NFTs`}
        </Text>}
        {enumeration.method === 'manual' ? <Text style={styles.muted}>Token ID lookup is unavailable. Enter a token ID manually.</Text>
          : !enumeration.tokenIds.length ? <Text style={styles.muted}>No token IDs found for this account. You can still enter a token ID manually.</Text>
          : <>
            <Text style={styles.muted}>Choose a token ID to check ownership.</Text>
            {enumeration.tokenIds.map(tokenId => <Button key={tokenId} title={`Token ID ${tokenId}`} variant="secondary" size="compact"
              icon={draft.tokenId === tokenId ? 'check' : undefined} disabled={busy || result.kind === 'loading'} onPress={() => selectTokenId(enumeration, tokenId)} />)}
            {enumeration.hasMore && <Text style={styles.muted}>Showing the first 10 token IDs. Enter another token ID manually.</Text>}
          </>}
      </Card>}
    </>}
    {result.kind === 'invalid' && <Text accessibilityRole="alert" style={s.error}>{result.message}</Text>}
    {result.kind === 'error' && <Notice title="Ownership unavailable" body="The network couldn’t confirm this item. Try again." tone="amber" />}
    {result.kind === 'ready' && <Text selectable accessibilityLiveRegion="polite" testID="native-collectible-quantity">
      {hideBalances ? 'Balance hidden' : draft.tokenStandard === 'ERC-721' ? (result.units === '0' ? 'This account doesn’t own this item.' : 'This account owns this item.') : `Quantity on network: ${result.units}`}
    </Text>}
    {!confirmRemove && canCheck && <Button title={result.kind === 'loading' ? 'Checking ownership…' : 'Check ownership'}
      variant={onSend ? 'secondary' : 'primary'}
      disabled={busy || !draft.contractAddress.trim() || !draft.tokenId.trim() || !draft.tokenStandard || result.kind === 'loading' || enumeration.kind === 'loading'}
      onPress={() => void read()} />}
    {result.kind === 'loading' && <ActivityIndicator color={colors.pink} accessibilityLabel="Checking ownership" />}
    {result.kind === 'ready' && result.alreadySaved && <Text style={styles.muted}>Already in your saved list.</Text>}
    {result.kind === 'ready' && result.ticket && <Button
      title="Save collectible" variant="secondary" disabled={busy}
      onPress={() => {
        if (!alive.current || busy || !result.ticket || reviewed.current?.ticket !== result.ticket) return;
        setResult({ kind: 'ready', units: result.units });
        void onSave(result.ticket);
      }}
    />}
    {onRemove && (confirmRemove ? <>
      <Notice title="Remove this collectible?" body="It will be removed from your saved list. Its ownership won’t change." />
      <Button title="Remove from saved list" variant="danger" disabled={busy} onPress={() => void onRemove()} />
      <Button title="Cancel" variant="secondary" size="compact" disabled={busy} onPress={() => setConfirmRemove(false)} />
    </> : <Button title="Remove collectible" variant="danger" size="compact" icon="trash" disabled={busy} onPress={() => {
      cancel();
      setResult({ kind: 'idle' });
      setConfirmRemove(true);
    }} />)}
  </View>;
}

const s = StyleSheet.create({
  section: { gap: 12 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  action: { flex: 1, minWidth: 0, paddingHorizontal: 10 },
  assetHero: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  rowBalance: { fontSize: 14, lineHeight: 21, fontWeight: '600', textAlign: 'right', maxWidth: '45%', flexShrink: 1 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  title: { fontSize: 21, lineHeight: 29, fontWeight: '600' },
  field: { gap: 9 },
  standardChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  standardButton: {
    flexGrow: 1, maxWidth: '100%', borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.raised,
  },
  standardSelected: { borderColor: colors.pink },
  standardLabel: { fontWeight: '600', textAlign: 'center', flexShrink: 1, minWidth: 0 },
  label: {
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.8,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    minHeight: 56,
    color: colors.text,
    fontSize: 16,
  },
  coin: {
    width: 34,
    height: 34,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: { padding: 18, gap: 10 },
  identityTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 17, lineHeight: 25, fontWeight: '600', flexShrink: 1 },
  tokenRow: { padding: 14, gap: 8 },
  collectibleLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.raised },
  collectibleAction: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  tokenName: { gap: 3, flex: 1 },
  contract: { fontSize: 13, lineHeight: 22 },
  rowContract: { fontSize: 11, lineHeight: 18, color: colors.muted },
  balance: { textAlign: 'center', fontSize: 26, lineHeight: 36, fontWeight: '600', flexShrink: 1 },
  provenance: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  error: { color: colors.red, fontSize: 14, lineHeight: 22 },
});
