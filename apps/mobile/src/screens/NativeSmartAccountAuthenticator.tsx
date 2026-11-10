import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
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
  BackHandler,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeSmartAccountOperation } from '../smartAccount/operation';
import { Button, colors, Header, Notice, Screen, Text } from '../ui';
import { NativeSmartAccountOperationScreen } from './NativeSmartAccountOperation';

type Props = {
  ledgerConnection?: NativeLedgerConnectionView;
  open(
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<NativeSmartAccountOperation>;
  onBack(): void;
};
type Owner = {
  source: Props['open'];
  live: boolean;
  returning: boolean;
  abort: AbortController;
  controller?: NativeSmartAccountOperation;
  opening?: Promise<void>;
  disposing?: Promise<void>;
};

function disposeOwner(owner: Owner): Promise<void> {
  owner.disposing ??= Promise.resolve(owner.opening).then(() =>
    owner.controller?.dispose()
  );
  return owner.disposing;
}

export function NativeSmartAccountAuthenticator({ open, onBack, ledgerConnection }: Props) {
  const owner = useRef<Owner | undefined>(undefined);
  const callbacks = useRef({ onBack });
  const [opened, setOpened] = useState<{
    source: Props['open'];
    controller?: NativeSmartAccountOperation;
    failed?: true;
    closing?: true;
  }>();
  useLayoutEffect(() => {
    callbacks.current = { onBack };
  }, [onBack]);
  const back = useCallback(() => {
    const current = owner.current;
    if (!current?.live) return;
    current.live = false;
    current.returning = true;
    current.abort.abort();
    const onBack = callbacks.current.onBack;
    setOpened({ source: current.source, closing: true });
    void disposeOwner(current)
      .catch(() => undefined)
      .then(() => {
        if (owner.current === current && current.returning) onBack();
      });
  }, []);
  useEffect(() => {
    const current: Owner = {
      source: open,
      live: true,
      returning: false,
      abort: new AbortController(),
    };
    owner.current = current;
    const check = () => {
      if (
        owner.current !== current ||
        !current.live ||
        current.abort.signal.aborted ||
        AppState.currentState !== 'active'
      )
        throw new Error('CANCELLED');
    };
    current.opening = Promise.resolve()
      .then(() => {
        check();
        return open(current.abort.signal, check);
      })
      .then(
        (controller) => {
          current.controller = controller;
          if (current.live) {
            try {
              check();
              setOpened({ source: open, controller });
            } catch {
              current.live = false;
              current.abort.abort();
              void disposeOwner(current).catch(() => undefined);
            }
          }
        },
        () => {
          if (current.live) setOpened({ source: open, failed: true });
        }
      );
    const change = AppState.addEventListener('change', (state) => {
      if (state !== 'active') back();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', back)
        : undefined;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => {
      current.live = false;
      current.returning = false;
      current.abort.abort();
      void disposeOwner(current).catch(() => undefined);
      change.remove();
      blur?.remove();
      hardware.remove();
    };
  }, [back, open]);
  const current = opened?.source === open ? opened : undefined;
  if (current?.controller)
    return (
      <NativeSmartAccountOperationScreen
        controller={current.controller}
        ledgerConnection={ledgerConnection}
        onBack={back}
      />
    );
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <Screen
        footer={
          <Button
            title="Close"
            variant="quiet"
            disabled={current?.closing}
            onPress={back}
          />
        }
      >
        <Header title="Use Pali wallet" onBack={back} />
        {current?.closing ? (
          <Text>Closing authenticator review…</Text>
        ) : current?.failed ? (
          <Notice
            title="Authenticator unavailable"
            body="Return to your account and try again."
          />
        ) : (
          <ActivityIndicator
            accessibilityLabel="Opening authenticator review"
            color={colors.pink}
          />
        )}
      </Screen>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg } });
