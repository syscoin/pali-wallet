/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';

import {
  OnboardingSecretsProvider,
  useOnboardingSecrets,
} from 'hooks/useOnboardingSecrets';
import * as format from 'utils/format';

import ImportPhrase from './ImportPhrase';

const mockEmitter = jest.fn();
let mockSubmit: (values: { phrase: string }) => Promise<void>;
let mockValidator: (_: unknown, value: string) => Promise<void>;
const phrase = 'synthetic-only-recovery-seed-phrase';
const ticket = 'synthetic-only-live-recovery-ticket';
const mockForm = {
  values: {} as Record<string, string>,
  getFieldValue: (name: string) => mockForm.values[name],
  setFieldsValue: jest.fn((values: Record<string, string>) =>
    Object.assign(mockForm.values, values)
  ),
  submit: () => mockSubmit({ phrase: mockForm.values.phrase }),
};

jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/index', () => ({
  Button: ({ children, loading, ...props }: any) => (
    <button {...props} aria-busy={loading}>
      {children}
    </button>
  ),
}));
jest.mock('components/Layout/OnboardingLayout', () => ({
  OnboardingLayout: ({ children, title }: any) => (
    <>
      <h1>{title}</h1>
      {children}
    </>
  ),
}));
jest.mock('components/Modal/StatusModal', () => ({ StatusModal: () => null }));
jest.mock('utils/format', () => ({
  formatSeedPhrase: jest.fn((value: string) => value),
}));
jest.mock('antd/lib/form/Form', () => ({ useForm: () => [mockForm] }));
jest.mock('antd', () => {
  const Form: any = ({ children, onFinish }: any) => {
    mockSubmit = onFinish;
    return <>{children}</>;
  };
  Form.Item = ({ children, rules }: any) => {
    const factory = rules?.find((rule: any) => typeof rule === 'function');
    if (factory) mockValidator = factory().validator;
    return children;
  };
  return { Form, Input: { TextArea: (props: any) => <textarea {...props} /> } };
});

const Probe = () => {
  const { secrets, beginRecovery } = useOnboardingSecrets();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="secrets">{JSON.stringify(secrets)}</output>
      <output data-testid="route">{location.pathname}</output>
      <button onClick={() => beginRecovery(ticket)}>begin recovery</button>
      <button onClick={() => navigate('/')}>cancel seed entry</button>
    </>
  );
};
const Tree = () => (
  <BrowserRouter>
    <OnboardingSecretsProvider>
      <ImportPhrase />
      <Probe />
    </OnboardingSecretsProvider>
  </BrowserRouter>
);
const deferred = () => {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockReset().mockResolvedValue(true);
  mockForm.values = {};
  window.history.replaceState(null, '', '/import');
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

it('rejects an invalid word count without sending an object to the controller', async () => {
  jest
    .mocked(format.formatSeedPhrase)
    .mockReturnValueOnce({ seedLength: 2, seedLengthError: true });
  render(<Tree />);
  await act(async () => {
    await expect(mockValidator(undefined, 'one two')).rejects.toThrow(
      'Invalid seed phrase length'
    );
  });
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockForm.setFieldsValue).not.toHaveBeenCalled();
});

it('exposes the seed visibility action as a named keyboard button', () => {
  render(<Tree />);
  const hide = screen.getByRole('button', { name: 'import.hideSeedPhrase' });
  expect(hide.getAttribute('type')).toBe('button');
  fireEvent.click(hide);
  expect(
    screen.getByRole('button', { name: 'import.showSeedPhrase' })
  ).toBeTruthy();
});

it('disables import again when a previously valid phrase fails validation', async () => {
  render(<Tree />);
  await act(async () => {
    await mockValidator(undefined, phrase);
  });
  expect(
    screen
      .getByRole('button', { name: 'buttons.import' })
      .hasAttribute('disabled')
  ).toBe(false);
  mockEmitter.mockResolvedValueOnce(false);
  await act(async () => {
    await expect(
      mockValidator(undefined, 'invalid checksum phrase')
    ).rejects.toThrow('Invalid seed phrase');
  });
  expect(
    screen
      .getByRole('button', { name: 'buttons.import' })
      .hasAttribute('disabled')
  ).toBe(true);
});

it('does not let an older valid reply re-enable a newer invalid phrase', async () => {
  const response = deferred();
  mockEmitter.mockReturnValueOnce(response.promise);
  render(<Tree />);
  let olderValidation!: Promise<unknown>;
  act(() => {
    olderValidation = mockValidator(undefined, phrase).catch((error) => error);
  });
  jest.mocked(format.formatSeedPhrase).mockReturnValueOnce({
    seedLength: 2,
    seedLengthError: true,
  });
  await act(async () => {
    await expect(mockValidator(undefined, 'one two')).rejects.toThrow(
      'Invalid seed phrase length'
    );
    response.resolve(true);
    await olderValidation;
  });
  expect(
    screen
      .getByRole('button', { name: 'buttons.import' })
      .hasAttribute('disabled')
  ).toBe(true);
});

