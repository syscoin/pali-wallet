/** @jest-environment jsdom */
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

import { ValidatedPasswordInput } from './ValidatedPasswordInput';

const mockTranslate = (key: string) => key;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});

describe('explicit password error visibility', () => {
  let scroll: jest.Mock;
  let errorLog: jest.SpyInstance;
  beforeEach(() => {
    scroll = jest.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    errorLog = jest.spyOn(console, 'error').mockImplementation();
  });
  afterEach(() => errorLog.mockRestore());

  const mount = (
    onValidate: (password: string) => Promise<unknown>,
    trigger: 'change' | 'submit' = 'submit'
  ) => {
    const Field = () => {
      const [form] = Form.useForm();
      return (
        <Form form={form}>
          <ValidatedPasswordInput
            form={form}
            onValidate={onValidate}
            validationTrigger={trigger}
            placeholder="Password"
          />
        </Form>
      );
    };
    return render(<Field />);
  };

  it('reveals current explicit error without moving focus or retrying authentication', async () => {
    const validate = jest.fn().mockRejectedValue(new Error('invalid'));
    mount(validate);
    const input = screen.getByPlaceholderText('Password');
    await userEvent.setup().type(input, 'synthetic-password');
    input.focus();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
    expect(document.activeElement).toBe(input);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('start.wrongPassword')).toBeTruthy();
  });

  it('does not scroll for a superseded password attempt', async () => {
    let reject!: (error: Error) => void;
    mount(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    const input = screen.getByPlaceholderText('Password');
    fireEvent.change(input, { target: { value: 'older' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    fireEvent.change(input, { target: { value: 'newer' } });
    await act(async () => reject(new Error('invalid')));
    expect(scroll).not.toHaveBeenCalled();
  });

  it('does not scroll after the field is unmounted', async () => {
    let reject!: (error: Error) => void;
    const view = mount(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'synthetic' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    view.unmount();
    await act(async () => reject(new Error('invalid')));
    expect(scroll).not.toHaveBeenCalled();
  });

  it('does not scroll for background change-triggered validation', async () => {
    mount(jest.fn().mockRejectedValue(new Error('invalid')), 'change');
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'synthetic' },
    });
    await screen.findByText('start.wrongPassword');
    expect(scroll).not.toHaveBeenCalled();
  });

  it('follows delayed help layout only while the same field owns focus', async () => {
    const originalObserver = globalThis.ResizeObserver;
    let resize!: ResizeObserverCallback;
    const disconnect = jest.fn();
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = jest.fn();
      disconnect = disconnect;
    } as unknown as typeof ResizeObserver;
    const other = document.createElement('button');
    document.body.appendChild(other);
    try {
      const view = mount(jest.fn().mockRejectedValue(new Error('invalid')));
      const input = screen.getByPlaceholderText('Password');
      await userEvent.setup().type(input, 'synthetic');
      fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
      await waitFor(() => expect(resize).toBeDefined());
      const initial = scroll.mock.calls.length;
      resize([], {} as ResizeObserver);
      expect(scroll).toHaveBeenCalledTimes(initial + 1);
      other.focus();
      resize([], {} as ResizeObserver);
      expect(scroll).toHaveBeenCalledTimes(initial + 1);
      view.unmount();
      expect(disconnect).toHaveBeenCalled();
      resize([], {} as ResizeObserver);
      expect(scroll).toHaveBeenCalledTimes(initial + 1);
    } finally {
      other.remove();
      globalThis.ResizeObserver = originalObserver;
    }
  });
});
