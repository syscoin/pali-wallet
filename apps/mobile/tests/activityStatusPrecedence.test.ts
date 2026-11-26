import assert from 'node:assert/strict';
import test from 'node:test';
import { screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { EVM_TRANSACTION_HISTORY_SOURCE } from '../../../source/shared/evmHistory.ts';
import { formatTokenUnits } from '../../../source/shared/erc20.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { activityRowDirection } from '../src/activity/activityFiltering.ts';
import { activityRowTimestamp } from '../src/activity/nativeActivity.ts';

function presentationFixture() {
  return screenFixture(
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
      '../../../../source/shared/evmHistory': { EVM_TRANSACTION_HISTORY_SOURCE },
      '../../../../source/shared/erc20': { formatTokenUnits },
      '../activity/activityAmountLabel': { compactActivityAmountLabel },
      './ActivityListRow': {
        activityDate: () => ({ label: 'Today', time: '' }),
      },
      '../activity/activityFiltering': { activityRowDirection },
      '../activity/nativeActivity': { activityRowTimestamp },
      './TransactionDetailLayout': {},
      'expo-clipboard': {},
      '../activity/assetIcon': {},
      '../ui': { colors: {} },
    }
  );
}

for (const [indexed, outcome] of [
  ['confirmed', 'reverted'],
  ['failed', 'confirmed'],
] as const)
  test(`current retained ${outcome} status overrides indexed ${indexed}`, () => {
    const screen = presentationFixture();
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

for (const canonical of ['missing', 'reverted', 'confirmed'] as const) {
  test(`canonical Smart ${canonical} supersedes stale detail, indexed and authorization evidence`, () => {
    const screen = presentationFixture();
    try {
      const hash = '0x' + 'ab'.repeat(32);
      const from = '0x' + '11'.repeat(20);
      const oldBlock = { number: '80', hash: '0x' + 'cd'.repeat(32) };
      const result = screen.render({
        hash, checking: false, unavailable: false,
        local: { address: from, recipient: from, amountUnits: '1', nonce: 3, phase: 'confirmed',
          smartAccount: { payer: from, operations: [{ operationHash: hash, operationNonce: '0' }] } },
        indexedStatus: 'confirmed', observation: { status: 'confirmed', block: oldBlock, from, to: from },
        retainedObservation: canonical === 'missing' ? { status: 'missing', latestNonce: '3' }
          : { status: 'mined', outcome: canonical, block: { number: '80', hash: '0x' + 'ee'.repeat(32) } },
        smartAuthorizations: [{ observation: { kind: 'observed', success: canonical !== 'confirmed',
          transactionHash: hash, block: oldBlock } }],
      }, { accountAddress: from, nativeSymbol: 'ETH', networkName: 'Ethereum', hideBalances: false }) as unknown as { status: string };
      const expected = canonical === 'missing' ? 'mobile.activityViews.nativeActivity.submissionUnconfirmed'
        : canonical === 'reverted' ? 'send.reverted' : 'send.confirmed';
      assert.equal(result.status, nativeTranslationFixture.nativeI18n.t(expected));
    } finally { screen.close(); }
  });
}

test('an orphaned Smart placement cannot regain Confirmed from stale retained, local, indexed or linked evidence', () => {
  const screen = presentationFixture();
  try {
    const hash = '0x' + 'ab'.repeat(32), from = '0x' + '11'.repeat(20);
    const block = { number: '80', hash: '0x' + 'cd'.repeat(32) };
    const row = { hash, orphanedPlacement: true,
      local: { address: from, recipient: from, amountUnits: '1', nonce: 3, phase: 'confirmed',
        smartAccount: { payer: from, operations: [{ operationHash: hash, operationNonce: '0' }] } },
      indexedStatus: 'confirmed', observation: { status: 'confirmed', block, from, to: from },
      retainedObservation: { status: 'mined', outcome: 'confirmed', block },
      smartAuthorizations: [{ observation: { kind: 'observed', success: true, transactionHash: hash, block } }],
    };
    for (const unavailable of [false, true]) {
      const result = screen.render({ ...row, checking: !unavailable, unavailable },
        { accountAddress: from, nativeSymbol: 'ETH', networkName: 'Ethereum', hideBalances: false }) as unknown as { status: string };
      assert.equal(result.status, nativeTranslationFixture.nativeI18n.t('mobile.activityViews.nativeActivity.submissionUnconfirmed'));
    }
  } finally { screen.close(); }
});

test('privacy Activity labels the operation and omits its pool denomination when balances are hidden', () => {
  const screen = presentationFixture();
  try {
    const row = {
      hash: '0x' + 'ab'.repeat(32),
      indexed: {
        from: '0x' + '11'.repeat(20),
        to: '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936',
        privacyActivity: { kind: 'withdrawal', amount: '1' },
      },
      display: { formattedValue: '0', displaySymbol: 'ETH' },
      checking: false,
      unavailable: false,
    };
    const context = {
      accountAddress: row.indexed.from,
      nativeSymbol: 'ETH',
      networkName: 'Ethereum',
      hideBalances: false,
    };
    const show = (hideBalances: boolean) =>
      screen.render(row, { ...context, hideBalances }) as unknown as {
        title: string;
        poolBadge?: string;
        fullAmount: string;
        label: string;
      };
    const t = nativeTranslationFixture.nativeI18n.t.bind(
      nativeTranslationFixture.nativeI18n
    );
    const normal = show(false);
    assert.equal(normal.title, t('privacy.activity.withdrawal'));
    assert.equal(normal.poolBadge, t('privacy.poolAmount', { amount: '1' }));
    assert.equal(normal.fullAmount, '0 ETH');
    assert(normal.label.includes(normal.poolBadge!));
    const hidden = show(true);
    assert.equal(hidden.title, normal.title);
    assert.equal(hidden.poolBadge, undefined);
    assert(!hidden.label.includes(normal.poolBadge!));
  } finally {
    screen.close();
  }
});
