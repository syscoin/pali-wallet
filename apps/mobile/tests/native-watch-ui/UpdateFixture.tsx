import React from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WalletUpdatePanel } from '../../src/screens/WalletUpdatePanel';
import type { MobileUpdateService, MobileUpdateSnapshot } from '../../src/updates/types';
import { Button, colors, Header, Screen } from '../../src/ui';

const failed = new URLSearchParams(window.location.search).get('update-state') === 'error';
const snapshot: MobileUpdateSnapshot = {
  status: failed ? 'error' : 'ready', error: failed ? 'unavailable' : null,
  lastCheckedAt: 1, lastAttemptAt: 1, alertsEnabled: true, permission: 'granted',
  release: { platform: 'android', version: '5.0.1', build: 2, severity: 'important',
    title: 'Improved transaction recovery', summary: 'Recover interrupted transfers more reliably. This release also improves wallet accessibility.',
    publishedAt: '2026-01-01T00:00:00Z', releaseNotesUrl: 'https://github.com/syscoin/pali-wallet/releases/tag/v5.0.1', availability: { status: 'published' } },
};
const service: MobileUpdateService = {
  getSnapshot: () => snapshot, subscribe: () => () => {}, check: async () => {}, setAlerts: async () => {},
};
/** Public synthetic release; renders the shipped update panel, never downloads code. */
export function UpdateFixture() {
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><Screen footer={<Button title="Done" variant="secondary" onPress={() => {}} />}>
    <Header title="Update Pali" /><WalletUpdatePanel service={service} onLock={() => {}} />
  </Screen></SafeAreaView></SafeAreaProvider>;
}
