import React, { useCallback, useLayoutEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeSentryKeyManagement } from '../custody/sentryKeyManagement';
import type { NativeSentryNodeManagement } from '../custody/sentryNodeManagement';
import type { NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { Card, colors, Header, Row, Screen } from '../ui';
import { NativeSentryKeys } from './NativeSentryKeys';
import { NativeSentryNodes } from './NativeSentryNodes';

type Props = {
  networkLabel: string;
  openKeys(
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<NativeSentryKeyManagement>;
  openNodes(
    signal: AbortSignal,
    assertCurrent: () => void,
    authentication: NativePrivateAuthenticationScope
  ): Promise<NativeSentryNodeManagement>;
  onBack(): void;
};

export function NativeSentryHub({
  networkLabel,
  openKeys,
  openNodes,
  onBack,
}: Props) {
  const [pane, setPane] = useState<'keys' | 'nodes' | null>(null);
  const closePane = useCallback(() => setPane(null), []);
  useLayoutEffect(() => {
    if (pane) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => listener.remove();
  }, [pane, onBack]);
  if (pane === 'keys')
    return (
      <NativeSentryKeys
        networkLabel={networkLabel}
        open={openKeys}
        onBack={closePane}
      />
    );
  if (pane === 'nodes')
    return (
      <NativeSentryNodes
        networkLabel={networkLabel}
        open={openNodes}
        onBack={closePane}
      />
    );
  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <Screen>
        <Header title="Sentry" subtitle={networkLabel} onBack={onBack} />
        <Card>
          <Row
            title="Linked nodes"
            subtitle="Manage nodes and protect their collateral"
            icon="shield"
            onPress={() => setPane('nodes')}
          />
          <Row
            title="Authority keys"
            subtitle="Manage keys and service settings"
            icon="lock"
            onPress={() => setPane('keys')}
            last
          />
        </Card>
      </Screen>
    </SafeAreaView>
  );
}
