/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { changeLanguage } from 'utils/i18n';
import { chromeStorage } from 'utils/storageAPI';

import Advanced from './Advanced';
import Currency from './Currency';
import Languages from './Languages';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockState = {
  vault: {
    activeAccount: { id: 0, type: 'HDAccount' },
    accounts: { HDAccount: { 0: { balances: { syscoin: 0, ethereum: 0 } } } },
    activeNetwork: { chainId: 5700, currency: 'tsys' },
    isBitcoinBased: true,
  },
  price: { fiat: { asset: 'usd' } },
  vaultGlobal: { advancedSettings: { refresh: false, autolock: 5 } },
};
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/settings/languages' }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
  usePrice: () => ({ getFiatAmount: () => '' }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/navigationState', () => ({ navigateBack: jest.fn() }));
jest.mock('utils/i18n', () => ({ changeLanguage: jest.fn() }));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn().mockResolvedValue('en') },
}));
jest.mock('utils/index', () => ({ formatNumber: String }));
jest.mock('./SmartAccountInfrastructure', () => ({
  SmartAccountInfrastructure: () => null,
}));
jest.mock('components/Icon/Icon', () => ({ ArrowDownSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Button: ({ children, loading, disabled, onClick, type }: any) => (
    <button type={type} onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
  DefaultModal: ({ show, title }: any) =>
    show ? <div role="dialog">{title}</div> : null,
  ConfirmationModal: () => null,
}));
jest.mock('antd', () => {
  const Form: any = ({ children, onFinish }: any) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onFinish();
      }}
    >
      {children}
    </form>
  );
  Form.Item = ({ children }: any) => <>{children}</>;
  Form.Item.displayName = 'MockFormItem';
  return { Form };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockState.vaultGlobal.advancedSettings = { refresh: false, autolock: 5 };
  mockState.price.fiat = { asset: 'usd' };
  mockEmitter.mockResolvedValue(undefined);
  jest.mocked(changeLanguage).mockResolvedValue(undefined);
  jest.mocked(chromeStorage.getItem).mockResolvedValue('en');
});

it('preserves the advanced draft when a later setting fails after an earlier save', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockState.vaultGlobal.advancedSettings = { refresh: true, autolock: 5 };
  const view = render(<Advanced />);
  fireEvent.click(screen.getByLabelText('settings.enableRefresh'));
  fireEvent.change(screen.getByLabelText('settings.enableAutolock'), {
    target: { value: '10' },
  });
  mockEmitter.mockImplementation(async (_path, [property, value]) => {
    if (property === 'autolock')
      throw new Error('synthetic second save failure');
    mockState.vaultGlobal.advancedSettings = {
      ...mockState.vaultGlobal.advancedSettings,
      [property]: value,
    };
    view.rerender(<Advanced />);
  });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await screen.findByRole('alert');
  expect(
    (screen.getByLabelText('settings.enableAutolock') as HTMLInputElement).value
  ).toBe('10');
  expect(
    screen
      .getByRole('button', { name: 'buttons.save' })
      .hasAttribute('disabled')
  ).toBe(false);
});
afterEach(() => jest.restoreAllMocks());

it('labels advanced controls and refuses an empty autolock value', () => {
  const { container } = render(<Advanced />);
  const input = screen.getByLabelText(
    'settings.enableAutolock'
  ) as HTMLInputElement;
  expect(
    screen.getByLabelText('settings.enableRefresh').getAttribute('role')
  ).toBe('switch');
  fireEvent.change(input, { target: { value: '' } });
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(
    screen
      .getByRole('button', { name: 'buttons.save' })
      .hasAttribute('disabled')
  ).toBe(true);
  fireEvent.submit(container.querySelector('form')!);
  expect(mockEmitter).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '5.5' } });
  fireEvent.blur(input);
  expect(input.value).toBe('6');
});

it('reports an advanced save failure and leaves the form retryable', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockEmitter.mockRejectedValue(new Error('synthetic failure'));
  render(<Advanced />);
  fireEvent.change(screen.getByLabelText('settings.enableAutolock'), {
    target: { value: '10' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(
      'settings.preferencesSaveFailed'
    )
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    screen
      .getByRole('button', { name: 'buttons.save' })
      .hasAttribute('disabled')
  ).toBe(false);
});

it('keeps an advanced draft retryable when its staged write fails before publication', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const view = render(<Advanced />);
  fireEvent.change(screen.getByLabelText('settings.enableAutolock'), {
    target: { value: '10' },
  });
  let rejectFirstAutolock = true;
  mockEmitter.mockImplementation(async (_path, [property, value]) => {
    if (property === 'autolock' && rejectFirstAutolock) {
      rejectFirstAutolock = false;
      throw new Error('Storage unavailable');
    }
    mockState.vaultGlobal.advancedSettings = {
      ...mockState.vaultGlobal.advancedSettings,
      [property]: value,
    };
    view.rerender(<Advanced />);
  });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await screen.findByRole('alert');
  const save = screen.getByRole('button', { name: 'buttons.save' });
  expect(save.hasAttribute('disabled')).toBe(false);
  expect(
    (screen.getByLabelText('settings.enableAutolock') as HTMLInputElement).value
  ).toBe('10');
  fireEvent.click(save);
  await screen.findByRole('dialog');
  expect(mockState.vaultGlobal.advancedSettings.autolock).toBe(10);
});

