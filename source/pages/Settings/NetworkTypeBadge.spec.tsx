/** @jest-environment jsdom */
import { render } from '@testing-library/react';
import React from 'react';

import { INetworkType } from 'types/network';

import { NetworkTypeBadge } from './NetworkTypeBadge';

it.each([
  [INetworkType.Syscoin, 'UTXO', 'bg-brand-pink'],
  [INetworkType.Ethereum, 'EVM', 'bg-brand-blue'],
  [undefined, 'EVM', 'bg-brand-blue'],
  ['unknown' as INetworkType, 'EVM', 'bg-brand-blue'],
] as const)('preserves badge markup for kind %s', (kind, label, color) => {
  const { container } = render(<NetworkTypeBadge kind={kind} />);
  expect(container.innerHTML).toBe(
    `<span class="px-1.5 py-0.5 text-[10px] font-medium text-white rounded-full ${color}">${label}</span>`
  );
});
