import assert from 'node:assert/strict';
import test from 'node:test';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

test('compact transaction facts retain full accessible amounts and identifiers with explicit status', () => {
  let copies = 0, explorers = 0;
  const fullAmount = '123456789012345678901234567890.000001 SYS';
  const address = `0x${'1'.repeat(40)}`, hash = `0x${'2'.repeat(64)}`;
  const f = screenFixture(new URL('../src/screens/TransactionDetailLayout.tsx', import.meta.url), 'TransactionDetailLayout', {
    'react-native': { StyleSheet: { create: (value: unknown) => value }, View: 'View' },
    '../activity/activityAmountLabel': { compactActivityAmountLabel },
    '../ui': { colors: {}, ...Object.fromEntries(['Button', 'Card', 'Icon', 'Text'].map(name => [name, name])) },
    './IdleActivityBoundary': { IdlePressable: 'Row' },
  });
  const nodes = screenElements(f.render({ amount: fullAmount, direction: 'Received', status: 'Submission unconfirmed', tone: 'unknown',
    rows: [
      { label: 'Network', value: 'Syscoin NEVM' }, { label: 'Date', value: 'Date unavailable' },
      { label: 'From', value: address, actionLabel: 'Copy sender address', onPress: () => { copies++; } },
      { label: 'To', value: 'Contract creation' }, { label: 'Network fee', value: 'Actual fee not verified' },
      { label: 'Transaction ID', value: hash },
    ], onExplorer: () => { explorers++; } }));
  const amount = nodes.find(node => node.type === 'Text' && node.props.accessibilityLabel === fullAmount); assert(amount);
  assert.equal(amount.children[0], '≈1.23456e+29 SYS');
  const transaction = nodes.find(node => node.type === 'Text' && node.props.accessibilityLabel === hash); assert(transaction);
  assert(String(transaction.children[0]).length <= 42);
  assert(nodes.some(node => node.children.includes('Submission unconfirmed')));
  assert(nodes.some(node => node.children.includes('Actual fee not verified')));
  const copy = nodes.find(node => node.type === 'Row'); assert(copy);
  assert.equal(copy.props.accessibilityLabel, `Copy sender address: ${address}`);
  copy.props.onPress(); assert.equal(copies, 1);
  const explorer = nodes.find(node => node.type === 'Button'); assert(explorer);
  assert.equal(explorer.props.title, 'View on explorer'); explorer.props.onPress(); assert.equal(explorers, 1);
  f.close();
});
