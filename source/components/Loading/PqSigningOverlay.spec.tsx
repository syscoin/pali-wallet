/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { PqSigningOverlay } from './PqSigningOverlay';

jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
});

it('contains focus while signing and cannot dismiss or retry the operation', async () => {
  const view = render(
    <>
      <button>Background action</button>
      <PqSigningOverlay
        show
        expectedSeconds={20}
        title="Signing locally"
        subtitle="Keep the wallet open"
      />
    </>
  );
  const panel = screen.getByTestId('pq-signing-overlay');
  expect(screen.getByRole('dialog', { name: 'Signing locally' })).toBeDefined();
  expect(panel.getAttribute('aria-busy')).toBe('true');
  await waitFor(() => expect(document.activeElement).toBe(panel));
  await userEvent.tab();
  expect(document.activeElement).not.toBe(
    screen.queryByText('Background action')
  );
  fireEvent.keyDown(panel, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'Signing locally' })).toBeDefined();
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(
    <>
      <button>Background action</button>
      <PqSigningOverlay
        show={false}
        expectedSeconds={20}
        title="Signing locally"
        subtitle="Keep the wallet open"
      />
    </>
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});
