/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  render(<NativeFeeForm />);
  await waitFor(() => expect(field()).toHaveValue(0.00000001));
  fireEvent.change(field(), { target: { value: '-1' } });
  expect(await screen.findByText(en.send.invalidFeeRate)).toBeVisible();
  mockFeeChange.mockClear();
  fireEvent.change(field(), { target: { value: '0.00000002' } });
  await waitFor(() => {
    expect(field()).not.toHaveAttribute('aria-invalid', 'true');
    expect(field()).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(en.send.invalidFeeRate)).not.toBeInTheDocument();
  });
  expect(field()).toHaveValue(0.00000002);
  expect(field()).toHaveAttribute('aria-required', 'true');
  expect(mockFeeChange).toHaveBeenCalledTimes(1);
  expect(mockFeeChange).toHaveBeenCalledWith(0.00000002);
  expect(mockSubmit).not.toHaveBeenCalled();
});

it('retains disabled state and the existing native label', () => {
  render(<NativeFeeForm disabled />);
  expect(field()).toBeDisabled();
  expect(screen.getByLabelText('Fee Rate (SYS/vbyte)')).toBe(field());
});
