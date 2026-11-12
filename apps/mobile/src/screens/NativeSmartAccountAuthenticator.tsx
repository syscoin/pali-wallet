import { nativeI18n, useNativeTranslation } from '../platform/localization';
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
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';
const t = nativeI18n.t.bind(nativeI18n);

type Props = {
  ledgerConnection?: NativeLedgerConnectionView;
  open(
    signal: AbortSignal,
    assertCurrent: () => void,
    authentication: NativePrivateAuthenticationScope
  ): Promise<NativeSmartAccountOperation>;
  onBack(): void;
};
type Owner = {
  source: Props['open'];
  live: boolean;
  returning: boolean;
  abort: AbortController;
  authentication: NativePrivateAuthenticationScope;
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
  useNativeTranslation();
  const owner = useRef<Owner | undefined>(undefined);
  const callbacks = useRef({ onBack });
  const [opened, setOpened] = useState<{
    source: Props['open'];
    controller?: NativeSmartAccountOperation;
    authentication?: NativePrivateAuthenticationScope;
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
    current.authentication.retire();
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
      authentication: createNativePrivateAuthenticationScope(),
    };
    owner.current = current;
    const check = () => {
      if (
        owner.current !== current ||
        !current.live ||
        current.abort.signal.aborted ||
        (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication, AppState.currentState))
      )
        throw new Error('CANCELLED');
    };
    current.opening = Promise.resolve()
      .then(() => {
        check();
        return open(current.abort.signal, check, current.authentication);
      })
      .then(
        (controller) => {
          current.controller = controller;
          if (current.live) {
            try {
              check();
              setOpened({ source: open, controller, authentication: current.authentication });
            } catch {
              current.live = false;
              current.authentication.retire();
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
      if (state !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication, state)) back();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => { if (!allowsPrivateAuthenticationInterruption(current.authentication, 'blur')) back(); })
        : undefined;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => {
      current.live = false;
      current.authentication.retire();
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
        authentication={current.authentication}
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
            title={t("buttons.close")}
            variant="secondary" size="compact"
            disabled={current?.closing}
            onPress={back}
          />
        }
      >
        <Header title={t("mobile.smartSendViews.usePaliWallet")} onBack={back} />
        {current?.closing ? (
          <Text>{t("mobile.smartSendViews.closingAuthenticatorReview")}</Text>
        ) : current?.failed ? (
          <Notice
            title={t("mobile.smartSendViews.authenticatorUnavailable")}
            body={t("mobile.smartSendViews.returnToYourAccountAndTryAgain")}
          />
        ) : (
          <ActivityIndicator
            accessibilityLabel={t("mobile.smartSendViews.openingAuthenticatorReview")}
            color={colors.pink}
          />
        )}
      </Screen>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg } });
