/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';

import type { ICustomApprovedAllowanceAmount } from 'types/transactions';
import { convertBigNumberToString, isMaxUint256 } from 'utils/bigNumberUtils';
import { Interface } from 'utils/ethersV6Compat';

import {
  formatApprovalTokenAmount,
  getApprovalAddressValues,
  getApprovalAmountDisplay,
  getEffectiveApprovalData,
} from './approval';
import { ApprovalDetails } from './components/ApprovalDetails';
import { EditApprovedAllowanceValueModal } from './EditApprovedAllowanceValueModal';

const SPENDER = `0x${'11'.repeat(20)}`;
const TOKEN = `0x${'22'.repeat(20)}`;
const MAXIMUM = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
const ABI = new Interface(['function approve(address spender,uint256 amount)']);
const UNLIMITED = '⚠️ transactions.unlimited';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Icon/Icon', () => ({
  Icon: () => <svg aria-hidden="true" />,
}));

const originalResizeObserver = globalThis.ResizeObserver;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as typeof ResizeObserver;
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});

// Actual editor, Form/Input, presentation and calldata helpers. Public dummy
// identifiers only; no provider, signing or persistence operation is needed.
function Harness({
  decimals,
  requested = MAXIMUM,
}: {
  decimals: number;
  requested?: string;
}) {
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState<ICustomApprovedAllowanceAmount>({
    isCustom: false,
    defaultAllowanceValue: formatApprovalTokenAmount(requested, decimals),
    customAllowanceValue: null,
  });
  const decoded = {
    method: 'approve',
    inputs: [SPENDER, requested],
    names: ['spender', 'amount'],
    types: ['address', 'uint256'],
  };
  const effective = getEffectiveApprovalData({
    approvalType: 'erc20-amount',
    customAmount: saved.customAllowanceValue,
    data: ABI.encodeFunctionData('approve', decoded.inputs),
    decimals,
    decodedTx: decoded,
    isCustom: saved.isCustom,
  });
  const display = getApprovalAmountDisplay({
    canEdit: true,
    customAmount: saved.customAllowanceValue,
    formattedAmount: formatApprovalTokenAmount(requested, decimals),
    isCustom: saved.isCustom,
    isEffectiveUnlimited:
      effective?.decodedTx.method === 'approve' &&
      isMaxUint256(convertBigNumberToString(effective.decodedTx.inputs[1])),
  });
  return (
    <MemoryRouter>
      <button onClick={() => setShow(true)}>Edit allowance</button>
      <ApprovalDetails
        {...getApprovalAddressValues(decoded, TOKEN, 'erc20-amount')}
        formattedAmount={display.amount}
        isUnlimited={display.isUnlimited}
        tokenSymbol="UNIT"
      />
      <output data-testid="encoded-amount">
        {effective
          ? ABI.decodeFunctionData('approve', effective.data)[1].toString()
          : 'invalid'}
      </output>
      <output data-testid="saved-allowance">{JSON.stringify(saved)}</output>
      <EditApprovedAllowanceValueModal
        host="https://dapp.example"
        approvedTokenInfos={{ tokenDecimals: decimals, tokenSymbol: 'UNIT' }}
        customApprovedAllowanceAmount={saved}
        setCustomApprovedAllowanceAmount={setSaved}
        showModal={show}
        setOpenEditFeeModal={setShow}
      />
    </MemoryRouter>
  );
}

const encodedAmount = () => screen.getByTestId('encoded-amount').textContent;
const savedAllowance = () =>
  JSON.parse(screen.getByTestId('saved-allowance').textContent!);
const input = () =>
  screen.getByRole('textbox', { name: 'send.enterAMaximumSpendingLimit' });
const openCustom = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Edit allowance' }));
  fireEvent.click(
    screen.getByRole('radio', { name: 'send.customSpendingLimit' })
  );
};
const save = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};

it.each([0, 6, 18])(
  'warns for an original maximum with %i decimals',
  (decimals) => {
    render(<Harness decimals={decimals} />);
    expect(screen.getByText(UNLIMITED)).toBeTruthy();
    expect(encodedAmount()).toBe(MAXIMUM);
  }
);

it.each([0, 6, 18])(
  'warns after saving a custom maximum with %i decimals',
  async (decimals) => {
    render(<Harness decimals={decimals} requested="1" />);
    expect(screen.queryByText(UNLIMITED)).toBeNull();
    openCustom();
    fireEvent.change(input(), {
      target: { value: formatApprovalTokenAmount(MAXIMUM, decimals) },
    });
    await save();
    expect(savedAllowance().isCustom).toBe(true);
    expect(encodedAmount()).toBe(MAXIMUM);
    expect(screen.getByText(UNLIMITED)).toBeTruthy();
  }
);

it.each([0, 6, 18])(
  'keeps zero and finite custom limits non-unlimited with %i decimals',
  async (decimals) => {
    render(<Harness decimals={decimals} />);
    for (const amount of ['0', '1']) {
      openCustom();
      fireEvent.change(input(), { target: { value: amount } });
      await save();
      expect(screen.queryByText(UNLIMITED)).toBeNull();
      expect(encodedAmount()).toBe(
        amount === '0' ? '0' : `1${'0'.repeat(decimals)}`
      );
      expect(screen.getByText(`${amount} UNIT`)).toBeTruthy();
    }
  }
);

it.each([0, 6, 18])(
  'refuses uint256 overflow without changing the saved limit with %i decimals',
  async (decimals) => {
    render(<Harness decimals={decimals} />);
    const before = savedAllowance();
    openCustom();
    fireEvent.change(input(), {
      target: {
        value: formatApprovalTokenAmount(
          (BigInt(MAXIMUM) + BigInt(1)).toString(),
          decimals
        ),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await screen.findByText('send.invalidAmount');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(savedAllowance()).toEqual(before);
    expect(encodedAmount()).toBe(MAXIMUM);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(UNLIMITED)).toBeTruthy();
  }
);

it.each(['Cancel', 'Escape', 'Close'])(
  'discards a custom maximum on %s and restores the proposed maximum',
  async (dismissal) => {
    const user = userEvent.setup();
    render(<Harness decimals={6} />);
    openCustom();
    fireEvent.change(input(), { target: { value: '2' } });
    await save();
    const before = savedAllowance();
    openCustom();
    fireEvent.change(input(), {
      target: { value: formatApprovalTokenAmount(MAXIMUM, 6) },
    });
    if (dismissal === 'Escape') await user.keyboard('{Escape}');
    else
      fireEvent.click(
        screen.getByRole('button', {
          name: dismissal === 'Cancel' ? 'buttons.cancel' : 'buttons.close',
        })
      );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(savedAllowance()).toEqual(before);
    expect(encodedAmount()).toBe('2000000');
    expect(screen.queryByText(UNLIMITED)).toBeNull();
    openCustom();
    expect((input() as HTMLInputElement).value).toBe('2');
    fireEvent.click(
      screen.getByRole('radio', { name: 'send.proposedApprovalLimit' })
    );
    await save();
    expect(savedAllowance().isCustom).toBe(false);
    expect(encodedAmount()).toBe(MAXIMUM);
    expect(screen.getByText(UNLIMITED)).toBeTruthy();
  }
);
