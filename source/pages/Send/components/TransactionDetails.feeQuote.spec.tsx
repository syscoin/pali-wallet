/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { TransactionDetailsComponent } from './TransactionDetails';

const mockEmitter = jest.fn(async () => ({ isBlacklisted: false }));
const mockSetCustomNonce = jest.fn();
const mockSetIsOpen = jest.fn();
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vault: { activeNetwork: { currency: 'TSYS' } } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('state/vault/selectors', () => ({ selectValidEnsCache: () => ({}) }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    alert: { info: jest.fn() },
    useCopyClipboard: () => [false, jest.fn()],
  }),
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/IconButton', () => ({
  IconButton: ({ children }: any) => <button>{children}</button>,
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('antd', () => ({ Input: (props: any) => <input {...props} /> }));

const show = (
  quote?: { gasUnits: string; maximumFeeWei: string },
  legacy = false,
  editingDisabled = false,
  customNonce?: number
) =>
  render(
    <TransactionDetailsComponent
      tx={
        {
          from: `0x${'11'.repeat(20)}`,
          to: `0x${'22'.repeat(20)}`,
          value: '1',
          nonce: 0,
        } as any
      }
      decodedTx={{} as any}
      editingDisabled={editingDisabled}
      customNonce={customNonce}
      fee={{
        baseFee: 20,
        gasLimit: 25398,
        ...(legacy ? { gasPrice: 50 } : {}),
        maxFeePerGas: 50,
        maxPriorityFeePerGas: 0,
        ...(quote ? { smartAccountFeeQuote: quote } : {}),
      }}
      customFee={{
        isCustom: false,
        gasLimit: 0,
        gasPrice: 0,
        maxFeePerGas: 0,
        maxPriorityFeePerGas: 0,
      }}
      setCustomFee={jest.fn()}
      setCustomNonce={mockSetCustomNonce}
      setFee={jest.fn()}
      setHaveError={jest.fn()}
      setIsOpen={mockSetIsOpen}
    />
  );

it.each([false, true])(
  'shows the actual full AA account-charge ceiling, not the direct-call fee (legacy=%s)',
  (legacy) => {
    show({ gasUnits: '863456', maximumFeeWei: '43172800000000000' }, legacy);
    expect(screen.getByText('send.smartAccountMaxFee')).toBeTruthy();
    expect(screen.getByText('send.smartAccountFeeDetails')).toBeTruthy();
    expect(screen.getByText('0.0431728 TSYS')).toBeTruthy();
    expect(screen.getByText('0.043172800000000001 TSYS')).toBeTruthy();
    expect(screen.queryByText('0.0012699 TSYS')).toBeNull();
  }
);

it('does not double-count the separate outer gas payer in verified tank mode', () => {
  show({ gasUnits: '863456', maximumFeeWei: '0' });
  expect(screen.getByText('0 TSYS')).toBeTruthy();
  expect(screen.getByText('0.000000000000000001 TSYS')).toBeTruthy();
  expect(screen.getByText('send.smartAccountFeeDetails')).toBeTruthy();
});

it('retains the ordinary EOA fee calculation without any AA account-charge label', () => {
  show();
  expect(screen.getByText('send.maxFee')).toBeTruthy();
  expect(screen.getByText('0.0012699 TSYS')).toBeTruthy();
  expect(screen.queryByText('send.smartAccountFeeDetails')).toBeNull();
});

it('disables the real fee and nonce controls while transaction editing is locked', () => {
  show(undefined, false, true);
  const feeEditor = screen.getByRole('button', { name: 'send.editFee' });
  const nonce = screen.getByRole('spinbutton');
  expect((feeEditor as HTMLButtonElement).disabled).toBe(true);
  expect((nonce as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(feeEditor);
  fireEvent.change(nonce, { target: { value: '7' } });
  expect(mockSetIsOpen).not.toHaveBeenCalled();
  expect(mockSetCustomNonce).not.toHaveBeenCalled();
});

it.each([undefined, 0, 7])(
  'shows the selected nonce %s, falling back to the quote only when not edited',
  (customNonce) => {
    show(undefined, false, false, customNonce);
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe(
      String(customNonce ?? 0)
    );
  }
);
