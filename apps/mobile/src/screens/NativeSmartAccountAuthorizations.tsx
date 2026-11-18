import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SmartAccountAuthorizationSummary } from '../../../../source/wallet/smartAccountAuthorization';
import type { SmartAccountAuthorizationObservation } from '../../../../source/utils/smartAccount/authorizationStatus';
import { useNativeTranslation } from '../platform/localization';
import {
  Button,
  Card,
  colors,
  Header,
  IconButton,
  Notice,
  styles,
  Text,
} from '../ui';
import { WalletBackHandler as BackHandler } from '../ui/WalletBackHandler';

export type NativeSmartAuthorizationSource = Readonly<{
  list(
    options: Readonly<{ maximum: number; beforeHash?: string }>,
    signal: AbortSignal,
    guard: () => void
  ): Promise<
    Readonly<{
      entries: readonly SmartAccountAuthorizationSummary[];
      nextCursor: string | null;
    }>
  >;
  status(
    hash: string,
    signal: AbortSignal,
    guard: () => void
  ): Promise<SmartAccountAuthorizationObservation>;
}>;

/** Signed instructions have no transaction hash until an outer transaction exists. */
export function NativeSmartAccountAuthorizations({
  source,
  accountLabel,
  onBack,
  onCancel,
  onViewTransaction,
}: {
  source: NativeSmartAuthorizationSource;
  accountLabel: string;
  onBack(): void;
  onCancel?(operationHash: string): void;
  onViewTransaction?(transactionHash: string): void;
}) {
  const { t } = useNativeTranslation();
  const [rows, setRows] = useState<readonly SmartAccountAuthorizationSummary[]>(
    []
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<
    Record<string, SmartAccountAuthorizationObservation | 'unavailable'>
  >({});
  const owner = useRef({
    live: true,
    generation: 0,
    busy: false,
    reads: new Set<AbortController>(),
  });
  const list = source.list,
    status = source.status;
  const lastListRequest = useRef<string | undefined>(undefined);
  const retire = useCallback(() => {
    const current = owner.current;
    current.generation++;
    current.busy = false;
    for (const abort of current.reads) abort.abort();
    current.reads.clear();
  }, []);
  const close = useCallback(() => {
    owner.current.live = false;
    retire();
    onBack();
  }, [onBack, retire]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => listener.remove();
  }, [close]);
  const begin = useCallback(() => {
    const current = owner.current;
    if (!current.live || current.busy || AppState.currentState !== 'active')
      return null;
    current.busy = true;
    const generation = current.generation,
      abort = new AbortController();
    current.reads.add(abort);
    const guard = () => {
      if (
        !current.live ||
        current.generation !== generation ||
        abort.signal.aborted ||
        AppState.currentState !== 'active'
      )
        throw Error('CANCELLED');
    };
    return {
      abort,
      guard,
      finish() {
        current.reads.delete(abort);
        abort.abort();
        if (current.generation === generation) current.busy = false;
      },
    };
  }, []);
  const load = useCallback(
    async (beforeHash?: string) => {
      const task = begin();
      if (!task) return;
      lastListRequest.current = beforeHash;
      setLoading(true);
      setError(false);
      try {
        const page = await list(
          { maximum: 20, ...(beforeHash ? { beforeHash } : {}) },
          task.abort.signal,
          task.guard
        );
        task.guard();
        setRows((previous) =>
          beforeHash
            ? [
                ...previous,
                ...page.entries.filter(
                  (row) =>
                    !previous.some(
                      (saved) => saved.operationHash === row.operationHash
                    )
                ),
              ]
            : page.entries
        );
        setCursor(page.nextCursor);
      } catch {
        try {
          task.guard();
          setError(true);
        } catch {
          /* Retired views publish nothing. */
        }
      } finally {
        try {
          task.guard();
          setLoading(false);
        } catch {
          /* Retired. */
        }
        task.finish();
      }
    },
    [list, begin]
  );
  useLayoutEffect(() => {
    const current = owner.current;
    current.live = true;
    const generation = current.generation;
    queueMicrotask(() => {
      if (current.live && current.generation === generation) {
        setStatuses({});
        setChecking(null);
        void load();
      }
    });
    const listener = AppState.addEventListener('change', (next) => {
      if (next !== 'active') retire();
      else {
        const nextGeneration = current.generation;
        queueMicrotask(() => {
          if (current.live && current.generation === nextGeneration) {
            setStatuses({});
            setChecking(null);
            void load();
          }
        });
      }
    });
    return () => {
      current.live = false;
      retire();
      listener.remove();
    };
  }, [load, retire, status]);
  const check = async (hash: string) => {
    const task = begin();
    if (!task) return;
    setChecking(hash);
    try {
      const observed = await status(hash, task.abort.signal, task.guard);
      task.guard();
      setStatuses((previous) => ({ ...previous, [hash]: observed }));
    } catch {
      try {
        task.guard();
        setStatuses((previous) => ({ ...previous, [hash]: 'unavailable' }));
      } catch {
        /* Retired. */
      }
    } finally {
      try {
        task.guard();
        setChecking(null);
      } catch {
        /* Retired. */
      }
      task.finish();
    }
  };
  const caption = (
    observed: SmartAccountAuthorizationObservation | 'unavailable' | undefined
  ) =>
    observed === 'unavailable'
      ? 'transactions.smartAuthorizations.unavailable'
      : observed?.kind === 'nonce-consumed'
      ? 'transactions.smartAuthorizations.nonceConsumedUnknown'
      : observed?.kind === 'observed'
      ? observed.success
        ? 'transactions.smartAuthorizations.observedSuccess'
        : 'transactions.smartAuthorizations.observedFailure'
      : 'transactions.smartAuthorizations.mayExecute';
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Header
          title={t('transactions.smartAuthorizations.title')}
          subtitle={accountLabel}
          onBack={close}
          right={
            <IconButton
              label={t('mobile.infrastructure.refresh')}
              icon="refresh"
              disabled={loading || !!checking}
              onPress={() => void load()}
            />
          }
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.operationHash}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          <>
            {loading && (
              <ActivityIndicator
                accessibilityLabel={t('buttons.loading')}
                color={colors.pink}
              />
            )}
            {error && (
              <Notice
                title={t('transactions.smartAuthorizations.unavailable')}
                tone="amber"
              />
            )}
          </>
        }
        renderItem={({ item }) => {
          const observed = statuses[item.operationHash];
          const consumed =
            observed &&
            observed !== 'unavailable' &&
            observed.kind !== 'pending';
          return (
            <Card style={s.card}>
              <Text style={styles.muted}>
                {t('transactions.smartAuthorizations.operationHash')}
              </Text>
              <Text selectable style={s.identity}>
                {item.operationHash}
              </Text>
              <Text style={styles.muted}>
                {t('send.chainId')} {item.chainId}
              </Text>
              <Text style={styles.muted}>{t('transactions.replay.nonce')}</Text>
              <Text selectable style={s.identity}>
                {item.operationNonce}
              </Text>
              <Text style={styles.muted}>{t('transactions.feePayer')}</Text>
              <Text selectable style={s.identity}>
                {item.payer}
              </Text>
              <Text accessibilityLiveRegion="polite">
                {t(caption(observed))}
              </Text>
              {observed &&
                observed !== 'unavailable' &&
                observed.kind === 'observed' && (
                  <>
                    <Text selectable style={s.identity}>
                      {observed.transactionHash}
                    </Text>
                    {onViewTransaction && (
                      <Button
                        title={t('mobile.sendAssetViews.evm.viewTransaction')}
                        variant="secondary"
                        disabled={loading || !!checking}
                        onPress={() => {
                          if (
                            owner.current.live &&
                            !owner.current.busy &&
                            AppState.currentState === 'active'
                          ) {
                            owner.current.live = false;
                            retire();
                            onViewTransaction(observed.transactionHash);
                          }
                        }}
                      />
                    )}
                  </>
                )}
              <Button
                icon="refresh"
                title={t('transactions.smartAuthorizations.checkStatus')}
                variant="secondary"
                disabled={loading || !!checking}
                onPress={() => void check(item.operationHash)}
              />
              {onCancel && !consumed && (
                <Button
                  icon="close"
                  title={t(
                    'transactions.smartAuthorizations.cancelInstruction'
                  )}
                  variant="secondary"
                  disabled={loading || !!checking}
                  onPress={() => {
                    if (
                      owner.current.live &&
                      !owner.current.busy &&
                      AppState.currentState === 'active'
                    ) {
                      owner.current.live = false;
                      retire();
                      onCancel(item.operationHash);
                    }
                  }}
                />
              )}
            </Card>
          );
        }}
        ListEmptyComponent={
          !loading && !error ? (
            <Notice title={t('transactions.smartAuthorizations.empty')} />
          ) : undefined
        }
        ListFooterComponent={
          error ? (
            <Button
              title={t('privacy.retry')}
              variant="secondary"
              disabled={loading || !!checking}
              onPress={() => void load(lastListRequest.current)}
            />
          ) : cursor ? (
            <Button
              title={t('buttons.loadMore')}
              variant="secondary"
              disabled={loading || !!checking}
              onPress={() => void load(cursor)}
            />
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20 },
  content: { padding: 20, paddingBottom: 32, gap: 12 },
  card: { gap: 10, padding: 16 },
  identity: { fontSize: 13, flexShrink: 1 },
});
