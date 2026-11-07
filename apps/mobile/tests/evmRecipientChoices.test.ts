import assert from 'node:assert/strict';
import test from 'node:test';

import { findLocalEvmRecipientChoices } from '../../../source/shared/evmRecipientChoices.ts';

const address = (id: number) => `0x${id.toString(16).padStart(40, '0')}`;

test('local suggestions match label or address and keep distinct accounts with the same label', () => {
  const accounts = [
    { address: address(10), label: 'Expenses' },
    { address: address(11), label: 'Expenses' },
    { address: address(10).toUpperCase(), label: 'Duplicate' },
    { address: 'not an EVM address', label: 'Expenses' },
    { address: address(12), label: '' },
  ];
  assert.deepEqual(findLocalEvmRecipientChoices(accounts, 'EXPENSES'), accounts.slice(0, 2));
  assert.deepEqual(findLocalEvmRecipientChoices(accounts, 'duplicate'), accounts.slice(2, 3));
  assert.deepEqual(findLocalEvmRecipientChoices(accounts, address(12).slice(-8)), [
    { address: address(12), label: address(12) },
  ]);
  assert.deepEqual(findLocalEvmRecipientChoices(accounts, ''), [
    ...accounts.slice(0, 2),
    { address: address(12), label: address(12) },
  ]);
});

test('local suggestions stop after ten distinct matches but search can find later accounts', () => {
  const accounts = Array.from({ length: 20 }, (_, index) => ({
    address: address(index + 1),
    label: `Account ${index + 1}`,
  }));
  assert.deepEqual(findLocalEvmRecipientChoices(accounts, ''), accounts.slice(0, 10));
  assert.deepEqual(findLocalEvmRecipientChoices(accounts, 'Account 20'), accounts.slice(-1));
});

test('malformed persisted labels fall back to the public address for rendering and matching', () => {
  const stored = [
    { address: address(10), label: { name: 'not a label' } },
    { address: address(11), label: 1 },
    { address: address(12), label: 'Savings' },
  ];
  assert.deepEqual(findLocalEvmRecipientChoices(stored, ''), [
    { address: address(10), label: address(10) },
    { address: address(11), label: address(11) },
    { address: address(12), label: 'Savings' },
  ]);
  assert.deepEqual(findLocalEvmRecipientChoices(stored, address(10).slice(-8)), [
    { address: address(10), label: address(10) },
  ]);
  assert.deepEqual(findLocalEvmRecipientChoices(stored, 'savings'), stored.slice(-1));
});
