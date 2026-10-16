/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { EditPriorityModal } from './EditPriority';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { minimum?: number }) =>
      params?.minimum === undefined ? key : `${key}:${params.minimum}`,
  }),
}));
jest.mock('components/index', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('./components', () => ({
  PriorityBar: ({ onClick }: any) => (
    <button onClick={() => onClick(2)}>higher-price</button>
  ),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      /* JSDOM has no layout. */
    }
    unobserve() {
      /* JSDOM has no layout. */
    }
    disconnect() {
      /* JSDOM has no layout. */
    }
  } as typeof ResizeObserver;
  // Antd's actual Form batches watchers through MessageChannel; jsdom does
  // not implement that browser primitive.
  (globalThis as any).MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(() => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
});

function prepare(
  gasLimit = 21000,
  minimumGasLimit?: number,
  legacy = true,
  suggestedGasLimit = gasLimit
) {
  const saved = jest.fn();
  render(
    <EditPriorityModal
      showModal
      isSendLegacyTransaction={legacy}
      fee={{
        gasLimit,
        minimumGasLimit,
        gasPrice: 1,
        maxFeePerGas: 1,
        maxPriorityFeePerGas: 1,
        baseFee: 0,
      }}
      customFee={{
        isCustom: false,
        // The real Confirm and SendTransaction callers initialize unused
        // custom fields to zero, even after a successful quote is available.
        gasLimit: 0,
        gasPrice: 0,
        maxFeePerGas: 0,
        maxPriorityFeePerGas: 0,
      }}
      estimatedFeeFloor={{
        gasLimit: suggestedGasLimit,
        gasPrice: 1,
        maxFeePerGas: 1,
        maxPriorityFeePerGas: 1,
        baseFee: 0,
      }}
      defaultGasLimit={gasLimit}
      setCustomFee={saved}
      setHaveError={jest.fn()}
      setIsOpen={jest.fn()}
    />
  );
  return {
    saved,
    input: screen.getByPlaceholderText('send.gasLimit') as HTMLInputElement,
  };
}

it('keeps a successful 21000-gas native quote unchanged when opening the editor and selecting a price preset', async () => {
  const { input } = prepare();
  await waitFor(() => expect(input.value).toBe('21000'));
  fireEvent.click(screen.getByRole('button', { name: 'higher-price' }));
  await waitFor(() => expect(input.value).toBe('21000'));
  expect(
    screen
      .getByRole('button', { name: 'buttons.save' })
      .hasAttribute('disabled')
  ).toBe(false);
});

it('allows a whole-number successful raw minimum below the buffered quote and preserves it across price changes', async () => {
  const { input, saved } = prepare(60000, 50000);
  await waitFor(() => expect(input.value).toBe('60000'));
  fireEvent.change(input, { target: { value: '50000' } });
  await waitFor(() => expect(input.value).toBe('50000'));
  expect(screen.getByText('send.gasLimitBelowEstimate')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'higher-price' }));
  await waitFor(() => expect(input.value).toBe('50000'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ isCustom: true, gasLimit: 50000 })
    )
  );
});

it('retains the known quote conservatively when no successful raw minimum is supplied', async () => {
  const { input, saved } = prepare(60000);
  await waitFor(() => expect(input.value).toBe('60000'));
  fireEvent.change(input, { target: { value: '55000' } });
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'buttons.save' })
        .hasAttribute('disabled')
    ).toBe(true)
  );
  expect(
    saved.mock.calls.some(
      ([value]) => typeof value === 'object' && value.isCustom
    )
  ).toBe(false);
});

it.each(['49999', '50000.5', '0', '', 'NaN', '9007199254740992'])(
  'refuses invalid or below-raw gas %s without replacing it with a usable default',
  async (value) => {
    const { input, saved } = prepare(60000, 50000);
    await waitFor(() => expect(input.value).toBe('60000'));
    fireEvent.change(input, { target: { value } });
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'buttons.save' })
          .hasAttribute('disabled')
      ).toBe(true)
    );
    expect(input.value).not.toBe('60000');
    expect(
      saved.mock.calls.some(
        ([result]) => typeof result === 'object' && result.isCustom
      )
    ).toBe(false);
  }
);

it('keeps a valid EIP1559 zero priority visible and saves it with a positive maximum', async () => {
  const { saved } = prepare(21000, 21000, false);
  const input = screen.getByPlaceholderText(
    'send.maxPriorityFee (GWEI)'
  ) as HTMLInputElement;
  await waitFor(() => expect(input.value).toBe('1'));
  fireEvent.change(input, { target: { value: '0' } });
  await waitFor(() => expect(input.value).toBe('0'));
  expect(screen.getByText('send.priorityFeeBelowEstimate')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({
        gasLimit: 21000,
        maxFeePerGas: 1,
        maxPriorityFeePerGas: 0,
      })
    )
  );
});

it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 21000.5])(
  'refuses an invalid raw minimum %s instead of treating it as a valid quote',
  async (minimum) => {
    prepare(30000, minimum);
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'buttons.save' })
          .hasAttribute('disabled')
      ).toBe(true)
    );
  }
);
