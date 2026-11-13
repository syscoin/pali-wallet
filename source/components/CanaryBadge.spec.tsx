/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { CanaryBadge } from './CanaryBadge';

const original = process.env.PALI_EXTENSION_CHANNEL;
afterEach(() => {
  if (original === undefined) delete process.env.PALI_EXTENSION_CHANNEL;
  else process.env.PALI_EXTENSION_CHANNEL = original;
});

it.each(['stable', 'development', undefined])(
  'leaves the %s wallet unlabelled',
  (channel) => {
    if (channel === undefined) delete process.env.PALI_EXTENSION_CHANNEL;
    else process.env.PALI_EXTENSION_CHANNEL = channel;
    const view = render(<CanaryBadge />);
    expect(view.container.innerHTML).toBe('');
  }
);

it('labels Canary without adding an interactive control', () => {
  process.env.PALI_EXTENSION_CHANNEL = 'canary';
  render(<CanaryBadge />);
  expect(screen.getByLabelText('Pali Wallet Canary').textContent).toBe(
    'Canary'
  );
  expect(screen.queryByRole('button')).toBeNull();
});
