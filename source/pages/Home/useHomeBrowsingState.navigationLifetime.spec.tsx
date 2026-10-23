/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { Suspense, useEffect, useState } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';

import { useSafeNavigate } from 'hooks/useSafeNavigate';

import { useHomeBrowsingState } from './useHomeBrowsingState';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function HistoryList() {
  const [view, setView] = useHomeBrowsingState(
    'homeActivity',
    'account-a:network-a',
    {
      nextPage: 2,
      visibleCount: 50,
    }
  );
  const [assets, setAssets] = useHomeBrowsingState(
    'homeAssets',
    'account-a:network-a',
    {
      searchValue: '',
    }
  );
  const location = useLocation();
  return (
    <>
      <output data-testid="history-route">{location.pathname}</output>
      <output data-testid="saved-home-state">
        {JSON.stringify(location.state?.homeActivity)}
      </output>
      <output data-testid="saved-assets-state">
        {JSON.stringify(location.state?.homeAssets)}
      </output>
      <button
        type="button"
        onClick={() => setView({ ...view, visibleCount: 100 })}
      >
        More history
      </button>
      <button
        type="button"
        onClick={() => setAssets({ ...assets, searchValue: 'TOKEN' })}
      >
        Filter assets
      </button>
    </>
  );
}

function Home({ read }: { read: Promise<void> }) {
  const [ready, setReady] = useState(false);
  const navigate = useSafeNavigate();
  const location = useLocation();
  useEffect(() => {
    let current = true;
    void read.then(() => {
      if (current) setReady(true);
    });
    return () => {
      current = false;
    };
  }, [read]);
  return (
    <>
      <button type="button" onClick={() => navigate('/send/eth')}>
        Send
      </button>
      <output data-testid="home-route">{location.pathname}</output>
      {ready ? <HistoryList /> : <p>History pending</p>}
    </>
  );
}

function setup() {
  const read = deferred<void>();
  const sendModule = deferred<{ default: React.ComponentType }>();
  const Send = React.lazy(() => sendModule.promise);
  render(
    <HashRouter>
      <Suspense fallback={<p>Route pending</p>}>
        <Routes>
          <Route path="/home" element={<Home read={read.promise} />} />
          <Route path="/send/eth" element={<Send />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
  return { read, sendModule, user: userEvent.setup() };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/app.html#/home');
});
afterEach(() => cleanup());

it('healthy Home history state persists in the same route without adding a history entry', async () => {
  const { read, user } = setup();
  const length = window.history.length;
  await act(async () => read.resolve());
  await waitFor(() =>
    expect(screen.getByTestId('saved-home-state')).toHaveTextContent(
      '"visibleCount":50'
    )
  );
  await user.click(screen.getByRole('button', { name: 'More history' }));
  await waitFor(() =>
    expect(screen.getByTestId('saved-home-state')).toHaveTextContent(
      '"visibleCount":100'
    )
  );
  await user.click(screen.getByRole('button', { name: 'Filter assets' }));
  await waitFor(() =>
    expect(screen.getByTestId('saved-assets-state')).toHaveTextContent(
      '"searchValue":"TOKEN"'
    )
  );
  expect(screen.getByTestId('saved-home-state')).toHaveTextContent(
    '"visibleCount":100'
  );
  expect(window.location.hash).toBe('#/home');
  expect(screen.getByTestId('history-route')).toHaveTextContent('/home');
  expect(window.history.length).toBe(length);
});

it('late Home history mount cannot overwrite a genuine pending Send navigation', async () => {
  const { read, sendModule, user } = setup();
  try {
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(window.location.hash).toBe('#/send/eth');
    // The actual transition retains the old route while the real lazy module
    // is pending. No location, navigate function or production hook is mocked.
    expect(screen.getByTestId('home-route')).toHaveTextContent('/home');
    const before = {
      hash: window.location.hash,
      reactHome: screen.getByTestId('home-route').textContent,
    };
    await act(async () => read.resolve());
    await screen.findByRole('button', { name: 'More history' });
    const after = {
      hash: window.location.hash,
      reactHome: screen.getByTestId('home-route').textContent,
      homeActivity: window.history.state?.usr?.homeActivity,
    };
    console.info(
      'home_browsing_navigation_lifetime=' + JSON.stringify({ before, after })
    );
    expect(window.location.hash).toBe('#/send/eth');
  } finally {
    await act(async () =>
      sendModule.resolve({ default: () => <p>Send ready</p> })
    );
  }
});