it.each(['pagehide', 'hidden', 'route cancel', 'native departure', 'unmount'])(
  'cannot revive a cleared recovery phrase or ticket when submit validation resolves after %s',
  async (departure) => {
    const response = deferred();
    mockEmitter.mockReturnValueOnce(response.promise);
    const view = render(<Tree />);
    fireEvent.click(screen.getByRole('button', { name: 'begin recovery' }));
    const oldSubmit = mockSubmit;
    const pending = oldSubmit({ phrase });
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    if (departure === 'pagehide') fireEvent(window, new Event('pagehide'));
    if (departure === 'hidden') {
      jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      fireEvent(document, new Event('visibilitychange'));
    }
    if (departure === 'route cancel')
      fireEvent.click(
        screen.getByRole('button', { name: 'cancel seed entry' })
      );
    if (departure === 'native departure')
      window.history.replaceState(null, '', '/app.html#/');
    if (departure === 'unmount') view.unmount();
    await act(async () => {
      await oldSubmit({ phrase });
      response.resolve(true);
      await pending;
    });
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).not.toBe('/create-password-import');
    if (departure !== 'unmount') {
      expect(screen.getByTestId('route').textContent).not.toBe(
        '/create-password-import'
      );
      if (departure !== 'native departure')
        expect(screen.getByTestId('secrets').textContent).toBe('{}');
      else
        expect(screen.getByTestId('secrets').textContent).not.toContain(phrase);
    }
    expect(JSON.stringify(window.history.state)).not.toContain(phrase);
    expect(JSON.stringify(window.history.state)).not.toContain(ticket);
  }
);

it.each(['pagehide', 'hidden'])(
  'rejects an old form-rule validation after %s so Ant Design cannot invoke onFinish',
  async (departure) => {
    const response = deferred();
    mockEmitter.mockReturnValueOnce(response.promise);
    render(<Tree />);
    fireEvent.click(screen.getByRole('button', { name: 'begin recovery' }));
    let pending!: Promise<unknown>;
    act(() => {
      pending = mockValidator(undefined, phrase).catch((error) => error);
    });
    if (departure === 'pagehide') fireEvent(window, new Event('pagehide'));
    else {
      jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      fireEvent(document, new Event('visibilitychange'));
    }
    await act(async () => response.resolve(true));
    expect(await pending).toBeInstanceOf(Error);
    expect(screen.getByTestId('secrets').textContent).toBe('{}');
    expect(
      screen
        .getByRole('button', { name: 'buttons.import' })
        .hasAttribute('disabled')
    ).toBe(true);
  }
);

it.each(['ordinary import', 'recovery'])(
  'keeps valid %s validation and navigation compatible without persisting its secrets',
  async (kind) => {
    render(<Tree />);
    if (kind === 'recovery')
      fireEvent.click(screen.getByRole('button', { name: 'begin recovery' }));
    expect(
      screen.getByRole('heading', {
        name:
          kind === 'recovery'
            ? 'settings.recoveryTitle'
            : 'titles.importWallet',
      })
    ).toBeTruthy();
    await act(async () => {
      await mockValidator(undefined, phrase);
    });
    expect(
      screen
        .getByRole('button', {
          name:
            kind === 'recovery' ? 'buttons.recoverWallet' : 'buttons.import',
        })
        .hasAttribute('disabled')
    ).toBe(false);
    await act(async () => {
      await mockSubmit({ phrase });
    });
    expect(mockEmitter).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('route').textContent).toBe(
      '/create-password-import'
    );
    expect(JSON.parse(screen.getByTestId('secrets').textContent!)).toEqual({
      kind: 'import',
      phrase,
      ...(kind === 'recovery' ? { recoveryTicket: ticket } : {}),
    });
    expect(window.history.state.usr).toEqual({ isWalletImported: true });
    expect(
      JSON.stringify({
        history: window.history.state,
        local: localStorage,
        session: sessionStorage,
      })
    ).not.toContain(phrase);
    expect(
      JSON.stringify({
        history: window.history.state,
        local: localStorage,
        session: sessionStorage,
      })
    ).not.toContain(ticket);
  }
);

it('does not issue duplicate final validation requests while an active submit is pending', async () => {
  const response = deferred();
  mockEmitter.mockReturnValueOnce(response.promise);
  render(<Tree />);
  const currentSubmit = mockSubmit;
  const pending = currentSubmit({ phrase });
  await currentSubmit({ phrase });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  await act(async () => {
    response.resolve(true);
    await pending;
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('route').textContent).toBe(
    '/create-password-import'
  );
  expect(JSON.parse(screen.getByTestId('secrets').textContent!)).toEqual({
    kind: 'import',
    phrase,
  });
});
