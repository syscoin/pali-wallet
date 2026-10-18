/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';

import { ICustomApprovedAllowanceAmount } from 'types/transactions';

import { EditApprovedAllowanceValueModal } from './EditApprovedAllowanceValueModal';

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

function Harness() {
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState<ICustomApprovedAllowanceAmount>({
    isCustom: false,
    defaultAllowanceValue: '100',
    customAllowanceValue: null,
  });
  return (
    <>
      <button onClick={() => setShow(true)}>Open allowance</button>
      <button
        onClick={() =>
          setSaved({
            isCustom: true,
            defaultAllowanceValue: '100',
            customAllowanceValue: '9',
          })
        }
      >
        Update committed allowance
      </button>
      <output data-testid="committed-allowance">{JSON.stringify(saved)}</output>
      <EditApprovedAllowanceValueModal
        approvedTokenInfos={{ tokenDecimals: 6, tokenSymbol: 'UNIT' }}
        customApprovedAllowanceAmount={saved}
        host="https://dapp.example"
        showModal={show}
        setCustomApprovedAllowanceAmount={setSaved}
        setOpenEditFeeModal={setShow}
      />
    </>
  );
}

const input = () =>
  screen.getByRole('textbox', { name: 'send.enterAMaximumSpendingLimit' });
const committed = () =>
  JSON.parse(screen.getByTestId('committed-allowance').textContent!);
const open = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Open allowance' }));
const selectCustom = () =>
  fireEvent.click(
    screen.getByRole('radio', { name: 'send.customSpendingLimit' })
  );
const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));

it.each(['Cancel', 'Escape', 'Close'])(
  'restores saved allowance after an unsaved draft is dismissed with %s',
  async (dismissal) => {
    const user = userEvent.setup();
    render(<Harness />);
    open();
    selectCustom();
    fireEvent.change(input(), { target: { value: '5' } });
    save();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(committed().customAllowanceValue).toBe('5');
    open();
    expect((input() as HTMLInputElement).value).toBe('5');
    fireEvent.change(input(), { target: { value: '20' } });
    if (dismissal === 'Escape') await user.keyboard('{Escape}');
    else
      fireEvent.click(
        screen.getByRole('button', {
          name: dismissal === 'Cancel' ? 'buttons.cancel' : 'buttons.close',
        })
      );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(committed().customAllowanceValue).toBe('5');
    open();
    expect((input() as HTMLInputElement).value).toBe('5');
    expect(
      (
        screen.getByRole('radio', {
          name: 'send.customSpendingLimit',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
  }
);

it('submits a valid allowance through the native form submit path', async () => {
  render(<Harness />);
  open();
  selectCustom();
  fireEvent.change(input(), { target: { value: '7' } });
  fireEvent.submit(input().closest('form')!);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(committed().customAllowanceValue).toBe('7');
});

it.each(['hide', 'unmount'])(
  'does not commit pending validation after an external %s',
  async (exit) => {
    const saved = jest.fn();
    const props = {
      approvedTokenInfos: { tokenDecimals: 6, tokenSymbol: 'UNIT' },
      customApprovedAllowanceAmount: {
        isCustom: false,
        defaultAllowanceValue: '100',
        customAllowanceValue: null,
      },
      host: 'https://dapp.example',
      setCustomApprovedAllowanceAmount: saved,
      setOpenEditFeeModal: jest.fn(),
    };
    const view = render(
      <EditApprovedAllowanceValueModal {...props} showModal />
    );
    selectCustom();
    fireEvent.change(input(), { target: { value: '20' } });
    act(() => {
      save();
      if (exit === 'unmount') view.unmount();
      else
        view.rerender(
          <EditApprovedAllowanceValueModal {...props} showModal={false} />
        );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(saved).not.toHaveBeenCalled();
  }
);

it('restores committed radio choice, reads newer saved props on reopening and supports proposed limits', async () => {
  render(<Harness />);
  open();
  selectCustom();
  fireEvent.change(input(), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  open();
  expect(
    (
      screen.getByRole('radio', {
        name: 'send.proposedApprovalLimit',
      }) as HTMLInputElement
    ).checked
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(
    screen.getByRole('button', { name: 'Update committed allowance' })
  );
  open();
  expect((input() as HTMLInputElement).value).toBe('9');
  fireEvent.click(
    screen.getByRole('radio', { name: 'send.proposedApprovalLimit' })
  );
  save();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(committed()).toEqual({
    isCustom: false,
    defaultAllowanceValue: '100',
    customAllowanceValue: '',
  });
});

it.each(['-1', 'NaN', '1e9', '0x10', '1.0000001'])(
  'does not commit malformed custom allowance %s',
  async (value) => {
    render(<Harness />);
    open();
    selectCustom();
    fireEvent.change(input(), { target: { value } });
    save();
    await screen.findByText('send.invalidAmount');
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(committed().isCustom).toBe(false);
  }
);

it('allows an explicit zero approval for revocation', async () => {
  render(<Harness />);
  open();
  selectCustom();
  fireEvent.change(input(), { target: { value: '0' } });
  save();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(committed().customAllowanceValue).toBe('0');
  expect(committed().isCustom).toBe(true);
});

it.each(['Cancel', 'Escape', 'Close'])(
  'does not commit a pending Save after the allowance editor is dismissed with %s',
  async (dismissal) => {
    render(<Harness />);
    open();
    selectCustom();
    fireEvent.change(input(), { target: { value: '20' } });
    act(() => {
      save();
      if (dismissal === 'Escape') {
        fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      } else {
        fireEvent.click(
          screen.getByRole('button', {
            name: dismissal === 'Cancel' ? 'buttons.cancel' : 'buttons.close',
          })
        );
      }
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(committed()).toEqual({
      isCustom: false,
      defaultAllowanceValue: '100',
      customAllowanceValue: null,
    });
    open();
    selectCustom();
    fireEvent.change(input(), { target: { value: '3' } });
    save();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(committed().customAllowanceValue).toBe('3');
  }
);
