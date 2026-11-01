/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

import { FaucetApiFeedback } from './FaucetApiFeedback';

const mockCopy = jest.fn();
jest.mock('components/Icon/Icon', () => ({
  Icon: () => null,
  LoadingSvg: () => null,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ useCopyClipboard: () => [true, mockCopy] }),
}));

const originalObserver = globalThis.ResizeObserver;
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
});
afterAll(() => {
  globalThis.ResizeObserver = originalObserver;
});
afterEach(() => mockCopy.mockClear());

it('closes copied feedback immediately even while copied remains true, and can show it on the next copy', () => {
  render(
    <FaucetApiFeedback
      apiTitle="Transaction hash"
      apiResponse="public-hash"
      status="success"
    />
  );

  const notice = screen.getByRole('dialog', {
    name: 'settings.successfullyCopied',
  });
  fireEvent.click(
    within(notice).getByRole('button', { name: 'buttons.close' })
  );
  expect(
    screen.queryByRole('dialog', { name: 'settings.successfullyCopied' })
  ).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
  expect(mockCopy).toHaveBeenCalledWith('public-hash');
  expect(
    screen.getByRole('dialog', { name: 'settings.successfullyCopied' })
  ).toBeDefined();
});
