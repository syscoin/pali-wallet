/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ConfigProvider, Form } from 'antd';
import React from 'react';

import de from '../../assets/locales/de.json';
import en from '../../assets/locales/en.json';
import fr from '../../assets/locales/fr.json';

import { Fee } from './Fee';

let mockLocale: typeof en = en;
const mockFeeChange = jest.fn();
const mockSubmit = jest.fn();
const mockTranslate = (key: string, values?: Record<string, string>) => {
  const message = key
    .split('.')
    .reduce((value, part) => value?.[part], mockLocale as any);
  return String(message ?? key).replace(
    /\{\{(\w+)\}\}/g,
    (_, part) => values?.[part] ?? ''
  );
};
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: { isBitcoinBased: true, activeNetwork: { currency: 'sys' } },
      price: { fiat: { asset: 'usd' } },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('hooks/index', () => ({
  usePrice: () => ({ getFiatAmount: () => '' }),
}));
jest.mock('..', () => ({
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));

const originals = {
  ResizeObserver: globalThis.ResizeObserver,
  MessageChannel: globalThis.MessageChannel,
  matchMedia: window.matchMedia,
};
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
  } as any;
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as any;
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
  globalThis.ResizeObserver = originals.ResizeObserver;
  globalThis.MessageChannel = originals.MessageChannel;
  window.matchMedia = originals.matchMedia;
});
beforeEach(() => {
  mockLocale = en;
  jest.clearAllMocks();
});

const NativeFeeForm = ({ disabled = false }: { disabled?: boolean }) => {
  const [form] = Form.useForm();
  return (
    // JSDOM does not run CSS transitions. Exercise native field semantics with
    // real AntD controls; production browser cases retain ordinary motion.
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Form form={form} onFinish={mockSubmit}>
        <Fee
          disabled={disabled}
          recommend={0.00000001}
          form={form}
          onFeeChange={mockFeeChange}
        />
        <button type="submit">Next</button>
      </Form>
    </ConfigProvider>
  );
};
const field = () => screen.getByRole('spinbutton') as HTMLInputElement;

it('preserves the labelled native field, wrapper ref target and pristine required state', async () => {
  render(<NativeFeeForm />);
  await waitFor(() => expect(field()).toHaveValue(0.00000001));
  expect(field()).toHaveAttribute('id', 'fee-input');
  expect(screen.getByLabelText('Fee Rate (SYS/vbyte)')).toBe(field());
  expect(field()).toHaveAttribute('aria-required', 'true');
  expect(field()).not.toHaveAttribute('aria-invalid', 'true');
  expect(field()).not.toHaveAttribute('aria-describedby');
  expect(document.querySelectorAll('#fee-input')).toHaveLength(1);
  expect(document.querySelectorAll('#fee')).toHaveLength(1);
  expect(document.getElementById('fee')).toContainElement(field());
  expect(document.getElementById('fee')).not.toHaveAttribute('aria-required');
});

it.each([
  ['en', en],
  ['fr', fr],
  ['de', de],
])(
  'associates the actual input with its existing localized invalid-rate error in %s',
  async (_, locale) => {
    mockLocale = locale as typeof en;
    render(<NativeFeeForm />);
    await waitFor(() => expect(field()).toHaveValue(0.00000001));
    mockFeeChange.mockClear();
    fireEvent.change(field(), { target: { value: '-1' } });
    expect(
      await screen.findByText(mockLocale.send.invalidFeeRate)
    ).toBeVisible();
    await waitFor(() =>
      expect(field()).toHaveAttribute('aria-invalid', 'true')
    );
    expect(field()).toHaveAttribute('aria-describedby', 'fee_help');
    expect(document.getElementById('fee_help')).toHaveTextContent(
      mockLocale.send.invalidFeeRate
    );
    expect(document.getElementById('fee')).not.toHaveAttribute('aria-invalid');
    expect(mockFeeChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(field()).toHaveAttribute('aria-invalid', 'true')
    );
    expect(mockSubmit).not.toHaveBeenCalled();
  }
);

