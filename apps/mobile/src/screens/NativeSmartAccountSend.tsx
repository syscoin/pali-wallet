import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { normalizeNftTokenId } from '../../../../source/utils/nftTokenId';
import type { SavedCollectible } from '../portfolio/tokenRegistry';
import {
  parseErc20Units,
  type Erc20Metadata,
} from '../../../../source/shared/erc20';
import type { NativeTokenView } from '../portfolio/nativeTokens';
import type { NativeRecipientResolution, NativeRecipientResolver } from '../portfolio/nativeRecipientResolver';
import {
  NativePortfolioController,
  sameNativePortfolioAccount,
  type NativePortfolioAccount,
  type PublicCustodySource,
} from '../portfolio/nativePortfolio';
import type { BalanceReader } from '../core/watchOnlyAuthority';
import { formatBaseUnits } from '../core/amounts';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  NativeSmartAccountAmount,
  NativeSmartAccountOperation,
} from '../smartAccount/operation';
import type { NativeSendContext } from '../custody/networkContext';
import { NativeSendInput, nativeTransferFailure } from './NativeSend';
import { NativeTokenMaximum, nativeTokenAvailableAmount } from './NativeTokenMaximum';
import { RecipientQrScanner } from './RecipientQrScanner';
import { SendNetworkCard } from './SendNetworkCard';
import { SendAssetSelector, type SendAssetItem } from './SendAssetSelector';
import type { NativeUnsignedSendDraft } from './sendNetworkDraft';
import { NativeSmartAccountOperationScreen } from './NativeSmartAccountOperation';
import { Button, Card, Coin, colors, Header, IconButton, Notice, Screen, styles, Text } from '../ui';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

const emptySubscribe = () => () => undefined;
const emptyInventory = () => null;
type SendOwner = {
  active: boolean;
  returning: boolean;
  operation: NativeSmartAccountOperation | null;
  busy: boolean;
  authentication: NativePrivateAuthenticationScope | null;
  opening?: Promise<void>;
  disposing?: Promise<void>;
};
type ScanDraft = Readonly<{
  open: unknown; account: NativePortfolioAccount; context: NativeSendContext;
  recipientResolver: NativeRecipientResolver | undefined; recipient: string; amount: string;
  tokenId: string; maximum: boolean; token: Erc20Metadata | undefined; collectible: SavedCollectible | undefined;
}>;
type ScannerOwner = Readonly<{ owner: SendOwner; scope: ScanDraft; account: NativePortfolioAccount; registrationHash: string }>;
function sameScanDraft(left: ScanDraft, right: ScanDraft): boolean {
  return left.open === right.open && left.account.address === right.account.address &&
    left.account.network === right.account.network && left.account.revision === right.account.revision &&
    left.context.registrationHash === right.context.registrationHash && left.recipientResolver === right.recipientResolver &&
    left.recipient === right.recipient && left.amount === right.amount && left.tokenId === right.tokenId &&
    left.maximum === right.maximum && left.token === right.token && left.collectible === right.collectible;
}
function disposeSend(owner: SendOwner): Promise<void> {
  owner.disposing ??= Promise.resolve(owner.opening)
    .catch(() => undefined)
    .then(() => owner.operation?.dispose());
  return owner.disposing;
}

