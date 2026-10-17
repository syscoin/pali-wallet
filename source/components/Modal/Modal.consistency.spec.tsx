/** @jest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { ConfirmationModal, DefaultModal, ErrorModal } from './Modal';
import { StatusModal } from './StatusModal';
import {
  CreatedAccountSuccessfully,
  WalletReadyModal,
} from './WarningBaseModal';

jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg aria-hidden="true" />,
  ImWarning: () => <svg aria-hidden="true" />,
  MdBugReport: () => <svg aria-hidden="true" />,
  WhiteSuccessIconSvg: () => <svg aria-hidden="true" />,
  ErrorIconSvg: () => <svg aria-hidden="true" />,
  WarnIconSvg: () => <svg aria-hidden="true" />,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button').Button,
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: { error: jest.fn() } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn() }),
}));
jest.mock('hooks/useOnboardingSecrets', () => ({
  useOnboardingSecrets: () => ({ beginRecovery: jest.fn() }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'buttons.close': 'Close',
        'buttons.cancel': 'Cancel',
        'buttons.ok': 'OK',
        'buttons.unlock': 'Unlock',
        'buttons.errorDescription': 'Error',
      }[key] || key),
  }),
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

it('keeps the default dialog named and its existing dismissal ID', async () => {
  const onClose = jest.fn();
  render(
    <DefaultModal
      show
      title="Notice"
      description="Readable detail"
      onClose={onClose}
    />
  );
  const dialog = screen.getByRole('dialog', { name: 'Notice' });
  expect(within(dialog).getByText('Readable detail')).toBeDefined();
  const button = within(dialog).getByRole('button', { name: 'Ok' });
  expect(button.id).toBe('got-it-btn');
  fireEvent.click(button);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('prevents Cancel and Escape from dismissing a busy confirmation', async () => {
  const onClose = jest.fn();
  const onClick = jest.fn();
  render(
    <ConfirmationModal
      show
      title="Confirm"
      buttonText="Continue"
      onClose={onClose}
      onClick={onClick}
      isButtonLoading
    />
  );
  const cancel = screen.getByRole('button', {
    name: 'Cancel',
  }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(true);
  fireEvent.click(cancel);
  await userEvent.keyboard('{Escape}');
  expect(onClose).not.toHaveBeenCalled();
  expect(onClick).not.toHaveBeenCalled();
});

it('preserves normal idle confirmation Escape and Confirm callbacks', async () => {
  const onClose = jest.fn();
  const onClick = jest.fn();
  render(
    <ConfirmationModal
      show
      title="Confirm"
      buttonText="Continue"
      onClose={onClose}
      onClick={onClick}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(onClick).toHaveBeenCalledTimes(1);
  await userEvent.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('keeps an explicitly read-only loading quote cancellable without enabling Confirm', async () => {
  const onClose = jest.fn();
  const onClick = jest.fn();
  render(
    <ConfirmationModal
      show
      title="Quote"
      buttonText="Continue"
      onClose={onClose}
      onClick={onClick}
      isButtonLoading
      allowCloseWhileLoading
    />
  );
  const cancel = screen.getByRole('button', {
    name: 'Cancel',
  }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(false);
  expect(
    (document.querySelector('#confirm-btn') as HTMLButtonElement).disabled
  ).toBe(true);
  fireEvent.click(cancel);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClick).not.toHaveBeenCalled();
});

it('gives error dialogs their visible accessible title and preserves report/close actions', () => {
  const onClose = jest.fn();
  render(
    <ErrorModal
      show
      title="Unable to continue"
      description="Try later"
      log="public diagnostic"
      onClose={onClose}
    />
  );
  const dialog = screen.getByRole('dialog', { name: 'UNABLE TO CONTINUE' });
  expect(
    within(dialog).getByText('public diagnostic', { exact: false })
  ).toBeDefined();
  expect(within(dialog).getByRole('button', { name: /Report/ })).toBeDefined();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ok' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('gives status dialogs a name and keyboard-operable close control', async () => {
  const onClose = jest.fn();
  render(
    <StatusModal
      status="success"
      title="Account ready"
      description="Next step"
      onClose={onClose}
    />
  );
  const dialog = screen.getByRole('dialog', { name: 'Account ready' });
  const close = within(dialog).getByRole('button', { name: 'Close' });
  await waitFor(() =>
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
  );
  await userEvent.tab();
  await waitFor(() => expect(document.activeElement).toBe(close));
  await userEvent.keyboard('{Enter}');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('uses the current status onClose callback after rerender', () => {
  const first = jest.fn();
  const second = jest.fn();
  const view = render(
    <StatusModal status="warn" title="Warning" onClose={first} />
  );
  view.rerender(<StatusModal status="warn" title="Warning" onClose={second} />);
  const close =
    screen.queryByRole('button', { name: 'Close' }) ||
    document.querySelector('img')!;
  fireEvent.click(close);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

it.each(['success', 'warn', 'error'])(
  'uses a dark semantic status surface for %s text',
  (status) => {
    render(<StatusModal status={status} title="Result" description="Detail" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.bg-surface-raised')).not.toBeNull();
    expect(
      dialog.querySelector(
        '.bg-brand-green, .bg-brand-yellowInfo, .bg-brand-red'
      )
    ).toBeNull();
  }
);

it('names the wallet-ready sheet and preserves its unlock callback argument', () => {
  const onClose = jest.fn();
  render(
    <WalletReadyModal
      title="Wallet ready"
      phraseOne="Keep your backup safe"
      onClose={onClose}
    />
  );
  const dialog = screen.getByRole('dialog', { name: 'Wallet ready' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }));
  expect(onClose).toHaveBeenCalledWith(false);
});

it('keeps successful account sheet callbacks and removes fixed-width action overflow', () => {
  const onClose = jest.fn();
  render(
    <MemoryRouter>
      <CreatedAccountSuccessfully
        title="Created"
        phraseOne="Your account is ready"
        onClose={onClose}
      />
    </MemoryRouter>
  );
  const button = screen.getByRole('button', { name: 'OK' });
  expect(button.id).toBe('account-created-ok-btn');
  expect(button.className).not.toContain('w-[22rem]');
  fireEvent.click(button);
  expect(onClose).toHaveBeenCalledTimes(1);
});
