/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import en from 'assets/locales/en.json';
import fr from 'assets/locales/fr.json';

import {
  MAX_BLOCKING_LOADING_MS,
  PageLoadingOverlay,
} from './PageLoadingOverlay';

let mockLanguage: 'en' | 'fr' = 'en';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const catalog = jest.requireActual(
        mockLanguage === 'fr'
          ? 'assets/locales/fr.json'
          : 'assets/locales/en.json'
      );
      const message = key
        .split('.')
        .reduce((entry: any, part) => entry?.[part], catalog);
      return typeof message === 'string'
        ? message.replace(/{{(\w+)}}/g, (_match, name) =>
            String(values[name] ?? '')
          )
        : key;
    },
  }),
}));

const advance = (milliseconds: number) =>
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
const backdrop = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('div')).find(
    (node) =>
      node.classList.contains('fixed') &&
      node.classList.contains('inset-0') &&
      node.classList.contains('z-50')
  );
const expectInFlow = (status: HTMLElement) => {
  expect(status).toHaveAttribute('aria-live', 'polite');
  expect(status).toHaveClass('pointer-events-none', 'shrink-0', 'mx-3', 'my-3');
  expect(status).not.toHaveClass('fixed');
  expect(status).not.toHaveClass('sticky');
  expect(status).not.toHaveClass('absolute');
};
const expectHeaderlessStatus = (status: HTMLElement) => {
  expect(status).toHaveAttribute('aria-live', 'polite');
  expect(status).toHaveClass(
    'fixed',
    'bottom-3',
    'left-3',
    'right-3',
    'z-[55]',
    'pointer-events-none'
  );
  expect(status).not.toHaveClass('mx-3');
  expect(status).not.toHaveClass('my-3');
};

beforeEach(() => {
  jest.useFakeTimers();
  mockLanguage = 'en';
});
afterEach(() => {
  cleanup();
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

it('retains the initial fixed pointer-blocking backdrop through the two-second boundary', () => {
  const view = render(
    <PageLoadingOverlay
      isLoading
      message={en.networkConnection.updatingBalances}
    />
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(backdrop(view.container)).toBeUndefined();
  advance(149);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  advance(1);
  expectInFlow(screen.getByRole('status'));
  expect(screen.getByRole('status')).toHaveTextContent(
    en.networkConnection.updatingBalances
  );
  expect(backdrop(view.container)).toBeUndefined();
  advance(350);
  const initial = backdrop(view.container)!;
  expect(initial).toBeDefined();
  expect(initial).toHaveClass('z-50');
  expect(initial).not.toHaveClass('pointer-events-none');
  advance(MAX_BLOCKING_LOADING_MS - 501);
  expect(backdrop(view.container)).toBe(initial);
  expectInFlow(screen.getByRole('status'));
  advance(1);
  expect(backdrop(view.container)).toBeUndefined();
  const status = screen.getByRole('status');
  expectInFlow(status);
  expect(status).toHaveTextContent(
    en.networkConnection.operationSlow.replace(
      '{{operation}}',
      en.networkConnection.updatingBalances
    )
  );
  expect(status.querySelector('span')).toHaveClass('animate-spin', 'shrink-0');
});

it('keeps an immediate unavailable-worker status in flow without adding a blocking backdrop', () => {
  const view = render(
    <PageLoadingOverlay
      isLoading
      nonBlocking
      message={en.components.walletServiceReconnecting}
    />
  );
  expectInFlow(screen.getByRole('status'));
  expect(screen.getByRole('status')).toHaveTextContent(
    en.components.walletServiceReconnecting
  );
  expect(backdrop(view.container)).toBeUndefined();
  advance(MAX_BLOCKING_LOADING_MS);
  expectInFlow(screen.getByRole('status'));
  expect(backdrop(view.container)).toBeUndefined();
});

it('uses the installed French message without fixed positioning or nowrap constraints', () => {
  mockLanguage = 'fr';
  render(
    <PageLoadingOverlay
      isLoading
      message={fr.networkConnection.updatingBalances}
    />
  );
  advance(MAX_BLOCKING_LOADING_MS);
  const status = screen.getByRole('status');
  expectInFlow(status);
  expect(status).toHaveTextContent(
    fr.networkConnection.operationSlow.replace(
      '{{operation}}',
      fr.networkConnection.updatingBalances
    )
  );
  expect(status.className).not.toMatch(/whitespace-nowrap|truncate|line-clamp/);
  expect(status.lastElementChild?.className).not.toMatch(
    /whitespace-nowrap|truncate|line-clamp/
  );
});

it.each([false, true])(
  'retains the existing fixed status for headerless layouts with nonBlocking=%s',
  (nonBlocking) => {
    const view = render(
      <PageLoadingOverlay
        isLoading
        hasHeader={false}
        nonBlocking={nonBlocking}
        message={en.networkConnection.updatingBalances}
      />
    );
    if (nonBlocking) {
      expectHeaderlessStatus(screen.getByRole('status'));
      expect(backdrop(view.container)).toBeUndefined();
    } else {
      advance(500);
      expect(backdrop(view.container)).toBeDefined();
      expect(backdrop(view.container)).not.toHaveClass('pointer-events-none');
      expect(screen.getByRole('status')).toHaveClass('inset-0', 'z-[55]');
    }
    advance(MAX_BLOCKING_LOADING_MS);
    const status = screen.getByRole('status');
    expectHeaderlessStatus(status);
    expect(status).toHaveTextContent(
      nonBlocking
        ? en.networkConnection.updatingBalances
        : en.networkConnection.operationSlow.replace(
            '{{operation}}',
            en.networkConnection.updatingBalances
          )
    );
    expect(backdrop(view.container)).toBeUndefined();
  }
);

it('cancels all owned pending timers when loading ends and starts a fresh full delay next time', () => {
  const view = render(<PageLoadingOverlay isLoading />);
  expect(jest.getTimerCount()).toBe(3);
  advance(500);
  view.rerender(<PageLoadingOverlay isLoading={false} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(backdrop(view.container)).toBeUndefined();
  expect(jest.getTimerCount()).toBe(0);
  advance(MAX_BLOCKING_LOADING_MS * 2);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  view.rerender(<PageLoadingOverlay isLoading />);
  expect(jest.getTimerCount()).toBe(3);
  advance(MAX_BLOCKING_LOADING_MS - 1);
  expectInFlow(screen.getByRole('status'));
  advance(1);
  expectInFlow(screen.getByRole('status'));
});

it('releases all timers when unmounted before any indicator can appear', () => {
  const view = render(<PageLoadingOverlay isLoading />);
  expect(jest.getTimerCount()).toBe(3);
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
  advance(MAX_BLOCKING_LOADING_MS * 2);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
