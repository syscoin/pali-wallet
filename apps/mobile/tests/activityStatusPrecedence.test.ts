import assert from 'node:assert/strict';
import test from 'node:test';
import { screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { formatTokenUnits } from '../../../source/shared/erc20.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { activityRowDirection } from '../src/activity/activityFiltering.ts';

for (const [indexed, outcome] of [
  ['confirmed', 'reverted'],
  ['failed', 'confirmed'],
] as const)
  test(`current retained ${outcome} status overrides indexed ${indexed}`, () => {
    const screen = screenFixture(
      new URL('../src/screens/NativeActivity.tsx', import.meta.url),
      'nativeActivityRowPresentation',
      {
        '../ui/WalletBackHandler': { WalletBackHandler: {} },
        '../platform/localization': nativeTranslationFixture,
        '../platform/balancePrivacy': {
          HIDDEN_BALANCE: 'hidden',
          useBalancePrivacy() {},
        },
        'react-native': {
          StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 },
        },
        'react-native-safe-area-context': { SafeAreaView: 'View' },
        '../core/amounts': { formatBaseUnits },
        '../../../../source/shared/erc20': { formatTokenUnits },
        '../activity/activityAmountLabel': { compactActivityAmountLabel },
        './ActivityListRow': {
          activityDate: () => ({ label: 'Today', time: '' }),
        },
        '../activity/activityFiltering': { activityRowDirection },
        './TransactionDetailLayout': {},
        'expo-clipboard': {},
        '../activity/assetIcon': {},
        '../ui': { colors: {} },
      }
    );
    try {
      const row = {
        hash: '0x' + 'ab'.repeat(32),
        indexed: { from: '0x' + '11'.repeat(20), to: '0x' + '22'.repeat(20) },
        indexedStatus: indexed,
        retainedObservation: {
          status: 'mined',
          outcome,
          block: { hash: '0x' + 'cd'.repeat(32), number: '80' },
        },
        checking: false,
        unavailable: false,
      };
      const result = screen.render(row, {
        accountAddress: '0x' + '11'.repeat(20),
        nativeSymbol: 'ETH',
        networkName: 'Ethereum',
        hideBalances: false,
      }) as unknown as { status: string };
      assert.equal(
        result.status,
        outcome === 'confirmed'
          ? nativeTranslationFixture.nativeI18n.t('send.confirmed')
          : nativeTranslationFixture.nativeI18n.t('send.reverted')
      );
    } finally {
      screen.close();
    }
  });
