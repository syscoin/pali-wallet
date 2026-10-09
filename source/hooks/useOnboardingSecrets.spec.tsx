/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';

import {
  OnboardingSecretsProvider,
  useOnboardingSecrets,
} from './useOnboardingSecrets';

const password = 'Synthetic-only-password-729!';
const phrase = 'synthetic recovery phrase fixture';
const Probe = () => {
  const { secrets, beginCreate, beginImport, setCreatedPhrase, clear } =
    useOnboardingSecrets();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <output data-testid="secrets">{JSON.stringify(secrets)}</output>
      <output data-testid="route">{location.pathname}</output>
      <button
        onClick={() => {
          beginCreate(password);
          navigate('/phrase');
        }}
      >
        create
      </button>
      <button
        onClick={() => {
          setCreatedPhrase(phrase);
          navigate('/phrase', { state: { next: true } });
        }}
      >
        confirm
      </button>
      <button
        onClick={() => {
          beginImport(phrase);
          navigate('/create-password-import');
        }}
      >
        import
      </button>
      <button onClick={() => navigate('/home')}>leave</button>
      <button onClick={() => navigate('/create-password')}>restart</button>
      <button onClick={clear}>complete</button>
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

const expectNoPersistedSecrets = () => {
  const persisted = JSON.stringify({
    history: window.history.state,
    url: window.location.href,
    local: window.localStorage,
    session: window.sessionStorage,
  });
  expect(persisted).not.toContain(password);
  expect(persisted).not.toContain(phrase);
};

describe('onboarding secret lifetime', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/create-password');
    localStorage.clear();
    sessionStorage.clear();
  });

  it('passes creation secrets only in memory across the two phrase screens', () => {
    mount();
    fireEvent.click(screen.getByText('create'));
    expect(screen.getByTestId('secrets').textContent).toContain(password);
    expectNoPersistedSecrets();
    fireEvent.click(screen.getByText('confirm'));
    expect(screen.getByTestId('secrets').textContent).toContain(phrase);
    expect(window.history.state.usr).toEqual({ next: true });
    expectNoPersistedSecrets();
    fireEvent.click(screen.getByText('complete'));
    expect(screen.getByTestId('secrets').textContent).toBe('{}');
  });

  it('passes an imported phrase without browser persistence and clears on leaving', () => {
    mount();
    fireEvent.click(screen.getByText('import'));
    expect(screen.getByTestId('secrets').textContent).toContain(phrase);
    expectNoPersistedSecrets();
    fireEvent.click(screen.getByText('leave'));
    expect(screen.getByTestId('secrets').textContent).toBe('{}');
  });

  it('clears creation material when restarting, including browser back to the password page', () => {
    mount();
    fireEvent.click(screen.getByText('create'));
    fireEvent.click(screen.getByText('confirm'));
    fireEvent.click(screen.getByText('restart'));
    expect(screen.getByTestId('secrets').textContent).toBe('{}');
  });

  it('cannot recover onboarding material when a document is recreated', () => {
    const first = mount();
    fireEvent.click(screen.getByText('create'));
    fireEvent.click(screen.getByText('confirm'));
    first.unmount();
    mount();
    expect(screen.getByTestId('secrets').textContent).toBe('{}');
    expectNoPersistedSecrets();
  });

  it('discards material and exits onboarding when the page is hidden', () => {
    mount();
    fireEvent.click(screen.getByText('import'));
    fireEvent(window, new Event('pagehide'));
    expect(screen.getByTestId('secrets').textContent).toBe('{}');
    expect(screen.getByTestId('route').textContent).toBe('/');
  });

  it('does not navigate an ordinary wallet route when hidden', () => {
    window.history.replaceState(null, '', '/home');
    mount();
    fireEvent(window, new Event('pagehide'));
    expect(screen.getByTestId('route').textContent).toBe('/home');
  });

  it('discards a legacy history entry without using its secrets', () => {
    window.history.replaceState(
      { usr: { password, createdSeed: phrase, next: true } },
      '',
      '/phrase'
    );
    mount();
    expect(screen.getByTestId('secrets').textContent).toBe('{}');
    expectNoPersistedSecrets();
  });
});