it('ordinary positive correction clears stale semantics and preserves one fee-change callback', async () => {
  // Drive real AntD debounce timers deterministically; leave React's
  // MessageChannel microtasks real. No assertion or default wait is relaxed.
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  let view: ReturnType<typeof render> | undefined;
  try {
    view = render(<NativeFeeForm />);
    await waitFor(() => expect(field()).toHaveValue(0.00000001));
    fireEvent.change(field(), { target: { value: '-1' } });
    expect(await screen.findByText(en.send.invalidFeeRate)).toBeVisible();
    mockFeeChange.mockClear();
    await act(async () => {
      fireEvent.change(field(), { target: { value: '0.00000002' } });
    });
    // ItemHolder and ErrorList each clear a real 10ms debounce. Commit between
    // them so the second layer observes the first layer's cleared errors.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    await waitFor(() => {
      expect(field()).not.toHaveAttribute('aria-invalid', 'true');
      expect(field()).not.toHaveAttribute('aria-describedby');
      expect(
        screen.queryByText(en.send.invalidFeeRate)
      ).not.toBeInTheDocument();
    });
    expect(field()).toHaveValue(0.00000002);
    expect(field()).toHaveAttribute('aria-required', 'true');
    expect(mockFeeChange).toHaveBeenCalledTimes(1);
    expect(mockFeeChange).toHaveBeenCalledWith(0.00000002);
    expect(mockSubmit).not.toHaveBeenCalled();
  } finally {
    try {
      view?.unmount();
      await act(async () => {
        jest.runOnlyPendingTimers();
      });
    } finally {
      jest.useRealTimers();
    }
  }
});

it('retains disabled state and the existing native label', () => {
  render(<NativeFeeForm disabled />);
  expect(field()).toBeDisabled();
  expect(screen.getByLabelText('Fee Rate (SYS/vbyte)')).toBe(field());
});

// Real native-form coverage for safety-card association and fractional edits.
// Actual paint and primary browser AX are covered by the fenced UI regression.
const mockSafetyFinishFailed = jest.fn();
const NativeSafetyFeeForm = () => {
  const [form] = Form.useForm();
  return (
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Form
        form={form}
        onFinish={mockSubmit}
        onFinishFailed={mockSafetyFinishFailed}
      >
        <Fee
          disabled={false}
          recommend={0.00000001}
          form={form}
          onFeeChange={mockFeeChange}
        />
        <button type="submit">Next</button>
      </Form>
    </ConfigProvider>
  );
};

it.each(['0.00000002', '0.00001'])(
  'allows the valid fractional fee %s while the actual number input remains focused',
  async (value) => {
    render(<NativeSafetyFeeForm />);
    await waitFor(() => expect(field()).toHaveValue(0.00000001));
    React.act(() => field().focus());
    expect(document.activeElement).toBe(field());
    mockFeeChange.mockClear();
    fireEvent.change(field(), { target: { value } });
    await waitFor(() => expect(field()).toHaveValue(Number(value)));
    expect(document.activeElement).toBe(field());
    expect(field()).toHaveAttribute('step', 'any');
    expect(field().validity.stepMismatch).toBe(false);
    expect(field().validity.valid).toBe(true);
    expect(field().validationMessage).toBe('');
    expect(field()).not.toHaveAttribute('aria-invalid', 'true');
    expect(mockFeeChange).toHaveBeenCalledTimes(1);
    expect(mockFeeChange).toHaveBeenCalledWith(Number(value));
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockSafetyFinishFailed).not.toHaveBeenCalled();
  }
);

