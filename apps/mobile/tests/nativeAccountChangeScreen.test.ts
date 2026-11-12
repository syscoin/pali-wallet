import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import type { NativeAccountChangeReview } from '../src/connections/accountChangeRequests.ts';

function fixture(busy = false) {
  const calls: unknown[] = [];
  let fail = false;
  const controller = { getSnapshot: () => ({ error: 'CONNECTION_UNAVAILABLE' }), selectConnectionAccount: (...args: unknown[]) => calls.push(['select', ...args]),
    approveAccountChange: async (...args: unknown[]) => { calls.push(['approve', ...args]); if (fail) throw Error('Failed'); }, rejectAccountChange: async (...args: unknown[]) => { calls.push(['reject', ...args]); } };
  const host = screenFixture(new URL('../src/screens/NativeAccountChangeReview.tsx', import.meta.url), 'NativeAccountChangeReview', {
    'react-native': { View: 'View', StyleSheet: { create: (value: unknown) => value }, BackHandler: { addEventListener: () => ({ remove() {} }) } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Icon', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
    './DappSiteStatus': { DappSiteStatus: 'DappSiteStatus' },
  });
  const review: NativeAccountChangeReview = { id: 'account-1', revision: 5, appName: 'Example', origin: 'https://example.invalid', verification: { validation: 'UNKNOWN', isScam: false },
    networkLabel: 'Ethereum', chainId: 'eip155:1', expiresAt: Date.now() + 60000, busy, error: null,
    currentAccountId: 'old', selectedAccountId: 'old', accounts: [{ id: 'old', type: 'HDAccount', label: 'Account 1', address: '0x' + '11'.repeat(20) }, { id: 'new', type: 'Ledger', label: 'Ledger', address: '0x' + '22'.repeat(20) }] };
  return { calls, host, fail: () => { fail = true; }, render: () => screenElements(host.render({ review, controller, onUnavailable: () => calls.push(['unavailable']) })) };
}

test('account chooser uses public identity, selected text/check and explicit footer consent', async () => {
  const f = fixture();
  try {
    const elements = f.render(), rows = elements.filter(value => value.type === 'Row');
    assert.match(rows[0]!.props.subtitle, /Currently connected.*Selected/);
    assert.equal(rows[0]!.props.right.props.name, 'check');
    assert.equal(rows[1]!.props.right.type, 'View');
    rows[1]!.props.onPress();
    assert.deepEqual(f.calls, [['select', 'account-1', 'new', 5]]);
    const button = elements.find(value => value.type === 'Button' && value.props.title === 'Switch Account'); assert(button);
    await button.props.onPress();
    assert.deepEqual(f.calls[1], ['approve', 'account-1', 5]);
    const reject = elements.find(value => value.type === 'Button' && value.props.title === 'Reject'); assert(reject);
    await reject.props.onPress(); assert.deepEqual(f.calls[2], ['reject', 'account-1']);
  } finally { f.host.close(); }
});

test('busy chooser has no actionable rows and cannot approve again', () => {
  const f = fixture(true);
  try {
    const elements = f.render();
    assert(elements.filter(value => value.type === 'Row').every(row => row.props.onPress === undefined));
    const approve = elements.find(value => value.type === 'Button' && value.props.title === 'Switch Account')!;
    assert.equal(approve.props.disabled, true); approve.props.onPress(); assert.deepEqual(f.calls, []);
  } finally { f.host.close(); }
});


test('a failed commit opens the existing connection error view', async () => {
  const f = fixture();
  try {
    f.fail();
    f.render().find(value => value.type === 'Button' && value.props.title === 'Switch Account')!.props.onPress();
    await Promise.resolve(); await Promise.resolve();
    assert(f.calls.some(value => JSON.stringify(value) === '["unavailable"]'));
  } finally { f.host.close(); }
});