it('keeps closed language options out of the accessibility tree and reports a failed save', async () => {
  await act(async () => {
    render(<Languages />);
  });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'settings.setYourPreferredLanguage' })
  );
  fireEvent.click(screen.getByRole('menuitem', { name: /German/ }));
  jest.mocked(changeLanguage).mockRejectedValue(new Error('synthetic failure'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(
      'settings.preferencesSaveFailed'
    )
  );
  expect(changeLanguage).toHaveBeenCalledWith('de');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('makes currency search keyboard-focusable only when opened and reports a failed save', async () => {
  render(<Currency />);
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'settings.setYourPreferred' })
  );
  const search = screen.getByRole('textbox', {
    name: 'settings.searchCurrencies',
  });
  fireEvent.change(search, { target: { value: 'eur' } });
  fireEvent.click(screen.getByRole('button', { name: /EUR/ }));
  expect(screen.queryByRole('textbox')).toBeNull();
  mockEmitter.mockRejectedValue(new Error('synthetic failure'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(
      'settings.preferencesSaveFailed'
    )
  );
  expect(mockEmitter).toHaveBeenCalledWith(['wallet', 'setFiat'], ['eur']);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('supports keyboard currency search, Enter selection and Escape without selecting', async () => {
  const user = userEvent.setup();
  render(<Currency />);
  const trigger = screen.getByRole('button', {
    name: 'settings.setYourPreferred',
  });
  await user.click(trigger);
  const search = screen.getByRole('textbox', {
    name: 'settings.searchCurrencies',
  });
  await waitFor(() => expect(document.activeElement).toBe(search));
  await user.type(search, 'eur');
  await user.tab();
  await user.keyboard('{Enter}');
  expect(trigger.textContent).toContain('EUR');
  expect(screen.queryByRole('textbox')).toBeNull();
  await user.click(trigger);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(trigger.textContent).toContain('EUR');
  expect(document.activeElement).toBe(trigger);
});

it('preserves a currency draft when a different saved currency arrives', async () => {
  const user = userEvent.setup();
  const view = render(<Currency />);
  const trigger = screen.getByRole('button', {
    name: 'settings.setYourPreferred',
  });
  await user.click(trigger);
  await user.type(
    screen.getByRole('textbox', { name: 'settings.searchCurrencies' }),
    'eur'
  );
  await user.click(screen.getByRole('button', { name: /EUR/ }));
  mockState.price.fiat = { asset: 'gbp' };
  view.rerender(<Currency />);
  expect(trigger.textContent).toContain('EUR');
  const save = screen.getByRole('button', { name: 'buttons.save' });
  expect(save.hasAttribute('disabled')).toBe(false);
  await user.click(save);
  expect(mockEmitter).toHaveBeenCalledWith(['wallet', 'setFiat'], ['eur']);
});

it('follows saved currency updates until the user edits the draft', () => {
  const view = render(<Currency />);
  mockState.price.fiat = { asset: 'cad' };
  view.rerender(<Currency />);
  expect(
    screen.getByRole('button', { name: 'settings.setYourPreferred' })
      .textContent
  ).toContain('CAD');
  expect(
    screen
      .getByRole('button', { name: 'buttons.save' })
      .hasAttribute('disabled')
  ).toBe(true);
});

it('keeps the submitted currency selected while its save is waiting on an older price update', async () => {
  let finishSaving!: () => void;
  mockEmitter.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishSaving = resolve;
      })
  );
  const user = userEvent.setup();
  const view = render(<Currency />);
  const trigger = screen.getByRole('button', {
    name: 'settings.setYourPreferred',
  });
  await user.click(trigger);
  await user.type(
    screen.getByRole('textbox', { name: 'settings.searchCurrencies' }),
    'eur'
  );
  await user.click(screen.getByRole('button', { name: /EUR/ }));
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  mockState.price.fiat = { asset: 'gbp' };
  view.rerender(<Currency />);
  expect(trigger.textContent).toContain('EUR');
  await act(async () => finishSaving());
  await screen.findByRole('dialog');
  expect(trigger.textContent).toContain('EUR');
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('preserves language typeahead and Enter selection after removing closed options', async () => {
  const user = userEvent.setup();
  await act(async () => {
    render(<Languages />);
  });
  const trigger = screen.getByRole('button', {
    name: 'settings.setYourPreferredLanguage',
  });
  await user.click(trigger);
  await user.keyboard('ger{Enter}');
  expect(trigger.textContent).toContain('Deutsch');
  expect(screen.queryByRole('menu')).toBeNull();
});

it('does not replace a language the user selected while the saved preference was loading', async () => {
  let finishLoading!: (value: string) => void;
  jest.mocked(chromeStorage.getItem).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishLoading = resolve;
      })
  );
  const user = userEvent.setup();
  render(<Languages />);
  const trigger = screen.getByRole('button', {
    name: 'settings.setYourPreferredLanguage',
  });
  await user.click(trigger);
  await user.keyboard('ger{Enter}');
  expect(trigger.textContent).toContain('Deutsch');
  await act(async () => finishLoading('en'));
  expect(trigger.textContent).toContain('Deutsch');
  expect(
    screen
      .getByRole('button', { name: 'buttons.save' })
      .hasAttribute('disabled')
  ).toBe(false);
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(changeLanguage).toHaveBeenCalledWith('de');
});

it('does not revert a completed language save when the older preference read finishes', async () => {
  let finishLoading!: (value: string) => void;
  jest.mocked(chromeStorage.getItem).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishLoading = resolve;
      })
  );
  const user = userEvent.setup();
  render(<Languages />);
  const trigger = screen.getByRole('button', {
    name: 'settings.setYourPreferredLanguage',
  });
  await user.click(trigger);
  await user.keyboard('ger{Enter}');
  const save = screen.getByRole('button', { name: 'buttons.save' });
  await user.click(save);
  await screen.findByRole('dialog');
  await act(async () => finishLoading('en'));
  expect(trigger.textContent).toContain('Deutsch');
  expect(save.hasAttribute('disabled')).toBe(true);
  expect(changeLanguage).toHaveBeenCalledTimes(1);
});
