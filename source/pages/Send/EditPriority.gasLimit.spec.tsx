/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';
import React from 'react';

import { ICustomFeeParams } from 'types/transactions';

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
  suggestedGasLimit = gasLimit,
  quotedPrice = 1
) {
  const saved = jest.fn();
  render(
    <EditPriorityModal
      showModal
      isSendLegacyTransaction={legacy}
      fee={{
        gasLimit,
        minimumGasLimit,
        gasPrice: quotedPrice,
        maxFeePerGas: quotedPrice,
        maxPriorityFeePerGas: quotedPrice,
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

function prepareLifecycle(legacy = false, savedCustom = true) {
  const saved = jest.fn();
  let updateMinimum: React.Dispatch<React.SetStateAction<number>>;
  let updateSaved: React.Dispatch<React.SetStateAction<ICustomFeeParams>>;
  const initial: ICustomFeeParams = savedCustom
    ? {
        isCustom: true,
        gasLimit: 25200,
        gasPrice: legacy ? 10 : 0,
        maxFeePerGas: legacy ? 0 : 10,
        maxPriorityFeePerGas: legacy ? 0 : 1,
      }
    : {
        isCustom: false,
        gasLimit: 0,
        gasPrice: 0,
        maxFeePerGas: 0,
        maxPriorityFeePerGas: 0,
      };
  const Harness = () => {
    const [open, setOpen] = React.useState(true);
    const [custom, setCustom] = React.useState(initial);
    const [minimum, setMinimum] = React.useState(21000);
    updateMinimum = setMinimum;
    updateSaved = setCustom;
    return (
      <>
        <button onClick={() => setOpen(true)}>reopen-editor</button>
        <output data-testid="saved-fee">{JSON.stringify(custom)}</output>
        <EditPriorityModal
          showModal={open}
          isSendLegacyTransaction={legacy}
          fee={{
            gasLimit: 25200,
            minimumGasLimit: minimum,
            gasPrice: 3.5,
            maxFeePerGas: 3.5,
            maxPriorityFeePerGas: 1,
            baseFee: 0,
          }}
          customFee={custom}
          defaultGasLimit={25200}
          setCustomFee={(value) => {
            saved(value);
            setCustom(value);
          }}
          setHaveError={jest.fn()}
          setIsOpen={setOpen}
        />
      </>
    );
  };
  render(<Harness />);
  return {
    initial,
    saved,
    setMinimum: (value: number) => act(() => updateMinimum(value)),
    setSaved: (value: ICustomFeeParams) => act(() => updateSaved(value)),
    current: () =>
      JSON.parse(screen.getByTestId('saved-fee').textContent || '{}'),
    price: () =>
      screen.getByPlaceholderText(
        legacy ? 'send.gasPrice (GWEI)' : 'send.maxFee (GWEI)'
      ) as HTMLInputElement,
  };
}

describe.each([false, true])(
  'transactional fee editor (legacy=%s)',
  (legacy) => {
    it.each(['cancel', 'escape', 'close'])(
      'preserves a previously saved fee on %s without edits',
      async (dismiss) => {
        const { initial, saved, current, price } = prepareLifecycle(legacy);
        await waitFor(() => expect(price().value).toBe('10'));
        if (dismiss === 'escape') await userEvent.setup().keyboard('{Escape}');
        else
          fireEvent.click(
            screen.getByRole('button', {
              name: dismiss === 'close' ? 'buttons.close' : 'buttons.cancel',
            })
          );
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(current()).toEqual(initial);
        expect(saved).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('reopen-editor'));
        await waitFor(() => expect(price().value).toBe('10'));
      }
    );

    it('keeps field and preset edits local, discards them on Cancel, and commits only a validated Save', async () => {
      const { initial, saved, current, price } = prepareLifecycle(legacy);
      await waitFor(() => expect(price().value).toBe('10'));
      fireEvent.change(price(), { target: { value: '20' } });
      expect(current()).toEqual(initial);
      expect(saved).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'higher-price' }));
      await waitFor(() => expect(price().value).toBe('4.2'));
      expect(saved).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      fireEvent.click(screen.getByText('reopen-editor'));
      await waitFor(() => expect(price().value).toBe('10'));
      fireEvent.change(price(), { target: { value: '20' } });
      fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(saved).toHaveBeenCalledTimes(1);
      expect(current()).toEqual({
        ...initial,
        [legacy ? 'gasPrice' : 'maxFeePerGas']: 20,
      });
      fireEvent.click(screen.getByText('reopen-editor'));
      await waitFor(() => expect(price().value).toBe('20'));
    });
  }
);