it.each([
  ['en', en],
  ['fr', fr],
  ['de', de],
])(
  'retains advisory/high-rate policy and associates the current safety reason in %s',
  async (_, locale) => {
    mockLocale = locale as typeof en;
    render(<NativeSafetyFeeForm />);
    await waitFor(() => expect(field()).toHaveValue(0.00000001));
    const advisoryMessage = mockTranslate('send.feeRateNormal', {
      value: '0.00001000',
      currency: 'SYS',
    });
    const safetyMessage = mockTranslate('send.feeRateSafetyLimit', {
      value: '0.00005000',
      currency: 'SYS',
      limit: '0.00005000',
    });

    mockFeeChange.mockClear();
    fireEvent.change(field(), { target: { value: '0.00001' } });
    expect(await screen.findByText(advisoryMessage)).toBeVisible();
    await waitFor(() =>
      expect(field()).not.toHaveAttribute('aria-invalid', 'true')
    );
    expect(field()).toHaveValue(0.00001);
    expect(mockFeeChange).toHaveBeenCalledTimes(1);
    expect(mockFeeChange).toHaveBeenCalledWith(0.00001);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0]).toEqual({ fee: '0.00001' });
    expect(mockSafetyFinishFailed).not.toHaveBeenCalled();
    // A nonblocking advisory need not be marked invalid or be a description.

    mockSubmit.mockClear();
    mockFeeChange.mockClear();
    fireEvent.change(field(), { target: { value: '0.00005' } });
    expect(await screen.findByText(safetyMessage)).toBeVisible();
    expect(screen.queryByText(advisoryMessage)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(field()).toHaveAttribute('aria-invalid', 'true')
    );
    expect(field()).toHaveValue(0.00005);
    expect(field()).toHaveAttribute('aria-required', 'true');
    expect(field()).toHaveAttribute('id', 'fee-input');
    expect(
      screen.getByLabelText(
        mockTranslate('components.feeRateLabel', { currency: 'SYS' })
      )
    ).toBe(field());

    // A finite positive high edit still notifies its parent, as before; the
    // actual AntD validator independently prevents successful submission.
    expect(mockFeeChange).toHaveBeenCalledTimes(1);
    expect(mockFeeChange).toHaveBeenCalledWith(0.00005);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(mockSafetyFinishFailed).toHaveBeenCalledTimes(1)
    );
    expect(mockSafetyFinishFailed.mock.calls[0][0].errorFields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: ['fee'] })])
    );
    expect(mockSubmit).not.toHaveBeenCalled();

    // Form validation finishes before AntD's debounced ErrorList commits.
    // Observe the complete native description association after both settle.
    await waitFor(() => {
      const descriptionIds = (field().getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean);
      expect(descriptionIds.length).toBeGreaterThan(0);
      expect(new Set(descriptionIds).size).toBe(descriptionIds.length);
      for (const id of descriptionIds) {
        const matches = Array.from(document.querySelectorAll('[id]')).filter(
          (element) => element.id === id
        );
        expect(matches).toHaveLength(1);
      }
      // The preserved blank AntD help reference contributes boundary whitespace;
      // require the entire exact reason, with no additional words or substrings.
      const escapedReason = safetyMessage.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );
      expect(field()).toHaveAccessibleDescription(
        new RegExp('^\\s*' + escapedReason + '\\s*$')
      );
    });

    mockFeeChange.mockClear();
    fireEvent.change(field(), { target: { value: '0.00000002' } });
    await waitFor(() => {
      expect(field()).not.toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByText(safetyMessage)).not.toBeInTheDocument();
      expect(screen.queryByText(advisoryMessage)).not.toBeInTheDocument();
    });
    const correctedIds = (field().getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean);
    const correctedDescription = correctedIds
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(correctedDescription).not.toContain(safetyMessage);
    expect(field()).toHaveValue(0.00000002);
    expect(field()).toHaveAttribute('aria-required', 'true');
    expect(mockFeeChange).toHaveBeenCalledTimes(1);
    expect(mockFeeChange).toHaveBeenCalledWith(0.00000002);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0]).toEqual({ fee: '0.00000002' });
    expect(mockSafetyFinishFailed).toHaveBeenCalledTimes(1);
  }
);
