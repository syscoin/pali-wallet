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
import type { OwnedCollectibleSuggestion } from '../portfolio/ownedTokenReader';
import type {
  NativeTokenSnapshot,
  NativeTokenView,
} from '../portfolio/nativeTokens';
import { Button, Card, Coin, colors, Notice, styles, Text } from '../ui';

type Props = {
  controller: NativeTokenView;
  onReceive(): void;
  onSend?(token: Erc20Metadata): void;
  onBackHandlerChange?(handler: (() => boolean) | null): void;
  onModeChange?(title: string | null): void;
};
type Route =
  | { kind: 'list' }
  | { kind: 'import' }
  | { kind: 'collectibles' }
  | { kind: 'collectible'; item: OwnedCollectibleSuggestion }
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
  onReceive,
  onSend,
  onBackHandlerChange,
  onModeChange,
}: Props & { snapshot: NativeTokenSnapshot }) {
  const [route, setRoute] = useState<Route>({ kind: 'list' });
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
  const canSendToken = !!onSend && !!snapshot.account;
  const title =
    route.kind === 'import'
      ? 'Import token'
      : route.kind === 'collectibles'
      ? 'Collectibles'
      : route.kind === 'collectible'
      ? 'Collectible'
      : route.kind === 'detail'
      ? 'Token details'
      : route.kind === 'remove'
      ? 'Remove token'
      : 'Tokens';
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
  const metadata =
    route.kind === 'import' ? snapshot.preview?.metadata : token?.metadata;
  const balance = (item: {
    status: string;
    units: string | null;
    metadata: { decimals: number };
  }) =>
    item.status === 'available' && item.units !== null
      ? formatTokenUnits(item.units, item.metadata.decimals)
      : item.status === 'loading'
      ? 'Loading…'
      : item.status === 'error'
      ? 'Balance unavailable'
      : 'Balance not loaded';
  const identity = metadata ? (
    <Card style={s.identity}>
      <View style={s.identityTop}>
        <View style={s.coin}>
          <Coin id="custom-token" size={34} />
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
          {route.kind !== 'list' && (
            <Button
              title={route.kind === 'collectible' ? 'Back to collectibles' : 'Back to tokens'}
              variant="quiet"
              disabled={snapshot.busy}
              onPress={() => {
                back();
              }}
            />
          )}
        </View>
      )}
      {!snapshot.account || snapshot.status === 'unavailable' ? (
        <Notice
          title="Tokens unavailable"
          body="Unlock this wallet to view its saved tokens."
        />
      ) : (
        <>
          {route.kind === 'list' ? (
            <>
              <Text style={styles.muted}>
                Custom tokens for this account on {network.name}.
              </Text>
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
                <Notice
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
                      <View style={s.coin}>
                        <Coin id="custom-token" size={32} />
                      </View>
                      <View style={s.tokenName}>
                        <Text style={s.name}>{item.metadata.name}</Text>
                        <Text style={styles.muted}>
                          {item.metadata.symbol} · {network.name}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.balance} testID="native-token-row-balance">
                      {balance(item)}
                    </Text>

                  </Card>
                </IdlePressable>
              ))}
              <Button
                title="Import token"
                icon="plus"
                disabled={busy || snapshot.status !== 'ready'}
                onPress={openImport}
                testID="native-token-import"
              />
              <Button
                title={
                  snapshot.status === 'loading'
                    ? 'Refreshing tokens…'
                    : 'Refresh tokens'
                }
                icon="refresh"
                variant="secondary"
                disabled={busy || snapshot.status === 'loading'}
                onPress={() => run(() => controller.refresh())}
              />
              {discovery && (
                <Button
                  title="Collectibles"
                  variant="secondary"
                  disabled={busy || snapshot.status !== 'ready'}
                  onPress={() => {
                    if (controller.getSnapshot().account !== snapshot.account) return;
                    controller.closeDiscovery();
                    setLocalError('');
                    setRoute({ kind: 'collectibles' });
                  }}
                />
              )}
            </>
          ) : route.kind === 'collectibles' && discovery ? (
            <View style={s.section} testID="native-collectibles">
              <Text style={styles.muted}>
                Reported by the explorer. Ownership hasn’t been verified.
              </Text>
              {discovery.status === 'loading' && (
                <ActivityIndicator color={colors.pink} accessibilityLabel="Looking up collectibles" />
              )}
              {discovery.status === 'error' && (
                <Notice title="Collectibles unavailable" body="The explorer did not return results. Try again." tone="amber" />
              )}
              {discovery.status === 'ready' && !discovery.collectibles?.length && (
                <Notice title="No collectibles found" body="The explorer returned no collectible suggestions for this account." />
              )}
              {discovery.collectibles?.map((item) => {
                const { contractAddress, name, tokenStandard, tokenId, units } = item;
                return <Card key={`${contractAddress}:${tokenId ?? ''}`} style={s.tokenRow}>
                  <Text style={s.name}>{name}</Text>
                  <Text style={styles.muted}>{tokenStandard}</Text>
                  <Text selectable style={s.contract}>{contractAddress}</Text>
                  {tokenId !== undefined && <Text selectable style={s.contract}>Token ID {tokenId}</Text>}
                  <Text selectable style={s.contract}>
                    {tokenStandard === 'ERC-721' ? 'Items reported' : 'Quantity reported'}: {units}
                  </Text>
                  {snapshot.canCheckCollectible && <IdlePressable accessibilityRole="button"
                    accessibilityLabel={`View ${name} ${tokenId === undefined ? 'collection' : `token ${tokenId}`}`}
                    style={s.collectibleLink}
                    onPress={() => {
                      if (controller.getSnapshot().discovery === discovery) setRoute({ kind: 'collectible', item });
                    }}><Text style={s.provenance}>View collectible ›</Text></IdlePressable>}
                </Card>;
              })}
              {discovery.limited && <Text style={styles.muted}>Showing up to 20 results.</Text>}
              {discovery.status !== 'loading' && (
                <Button
                  title={discovery.status === 'ready' ? 'Refresh results' : discovery.status === 'error' ? 'Try again' : 'Find collectibles'}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => {
                    if (controller.getSnapshot().account === snapshot.account)
                      void controller.discover('collectibles');
                  }}
                />
              )}
            </View>
          ) : route.kind === 'collectible' && discovery?.collectibles?.includes(route.item) ? (
            <CollectibleOwnership
              item={route.item}
              check={controller.checkCollectible}
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
                    accessibilityLabel={`Token balance ${formatTokenUnits(
                      snapshot.preview.units,
                      snapshot.preview.metadata.decimals
                    )}`}
                    testID="native-token-preview-balance"
                  >
                    {formatTokenUnits(
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
              {identity}
              {route.kind === 'remove' ? (
                <>
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
                  <Text
                    style={s.balance}
                    accessibilityLabel={`Token balance ${balance(token)}`}
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
                  {!canSendToken && <Notice
                    title="Receive only"
                    body="Sending this token is not available in this build."
                  />}
                  {canSendToken && <Button title="Send token" icon="arrow-up-right" disabled={busy}
                    onPress={() => onSend?.(token.metadata)} />}
                  <Button
                    title="Receive token"
                    icon="arrow-down-left"
                    disabled={busy}
                    onPress={onReceive}
                  />
                  <Button
                    title="Refresh token balance"
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
                    variant="quiet"
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

function CollectibleOwnership({ item, check, onLeaveChange }: {
  item: OwnedCollectibleSuggestion;
  check: NativeTokenView['checkCollectible'];
  onLeaveChange(leave: (() => void) | null): void;
}) {
  const [id, setId] = useState(item.tokenId ?? '');
  const currentId = useRef(id);
  const [result, setResult] = useState<
    | { kind: 'idle' | 'loading' | 'error' | 'invalid' }
    | { kind: 'ready'; units: string }
  >({ kind: 'idle' });
  const active = useRef<AbortController | null>(null);
  const alive = useRef(false);
  const cancel = useCallback(() => {
    const request = active.current;
    active.current = null;
    request?.abort();
  }, []);
  useLayoutEffect(() => {
    alive.current = true;
    const leave = () => {
      alive.current = false;
      cancel();
    };
    onLeaveChange(leave);
    return () => {
      onLeaveChange(null);
      leave();
    };
  }, [cancel, item, onLeaveChange]);
  const read = async () => {
    if (!alive.current || active.current) return;
    let tokenId: string;
    try { tokenId = normalizeNftTokenId(currentId.current.trim()); }
    catch { setResult({ kind: 'invalid' }); return; }
    const request = new AbortController();
    active.current = request;
    Keyboard.dismiss();
    setResult({ kind: 'loading' });
    try {
      const { units } = await check(item, tokenId, request.signal);
      if (active.current === request) setResult({ kind: 'ready', units });
    } catch {
      if (active.current === request) setResult({ kind: 'error' });
    } finally {
      if (active.current === request) active.current = null;
    }
  };
  return <View style={s.section} testID="native-collectible-ownership">
    <Card style={s.tokenRow}>
      <Text style={s.provenance}>Explorer-reported name</Text>
      <Text style={s.name}>{item.name}</Text>
      <Text style={styles.muted}>{item.tokenStandard}</Text>
      <Text selectable style={s.contract}>{item.contractAddress}</Text>
    </Card>
    {item.tokenId === undefined ? <View style={s.field}>
      <Text style={s.label}>TOKEN ID</Text>
      <IdleTextInput accessibilityLabel="Token ID" value={id}
        onChangeText={(value) => {
          if (!alive.current) return;
          cancel();
          currentId.current = value;
          setId(value);
          setResult({ kind: 'idle' });
        }}
        keyboardType="number-pad" autoCapitalize="none" autoCorrect={false}
        maxLength={256} style={s.input} />
    </View> : <Text selectable style={s.contract}>Token ID {item.tokenId}</Text>}
    {result.kind === 'invalid' && <Text accessibilityRole="alert" style={s.error}>Enter a valid token ID.</Text>}
    {result.kind === 'error' && <Notice title="Ownership unavailable" body="The network couldn’t confirm this item. Try again." tone="amber" />}
    {result.kind === 'ready' && <Text selectable accessibilityLiveRegion="polite" testID="native-collectible-quantity">
      {item.tokenStandard === 'ERC-721' ? (result.units === '0' ? 'This account doesn’t own this item.' : 'This account owns this item.') : `Quantity on network: ${result.units}`}
    </Text>}
    <Button title={result.kind === 'loading' ? 'Checking ownership…' : 'Check ownership'} disabled={!id.trim() || result.kind === 'loading'} onPress={() => void read()} />
    {result.kind === 'loading' && <ActivityIndicator color={colors.pink} accessibilityLabel="Checking ownership" />}
  </View>;
}

const s = StyleSheet.create({
  section: { gap: 16 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  title: { fontSize: 21, lineHeight: 29, fontWeight: '600' },
  field: { gap: 9 },
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
  tokenRow: { padding: 16, gap: 9 },
  collectibleLink: { minHeight: 44, justifyContent: 'center' },
  tokenName: { gap: 3, flex: 1 },
  contract: { fontSize: 13, lineHeight: 22 },
  rowContract: { fontSize: 11, lineHeight: 18, color: colors.muted },
  balance: { fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  provenance: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  error: { color: colors.red, fontSize: 14, lineHeight: 22 },
});
