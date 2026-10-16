/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import React from 'react';

import { DialogBody } from './Dialog';

jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it('makes only overflowing body content keyboard-scrollable and cleans up the observer', () => {
  let resized: () => void = () => undefined;
  const disconnect = jest.fn();
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      resized = callback;
    }
    observe() {
      /* Measurements are supplied below. */
    }
    unobserve() {
      /* Measurements are supplied below. */
    }
    disconnect = disconnect;
  } as unknown as typeof ResizeObserver;
  try {
    const view = render(<DialogBody>Long dialog content</DialogBody>);
    const body = screen.getByText('Long dialog content');
    expect(body.hasAttribute('tabindex')).toBe(false);
    Object.defineProperty(body, 'scrollHeight', {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(body, 'clientHeight', {
      value: 100,
      configurable: true,
    });
    act(() => resized());
    expect(body.tabIndex).toBe(0);
    Object.defineProperty(body, 'scrollHeight', {
      value: 100,
      configurable: true,
    });
    act(() => resized());
    expect(body.hasAttribute('tabindex')).toBe(false);
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  } finally {
    globalThis.ResizeObserver = original;
  }
});
