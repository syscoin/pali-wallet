/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';

import {
  OnboardingSecretsProvider,
  useOnboardingSecrets,
} from './useOnboardingSecrets';

const password = 'Synthetic-private-password!';
const phrase = 'synthetic private phrase';
const data = JSON.stringify({
  approvalId: 'original-document-request',
  host: 'https://original.synthetic',
  eventName: 'connect',
  literal: '# & + % café',
});
const entry = (route = 'connect-wallet') =>
  `/external.html?${new URLSearchParams({ route, data })}`;

const Probe = () => {
  const state = useOnboardingSecrets();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <output data-testid="route">{location.pathname + location.search}</output>
      <output data-testid="secrets">{JSON.stringify(state.secrets)}</output>
      <button onClick={() => navigate('/import')}>import entry</button>
      <button
        onClick={() => {
          state.beginImport(phrase);
          navigate('/create-password-import');
        }}
      >
        import phrase
      </button>
      <button
        onClick={() => {
          state.beginCreate(password);
          navigate('/phrase');
        }}
      >
        create password
      </button>
      <button onClick={() => state.setCreatedPhrase(phrase)}>
        generate phrase
      </button>
      <button onClick={state.clear}>clear private</button>
      <button onClick={() => navigate('/home')}>leave onboarding</button>
      <button
        onClick={() => {
          state.clear();
          navigate(state.consumeContinuation() || '/home', { replace: true });
        }}
      >
        finish
      </button>
    </>
  );
};
const mount = () =>
  render(
    <BrowserRouter>
      <OnboardingSecretsProvider>
        <Probe />
      </OnboardingSecretsProvider>
    </BrowserRouter>
  );
const locationUrl = () =>
  new URL(screen.getByTestId('route').textContent!, window.location.origin);
const noPersistedPrivateMaterial = () => {
  const persisted = JSON.stringify({
    url: window.location.href,
    history: window.history.state,
    local: localStorage,
    session: sessionStorage,
  });
  expect(persisted).not.toContain(password);
  expect(persisted).not.toContain(phrase);
};

describe('external onboarding continuation lifetime', () => {
  beforeEach(() => window.history.replaceState(null, '', entry()));

  it.each(['import', 'create'])(
    'retains only original request metadata across %s and consumes it once',
    (mode) => {
      mount();
      if (mode === 'import') {
        fireEvent.click(screen.getByText('import entry'));
        fireEvent.click(screen.getByText('import phrase'));
      } else {
        fireEvent.click(screen.getByText('create password'));
        fireEvent.click(screen.getByText('generate phrase'));
      }
      expect(screen.getByTestId('secrets').textContent).toContain(phrase);
      noPersistedPrivateMaterial();
      fireEvent.click(screen.getByText('clear private'));
      expect(screen.getByTestId('secrets').textContent).toBe('{}');
      fireEvent.click(screen.getByText('finish'));
      expect(locationUrl().pathname).toBe('/external/connect-wallet');
      expect(locationUrl().searchParams.get('data')).toBe(data);
      noPersistedPrivateMaterial();
      fireEvent.click(screen.getByText('import entry'));
      fireEvent.click(screen.getByText('finish'));
      expect(locationUrl().pathname).toBe('/home');
    }
  );

  it('ordinary onboarding keeps its Home destination', () => {
    window.history.replaceState(null, '', '/');
    mount();
    fireEvent.click(screen.getByText('create password'));
    fireEvent.click(screen.getByText('finish'));
    expect(locationUrl().pathname).toBe('/home');
    expect(locationUrl().search).toBe('');
  });

  it('private-draft purge keeps the request context explicit at Start', () => {
    mount();
    fireEvent.click(screen.getByText('create password'));
    fireEvent.click(screen.getByText('generate phrase'));
    fireEvent(window, new Event('pagehide'));
    expect(screen.getByTestId('secrets').textContent).toBe('{}');
    expect(locationUrl().pathname).toBe('/');
    expect(locationUrl().searchParams.get('externalRoute')).toBe(
      'connect-wallet'
    );
    expect(locationUrl().searchParams.get('data')).toBe(data);
    noPersistedPrivateMaterial();
  });

  it('leaving onboarding cancels the retained destination', () => {
    mount();
    fireEvent.click(screen.getByText('create password'));
    fireEvent.click(screen.getByText('leave onboarding'));
    fireEvent.click(screen.getByText('import entry'));
    fireEvent.click(screen.getByText('finish'));
    expect(locationUrl().pathname).toBe('/home');
  });

  it('a new document at a routed URL cannot recover the old continuation', () => {
    const first = mount();
    fireEvent.click(screen.getByText('import entry'));
    first.unmount();
    mount();
    fireEvent.click(screen.getByText('import phrase'));
    fireEvent.click(screen.getByText('finish'));
    expect(locationUrl().pathname).toBe('/home');
  });

  it('login resumes its explicit authentication screen, without auto-close or response', () => {
    window.history.replaceState(null, '', entry('login'));
    const close = jest
      .spyOn(window, 'close')
      .mockImplementation(() => undefined);
    mount();
    fireEvent.click(screen.getByText('create password'));
    fireEvent.click(screen.getByText('finish'));
    expect(locationUrl().pathname).toBe('/external/login');
    expect(locationUrl().searchParams.get('data')).toBe(data);
    expect(close).not.toHaveBeenCalled();
    close.mockRestore();
  });
});