it('does not create a fee override when dismissing a changed default quote', async () => {
  const { initial, saved, current, price } = prepareLifecycle(false, false);
  await waitFor(() => expect(price().value).toBe('3.5'));
  fireEvent.change(price(), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(current()).toEqual(initial);
  expect(saved).not.toHaveBeenCalled();
});

it.each(['cancel', 'close', 'escape'])(
  'does not commit a pending Save after the editor is dismissed through %s',
  async (dismiss) => {
    const { initial, saved, current, price } = prepareLifecycle();
    await waitFor(() => expect(price().value).toBe('10'));
    fireEvent.change(price(), { target: { value: '20' } });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
      if (dismiss === 'escape') {
        fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      } else {
        fireEvent.click(
          screen.getByRole('button', {
            name: dismiss === 'close' ? 'buttons.close' : 'buttons.cancel',
          })
        );
      }
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(saved).not.toHaveBeenCalled();
    expect(current()).toEqual(initial);
    fireEvent.click(screen.getByText('reopen-editor'));
    await waitFor(() => expect(price().value).toBe('10'));
    fireEvent.change(price(), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(saved).toHaveBeenCalledTimes(1);
    expect(current()).toEqual({ ...initial, maxFeePerGas: 15 });
  }
);

it('revalidates a changed gas minimum without overwriting the open draft', async () => {
  const { price, setMinimum, saved } = prepareLifecycle();
  await waitFor(() => expect(price().value).toBe('10'));
  const gas = screen.getByPlaceholderText('send.gasLimit') as HTMLInputElement;
  fireEvent.change(gas, { target: { value: '30000' } });
  const save = screen.getByRole('button', { name: 'buttons.save' });
  await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
  setMinimum(40000);
  await waitFor(() => expect(save.hasAttribute('disabled')).toBe(true));
  expect(gas.value).toBe('30000');
  expect(price().value).toBe('10');
  expect(saved).not.toHaveBeenCalled();
  setMinimum(21000);
  await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
});

it.each([
  {
    label: 'stable',
    initial: 21000,
    next: 21000,
    gasLimit: 21000,
    saves: true,
  },
  {
    label: 'raised above the draft',
    initial: 21000,
    next: 30000,
    gasLimit: 21000,
    saves: false,
  },
  {
    label: 'decreased',
    initial: 30000,
    next: 21000,
    gasLimit: 30000,
    saves: true,
  },
  {
    label: 'raised within the draft',
    initial: 21000,
    next: 25000,
    gasLimit: 30000,
    saves: true,
  },
])(
  'uses the latest $label minimum after asynchronous Save validation',
  async ({ initial, next, gasLimit, saves }) => {
    const saved = jest.fn();
    const setOpen = jest.fn();
    const setHaveError = jest.fn();
    let committedMinimum = initial;
    let updateMinimum: (minimum: number) => void;
    const Harness = () => {
      const [minimum, setMinimum] = React.useState(initial);
      React.useLayoutEffect(() => {
        committedMinimum = minimum;
      }, [minimum]);
      updateMinimum = setMinimum;
      return (
        <EditPriorityModal
          showModal
          fee={{
            gasLimit,
            minimumGasLimit: minimum,
            gasPrice: 1,
            maxFeePerGas: 1,
            maxPriorityFeePerGas: 0,
            baseFee: 0,
          }}
          customFee={{
            isCustom: false,
            gasLimit: 0,
            gasPrice: 0,
            maxFeePerGas: 0,
            maxPriorityFeePerGas: 0,
          }}
          setCustomFee={(value) => saved(value, committedMinimum)}
          setHaveError={setHaveError}
          setIsOpen={setOpen}
        />
      );
    };
    render(<Harness />);
    const save = screen.getByRole('button', { name: 'buttons.save' });
    const gas = screen.getByPlaceholderText(
      'send.gasLimit'
    ) as HTMLInputElement;
    await waitFor(() => expect(save).toBeEnabled());
    await act(async () => {
      fireEvent.click(save);
      updateMinimum(next);
    });
    expect(committedMinimum).toBe(next);
    if (saves) {
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({ gasLimit }),
        next
      );
      expect(setOpen).toHaveBeenCalledWith(false);
    } else {
      expect(saved).not.toHaveBeenCalled();
      expect(setOpen).not.toHaveBeenCalled();
      expect(setHaveError).toHaveBeenCalledWith(true);
      expect(save).toBeDisabled();
      expect(gas.value).toBe(String(gasLimit));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.getByText(`send.gasLimitTooLow:${next}`)
        ).toBeInTheDocument()
      );
      // The same editor session stays usable after correcting the draft.
      fireEvent.change(gas, { target: { value: String(next) } });
      await waitFor(() => expect(save).toBeEnabled());
      await act(async () => fireEvent.click(save));
      expect(saved).toHaveBeenCalledTimes(1);
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({ gasLimit: next }),
        next
      );
    }
  }
);