export function NativeSmartAccountSend({
  open,
  context,
  accountLabel,
  source,
  reader,
  account,
  token,
  tokenView,
  collectible,
  onBack,
  recipientResolver,
  ledgerConnection,
  assetChoices,
  onChangeAsset,
  initialRecipient,
  availableNative,
}: {
  ledgerConnection?: NativeLedgerConnectionView;
  open(
    recipient: string,
    amount: NativeSmartAccountAmount,
    assertCurrent: () => void,
    authentication: NativePrivateAuthenticationScope
  ): Promise<NativeSmartAccountOperation>;
  context: NativeSendContext;
  accountLabel: string;
  source: PublicCustodySource;
  reader: BalanceReader;
  account: NativePortfolioAccount;
  token?: Erc20Metadata;
  collectible?: SavedCollectible;
  tokenView?: Pick<NativeTokenView, 'subscribe' | 'getSnapshot' | 'connect'>;
  onBack(): void;
  recipientResolver?: NativeRecipientResolver;
  assetChoices?: readonly SendAssetItem[];
  onChangeAsset?(draft: Extract<NativeUnsignedSendDraft, { kind: 'evm' }>, token?: Erc20Metadata): void;
  initialRecipient?: string;
  availableNative?: string;
}) {
  const portfolio = useMemo(
    () => new NativePortfolioController(source, reader),
    [source, reader]
  );
  const balance = useSyncExternalStore(
    portfolio.subscribe,
    portfolio.getSnapshot,
    portfolio.getSnapshot
  );
  const inventory = useSyncExternalStore(
    tokenView?.subscribe ?? emptySubscribe,
    tokenView?.getSnapshot ?? emptyInventory,
    tokenView?.getSnapshot ?? emptyInventory
  );
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  useLayoutEffect(
    () =>
      collectible
        ? undefined
        : token
        ? tokenView?.connect()
        : portfolio.connect(),
    [portfolio, token, tokenView, collectible]
  );
  useLayoutEffect(() => !token && !collectible && assetPickerOpen && !assetChoices ? tokenView?.connect() : undefined,
    [token, collectible, assetPickerOpen, assetChoices, tokenView]);
  const selectedToken =
    token &&
    inventory?.items.find(
      (item) => item.metadata.contractAddress === token.contractAddress
    );
  const symbol = token?.symbol ?? context.symbol;
  const displayedBalance = token
    ? nativeTokenAvailableAmount(token, account, inventory)
    : balance.status === 'available' && balance.units !== null && sameNativePortfolioAccount(balance.account, account)
    ? formatBaseUnits(balance.units, context.decimals)
    : null;
  const loadingBalance = token
    ? selectedToken?.status === 'loading'
    : balance.status === 'loading';
  const [recipient, setRecipient] = useState(initialRecipient ?? '');
  const [amount, setAmount] = useState(
    collectible?.tokenStandard === 'ERC-721' ? '1' : ''
  );
  const [tokenId, setTokenId] = useState(
    collectible?.tokenStandard === 'ERC-1155' ? collectible.tokenId : ''
  );
  const [maximum, setMaximum] = useState(false);
  const [tokenDetails, setTokenDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [controller, setController] =
    useState<NativeSmartAccountOperation | null>(null);
  const [operationAuthentication, setOperationAuthentication] = useState<NativePrivateAuthenticationScope>();
  const [closing, setClosing] = useState(false);
  const [resolvedRecipient, setResolvedRecipient] = useState<NativeRecipientResolution | null>(null);
  const [scanner, setScanner] = useState<ScannerOwner | null>(null);
  const scannerOwner = useRef<ScannerOwner | null>(null);
  const closeScanner = useCallback(() => { scannerOwner.current = null; setScanner(null); }, []);
  const recipientRequest = useRef<{
    abort: AbortController;
    ticket?: NativeRecipientResolution;
    reviewReleased: boolean;
    unsubscribe?: () => void;
  } | null>(null);
  const latestOwner = useRef({ open, account, context, recipientResolver, recipient, amount, tokenId, maximum, token, collectible });
  useLayoutEffect(() => {
    latestOwner.current = { open, account, context, recipientResolver, recipient, amount, tokenId, maximum, token, collectible };
  }, [open, account, context, recipientResolver, recipient, amount, tokenId, maximum, token, collectible]);
  useLayoutEffect(() => () => closeScanner(), [closeScanner, open, account.address, account.network, account.revision, context.registrationHash, token, collectible]);
  const retireRecipient = useCallback(() => {
    const held = recipientRequest.current;
    recipientRequest.current = null;
    held?.unsubscribe?.();
    held?.abort.abort();
    held?.ticket?.dispose();
    setResolvedRecipient(null);
  }, []);
  const editRecipient = (value: string) => {
    closeScanner();
    retireRecipient();
    setRecipient(value);
  };
  useLayoutEffect(() => () => retireRecipient(), [retireRecipient, open, account.address,
    account.network, account.revision, context.registrationHash, recipientResolver]);
  const callbacks = useRef({ onBack });
  useLayoutEffect(() => {
    callbacks.current = { onBack };
  }, [onBack]);
  const owner = useRef<SendOwner>({
    active: false,
    returning: false,
    operation: null as NativeSmartAccountOperation | null,
    busy: false,
    authentication: null,
  });
  const back = useCallback(() => {
    const current = owner.current;
    if (!current.active) return;
    current.active = false;
    current.authentication?.retire();
    current.returning = true;
    closeScanner();
    retireRecipient();
    const close = callbacks.current.onBack;
    setClosing(true);
    void disposeSend(current)
      .catch(() => undefined)
      .then(() => {
        if (owner.current === current && current.returning) close();
      });
  }, [retireRecipient, closeScanner]);
  useEffect(() => {
    const current: SendOwner = {
      active: true,
      returning: false,
      operation: null,
      busy: false,
      authentication: createNativePrivateAuthenticationScope(),
    };
    owner.current = current;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    const background = AppState.addEventListener('change', state => { if (state !== 'active' && !(current.authentication && allowsPrivateAuthenticationInterruption(current.authentication, state))) back(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => { if (!(current.authentication && allowsPrivateAuthenticationInterruption(current.authentication, 'blur'))) back(); }) : undefined;
    return () => {
      current.active = false;
      current.authentication?.retire();
      current.returning = false;
      closeScanner();
      retireRecipient();
      void disposeSend(current).catch(() => undefined);
      hardware.remove();
      background.remove(); blur?.remove();
    };
  }, [back, retireRecipient, closeScanner, open, account.address, account.network, account.revision, context.registrationHash, token, collectible]);
  const review = async () => {
    const current = owner.current;
    if (!current.active || current.busy || !current.authentication || AppState.currentState !== 'active') return;
    current.busy = true;
    closeScanner();
    setBusy(true);
    setError('');
    const held = {
      abort: new AbortController(),
      ticket: undefined as NativeRecipientResolution | undefined,
      reviewReleased: false,
      unsubscribe: undefined as (() => void) | undefined,
    };
    recipientRequest.current = held;
    const captured = latestOwner.current;
    const checkOwner = () => {
      const actual = latestOwner.current;
      if (!current.active || owner.current !== current || recipientRequest.current !== held || held.abort.signal.aborted ||
          (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication!, AppState.currentState)) ||
          actual.open !== captured.open || actual.recipient !== captured.recipient || actual.recipientResolver !== captured.recipientResolver ||
          actual.account.address !== captured.account.address || actual.account.network !== captured.account.network ||
          actual.account.revision !== captured.account.revision || actual.context.registrationHash !== captured.context.registrationHash)
        throw new Error('RECIPIENT_EXPIRED');
    };
    const check = () => {
      checkOwner();
      if (!held.reviewReleased) held.ticket?.assertCurrent();
    };
    try {
      let nftRequest: NativeSmartAccountAmount | undefined;
      if (collectible) {
        let id: string, quantity: string;
        try {
          id = normalizeNftTokenId(tokenId.trim());
        } catch {
          setError('Enter a valid token ID.');
          return;
        }
        try {
          quantity =
            collectible.tokenStandard === 'ERC-721'
              ? '1'
              : parseErc20Units(amount.trim());
          if (quantity === '0') throw new Error('Empty quantity');
        } catch {
          setError('Enter a whole quantity greater than zero.');
          return;
        }
        nftRequest = {
          kind: 'nft',
          collectible,
          tokenId: id,
          amountUnits: quantity,
        };
      }
      let address = recipient.trim();
      if (address.toLowerCase().endsWith('.eth')) {
        if (!recipientResolver) throw new Error('ENS_UNAVAILABLE');
        held.ticket = await recipientResolver.resolve(address, { account, context }, held.abort.signal, checkOwner);
        check();
        const ticket = held.ticket;
        address = ticket.address;
        setResolvedRecipient(ticket);
        ticket.signal.addEventListener('abort', () => {
          if (recipientRequest.current !== held || !current.active || held.reviewReleased) return;
          retireRecipient();
          void Promise.resolve(current.operation?.dispose()).catch(() => undefined);
          setController(null);
          setResolvedRecipient(null);
          setError('The recipient lookup expired or changed. Review the transfer again.');
        }, { once: true });
      }
      check();
      current.opening = open(
        address,
        nftRequest ??
          (token
            ? { kind: 'erc20', contractAddress: token.contractAddress, amount }
            : maximum
            ? { kind: 'maximum' }
            : { kind: 'exact', amount }),
        check,
        current.authentication
      ).then(async (operation) => {
        current.operation = operation;
        try {
          check();
          if (held.ticket) {
            const releaseRecipientReview = () => {
              const snapshot = operation.getSnapshot();
              if (
                held.reviewReleased || current.operation !== operation ||
                !snapshot.userOperationSubmissionStarted || snapshot.phase === 'failed'
              ) return;
              try {
                checkOwner();
              } catch {
                return;
              }
              // This marker comes from admitted handleOps dispatch, before its
              // transport. Funding and generic waiting phases cannot release ENS.
              held.reviewReleased = true;
              held.unsubscribe?.();
              held.unsubscribe = undefined;
              held.ticket?.dispose();
            };
            held.unsubscribe = operation.subscribe(releaseRecipientReview);
            releaseRecipientReview();
          }
          setOperationAuthentication(current.authentication!);
          setController(operation);
        } catch (error) {
          await operation.dispose();
          if (current.operation === operation) current.operation = null;
          throw error;
        }
      });
      await current.opening;
    } catch (error) {
      const owned = recipientRequest.current === held;
      if (owned) retireRecipient();
      else held.ticket?.dispose();
      if (owned && current.active)
        setError(
          nativeTransferFailure(
            error,
            context,
            collectible ? 'collectible' : token ? 'token' : 'coin',
            false,
            false
          )
        );
    } finally {
      if (!recipientRequest.current || recipientRequest.current === held) {
        current.busy = false;
        if (current.active) setBusy(false);
      }
    }
  };
  const maximumControl = collectible ? undefined : token ? (
    <NativeTokenMaximum owner={account} token={token} snapshot={inventory} view={tokenView}
      selected={maximum} disabled={busy} onSelect={value => {
        if (!owner.current.active || owner.current.busy) return;
        closeScanner(); setMaximum(true); setAmount(value);
      }} />
  ) : (
    <Button title={maximum ? 'MAX selected' : 'MAX'} variant="secondary" size="compact"
      disabled={busy || displayedBalance === null || !balance.units || BigInt(balance.units) <= BigInt(0)}
      onPress={() => {
        if (!owner.current.active || owner.current.busy || displayedBalance === null || !balance.units || portfolio.getSnapshot() !== balance) return;
        closeScanner(); setMaximum(true); setAmount(formatBaseUnits(balance.units, context.decimals));
      }} />
  );
  if (closing)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Screen>
          <Text>Closing transfer review…</Text>
        </Screen>
      </SafeAreaView>
    );
  if (controller && !resolvedRecipient)
    return <NativeSmartAccountOperationScreen authentication={operationAuthentication} ledgerConnection={ledgerConnection} controller={controller} onBack={back} />;
  if (controller)
    return (
      <>
        {resolvedRecipient && <SafeAreaView edges={['top']} style={{ backgroundColor: colors.bg, paddingHorizontal: 24 }}>
          <Text selectable style={styles.muted}>ENS name: {resolvedRecipient.input}</Text>
          <Text selectable style={styles.muted}>Resolved address: {resolvedRecipient.address}</Text>
        </SafeAreaView>}
        <NativeSmartAccountOperationScreen authentication={operationAuthentication} ledgerConnection={ledgerConnection} controller={controller} onBack={back} />
      </>
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen footer={
          <Button
            title="Review transfer"
            disabled={
              busy || !recipient || !amount || (!!collectible && !tokenId)
            }
            onPress={() => void review()}
          />
        } gap={16}>
          <Header title={collectible ? 'Send collectible' : `Send ${symbol}`}
            subtitle={`${accountLabel} · ${context.name}${context.testnet ? ' · Test network' : ''}`} onBack={back} />
          {onChangeAsset && !collectible ? <SendAssetSelector context={context} token={token} nativeAvailable={availableNative}
            items={inventory?.status === 'ready' && sameNativePortfolioAccount(inventory.account, account) ? inventory.items : assetChoices ?? []}
            loading={assetPickerOpen && !assetChoices && inventory?.status === 'loading'} unavailable={!assetChoices && inventory?.status === 'error'}
            open={assetPickerOpen} busy={busy} onOpen={() => { if (!busy) { closeScanner(); setAssetPickerOpen(true); } }}
            onClose={() => setAssetPickerOpen(false)} onSelect={next => {
              if (busy) return;
              setAssetPickerOpen(false);
              onChangeAsset({ kind: 'evm', recipient, amount, nonce: '', max: maximum, advanced: false }, next);
            }} /> : <SendNetworkCard context={context} disabled={busy} />}
          {collectible && (
            <Card style={s.asset}>
              <Coin id="collectible" asset={{ kind: 'evm', chainId: context.chainId, contractAddress: collectible.contractAddress }} registrationHash={context.registrationHash} fallbackSymbol="NFT" size={36} />
              <Text style={s.label}>COLLECTIBLE CONTRACT · {collectible.tokenStandard}</Text>
              <Text selectable style={s.address}>{collectible.contractAddress}</Text>
            </Card>
          )}
          {token && (
            <Card style={s.asset}>
              <View style={s.assetRow}>
                <Coin id="custom-token" asset={{ kind: 'evm', chainId: context.chainId, contractAddress: token.contractAddress, decimals: token.decimals }} registrationHash={context.registrationHash} fallbackSymbol={token.symbol} size={32} />
                <View style={s.assetDescription}><Text numberOfLines={1}>{token.name}</Text><Text style={styles.muted}>{token.symbol} · {context.name}</Text></View>
                <Button title="Details" variant="quiet" size="compact" expanded={tokenDetails} disabled={busy} onPress={() => setTokenDetails(value => !value)} />
              </View>
              <Text style={styles.muted}>Custom token · Unverified issuer metadata</Text>
              {tokenDetails && <><Text style={s.label}>TOKEN CONTRACT</Text><Text selectable style={s.address}>{token.contractAddress}</Text>
                <Text style={s.label}>DECIMALS</Text><Text>{token.decimals}</Text></>}
            </Card>
          )}
          <NativeSendInput
            label="Recipient address"
            value={recipient}
            onChange={editRecipient}
            busy={busy}
            max={255}
            placeholder="0x… or name.eth"
            trailing={<IconButton label="Scan recipient address" icon="scan" disabled={busy} onPress={() => {
              if (!owner.current.active || owner.current.busy || controller || AppState.currentState !== 'active') return;
              Keyboard.dismiss();
              const next = { owner: owner.current, scope: latestOwner.current, account, registrationHash: context.registrationHash };
              scannerOwner.current = next; setScanner(next);
            }} />}
          />
          {collectible?.tokenStandard === 'ERC-721' && (
            <NativeSendInput
              label="Token ID"
              value={tokenId}
              onChange={value => { closeScanner(); setTokenId(value); }}
              busy={busy}
              keyboardType="number-pad"
              max={257}
            />
          )}
          {collectible?.tokenStandard === 'ERC-1155' && (
            <Text style={styles.muted}>Token ID {collectible.tokenId}</Text>
          )}
          {collectible?.tokenStandard !== 'ERC-721' && (
            <>
              <NativeSendInput
                label={collectible ? 'Quantity' : `Amount in ${symbol}`}
                value={amount}
                onChange={(value) => {
                  closeScanner();
                  setMaximum(false);
                  setAmount(value);
                }}
                busy={busy}
                keyboardType="decimal-pad"
                max={collectible ? 79 : token ? 334 : 100}
                trailing={maximumControl}
              />
            </>
          )}
          {!collectible && <Text accessibilityLabel="Available balance" style={styles.muted}>Available {displayedBalance ?? '—'} {symbol}</Text>}
          {!collectible && loadingBalance && <Text style={styles.muted}>Loading balance…</Text>}
          {error ? (
            <Notice title="Check transfer" body={error} tone="amber" />
          ) : null}
          {busy ? <ActivityIndicator color={colors.pink} /> : null}

        </Screen>
      </KeyboardAvoidingView>
      {scanner && scanner.account.address === account.address && scanner.account.network === account.network &&
        scanner.account.revision === account.revision && scanner.registrationHash === context.registrationHash &&
        sameScanDraft(scanner.scope, { open, account, context, recipientResolver, recipient, amount, tokenId, maximum, token, collectible }) &&
        <Modal visible animationType="slide" onRequestClose={closeScanner}>
          <RecipientQrScanner onClose={closeScanner} onScan={address => {
            if (!owner.current.active || owner.current !== scanner.owner || owner.current.busy || controller ||
                scannerOwner.current !== scanner || !sameScanDraft(latestOwner.current, scanner.scope) || AppState.currentState !== 'active') return;
            editRecipient(address);
          }} />
        </Modal>}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  asset: { padding: 16, gap: 12 },
  assetRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  assetDescription: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  address: { fontFamily: 'monospace', fontSize: 12, color: colors.text, lineHeight: 20 },
});
