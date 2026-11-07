/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

import en from '../../assets/locales/en.json';

import { RetainedTransactionReplay } from './RetainedTransactionReplay';

const HASH = `0x${'11'.repeat(32)}`;
const mockEmitter = jest.fn();
const mockT = (key: string, values?: Record<string, string>) => {
  let value: any = en;
  for (const part of key.split('.')) value = value?.[part];
  return String(value ?? key).replace(
    /{{(\w+)}}/g,
    (_, name) => values?.[name] ?? ''
  );
};
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-redux', () => ({
  shallowEqual: (a: any, b: any) => a === b,
  useSelector: (select: any) =>
    select({
      vault: {
        activeAccount: { id: 0, type: 'HDAccount' },
        accounts: { Imported: {} },
        activeNetwork: {
          label: 'Test network',
          currency: 'SYS',
          chainId: 57057,
        },
      },
    }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: 'synthetic',
    network: 'synthetic',
  }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => null,
  MdBugReport: () => null,
}));

it('announces the resend warning as part of the real review dialog description before confirming', async () => {
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getSavedEvmTransaction') return { hash: HASH };
    if (method === 'prepareEvmSignedReplay')
      return {
        status: 'review',
        review: {
          id: 'test-review',
          hash: HASH,
          validForMs: 90000,
          chainId: '57057',
          from: `0x${'33'.repeat(20)}`,
          to: null,
          value: '0',
          nonce: '4',
          maximumFee: '1',
          dataBytes: 0,
          accessListEntries: 0,
          operation: 'send',
          predecessors: [],
          predecessorCount: 0,
        },
      };
    if (method === 'cancelEvmSignedReplay') return undefined;
    throw new Error(`Unexpected action ${method}`);
  });
  render(<RetainedTransactionReplay hash={HASH} />);
  fireEvent.click(
    await screen.findByRole('button', { name: en.transactions.replay.review })
  );
  const dialog = await screen.findByRole('dialog', {
    name: en.transactions.replay.title,
  });
  expect(dialog).toHaveAccessibleDescription(
    `${en.transactions.replay.description} ${en.transactions.replay.sameNonceWarning}`
  );
  expect(
    within(dialog).getByRole('button', { name: en.transactions.replay.resend })
  ).toBeEnabled();
  expect(
    mockEmitter.mock.calls.some(
      (call) => call[0][1] === 'confirmEvmSignedReplay'
    )
  ).toBe(false);
});