it('reopens from the latest saved parent fee rather than old form fields', async () => {
  const { price, setSaved } = prepareLifecycle();
  await waitFor(() => expect(price().value).toBe('10'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  setSaved({
    isCustom: true,
    gasLimit: 35000,
    maxFeePerGas: 15,
    maxPriorityFeePerGas: 1,
    gasPrice: 0,
  });
  fireEvent.click(screen.getByText('reopen-editor'));
  await waitFor(() => expect(price().value).toBe('15'));
  expect(
    (screen.getByPlaceholderText('send.gasLimit') as HTMLInputElement).value
  ).toBe('35000');
});

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
  await waitFor(() =>
    expect(screen.getByText('send.gasLimitBelowEstimate')).toBeTruthy()
  );
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
  await waitFor(() =>
    expect(screen.getByText('send.priorityFeeBelowEstimate')).toBeTruthy()
  );
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

describe.each([false, true])('exact custom fee units (legacy=%s)', (legacy) => {
  it.each([
    '1e21',
    '1e309',
    '0.0000000001',
    '1.0000000001',
    '9007199.254740991',
  ])(
    'rejects unrepresentable GWEI %s in both live and asynchronous form validation',
    async (value) => {
      // Capture the real antd form solely to exercise its asynchronous rules
      // independently of the Save button's live disabled state.
      const realUseForm = Form.useForm;
      let actualForm: ReturnType<typeof Form.useForm>[0];
      const formSpy = jest
        .spyOn(Form, 'useForm')
        .mockImplementation((...args) => {
          const result = realUseForm(...args);
          actualForm = result[0];
          return result;
        });
      try {
        const { saved } = prepare(21000, 21000, legacy);
        const price = screen.getByPlaceholderText(
          legacy ? 'send.gasPrice (GWEI)' : 'send.maxFee (GWEI)'
        );
        await waitFor(() =>
          expect((price as HTMLInputElement).value).toBe('1')
        );
        if (!legacy) {
          fireEvent.change(
            screen.getByPlaceholderText('send.maxPriorityFee (GWEI)'),
            {
              target: { value: '0' },
            }
          );
        }
        fireEvent.change(price, { target: { value } });
        await waitFor(() =>
          expect(
            screen.getByRole('button', { name: 'buttons.save' })
          ).toBeDisabled()
        );
        await act(async () => {
          await expect(actualForm!.validateFields()).rejects.toBeTruthy();
        });
        expect(saved).not.toHaveBeenCalled();
      } finally {
        formSpy.mockRestore();
      }
    }
  );

  it.each([
    '0.000000001',
    '1.000000001',
    '3.500000001',
    '100000000000000000000',
  ])(
    'saves exactly representable GWEI %s without an economic cap',
    async (value) => {
      const { saved } = prepare(21000, 21000, legacy);
      const price = screen.getByPlaceholderText(
        legacy ? 'send.gasPrice (GWEI)' : 'send.maxFee (GWEI)'
      );
      await waitFor(() => expect((price as HTMLInputElement).value).toBe('1'));
      if (!legacy) {
        fireEvent.change(
          screen.getByPlaceholderText('send.maxPriorityFee (GWEI)'),
          {
            target: { value: '0' },
          }
        );
      }
      fireEvent.change(price, { target: { value } });
      await act(async () =>
        fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }))
      );
      await waitFor(() =>
        expect(saved).toHaveBeenCalledWith(
          expect.objectContaining({
            [legacy ? 'gasPrice' : 'maxFeePerGas']: Number(value),
          })
        )
      );
    }
  );

  it.each([0.000000001, 3.000000001])(
    'keeps the higher preset valid at integer-wei precision for quote %s',
    async (quote) => {
      const { saved } = prepare(21000, 21000, legacy, 21000, quote);
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'buttons.save' })
        ).toBeEnabled()
      );
      fireEvent.click(screen.getByRole('button', { name: 'higher-price' }));
      await act(async () =>
        fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }))
      );
      const expected = quote === 0.000000001 ? 0.000000001 : 3.600000001;
      await waitFor(() =>
        expect(saved).toHaveBeenCalledWith(
          expect.objectContaining({
            [legacy ? 'gasPrice' : 'maxFeePerGas']: expected,
          })
        )
      );
    }
  );
});
