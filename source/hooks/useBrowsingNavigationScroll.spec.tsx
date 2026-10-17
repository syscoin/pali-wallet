/** @jest-environment jsdom */
import { act, fireEvent, render } from '@testing-library/react';
import React, { useState } from 'react';
import {
  MemoryRouter,
  type NavigateFunction,
  useNavigate,
} from 'react-router-dom';

import { useTokenImportNavigation } from '../pages/Tokens/useTokenImportNavigation';

import { useBrowsingNavigationScroll } from './useBrowsingNavigationScroll';

const Probe = ({ scope = 'scope' }: { scope?: string }) => {
  useBrowsingNavigationScroll(scope);
  return <div data-navigation-scroll="items">List</div>;
};

const ImportEditor = () => {
  const [tokenId, setTokenId] = useState('1');
  useTokenImportNavigation('test-import-scope', { customTokenId: tokenId });
  return (
    <>
      <Probe />
      <input
        aria-label="Token ID"
        value={tokenId}
        onChange={(event) => setTokenId(event.target.value)}
      />
    </>
  );
};

it.each([undefined, { items: 80 }])(
  'preserves scroll while mirroring import edits with inherited targets %j',
  async (scrollPositions) => {
    const view = render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/tokens/add', state: { scrollPositions } },
        ]}
      >
        <ImportEditor />
      </MemoryRouter>
    );
    const pane = view.container.querySelector<HTMLElement>(
      '[data-navigation-scroll]'
    )!;
    await act(async () => new Promise(requestAnimationFrame));
    fireEvent.wheel(pane);
    pane.scrollTop = 220;
    const field = view.getByLabelText('Token ID');
    field.focus();
    fireEvent.change(field, { target: { value: '123' } });
    await act(async () => new Promise(requestAnimationFrame));
    expect(pane.scrollTop).toBe(220);
    expect(document.activeElement).toBe(field);
  }
);

const ReplaceProbe = ({
  target = '/tokens/add',
  state,
}: {
  state?: Record<string, unknown>;
  target?: string;
}) => {
  const navigate = useNavigate();
  return (
    <>
      <Probe />
      <button onClick={() => navigate(target, { replace: true, state })}>
        Replace entry
      </button>
    </>
  );
};

it('honors an explicit same-valued restoration instead of treating it as an edit', async () => {
  const view = render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/tokens/add',
          state: {
            scrollPositions: { items: 220 },
            scrollRestorationKey: 'first-restore',
          },
        },
      ]}
    >
      <ReplaceProbe
        state={{
          scrollPositions: { items: 220 },
          scrollRestorationKey: 'explicit-back-restore',
        }}
      />
    </MemoryRouter>
  );
  const pane = view.container.querySelector<HTMLElement>(
    '[data-navigation-scroll]'
  )!;
  await act(async () => new Promise(requestAnimationFrame));
  fireEvent.wheel(pane);
  pane.scrollTop = 140;
  fireEvent.click(view.getByText('Replace entry'));
  await act(async () => new Promise(requestAnimationFrame));
  expect(pane.scrollTop).toBe(220);
});

it('resets on a same-path query-tab replacement', () => {
  const view = render(
    <MemoryRouter initialEntries={['/tokens/add?tab=yourTokens']}>
      <ReplaceProbe target="/tokens/add?tab=custom" />
    </MemoryRouter>
  );
  const pane = view.container.querySelector<HTMLElement>(
    '[data-navigation-scroll]'
  )!;
  pane.scrollTop = 220;
  fireEvent.click(view.getByText('Replace entry'));
  expect(pane.scrollTop).toBe(0);
});

it('keeps pending lazy restoration through automatic import mirrors and StrictMode replay', async () => {
  let capacity = 0;
  let scrollTop = 0;
  const read = jest
    .spyOn(HTMLElement.prototype, 'scrollTop', 'get')
    .mockImplementation(() => scrollTop);
  const write = jest
    .spyOn(HTMLElement.prototype, 'scrollTop', 'set')
    .mockImplementation((value) => {
      scrollTop = Math.min(value, capacity);
    });
  const view = render(
    <React.StrictMode>
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/tokens/add',
            state: { scrollPositions: { items: 320 } },
          },
        ]}
      >
        <ImportEditor />
      </MemoryRouter>
    </React.StrictMode>
  );
  try {
    await act(async () => new Promise(requestAnimationFrame));
    expect(scrollTop).toBe(0);
    capacity = 1000;
    await act(async () => {
      view.container
        .querySelector('[data-navigation-scroll]')!
        .append(document.createElement('div'));
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    expect(scrollTop).toBe(320);
  } finally {
    write.mockRestore();
    read.mockRestore();
  }
});

const SameRouteProbe = ({
  nextState = { id: 'next-asset' },
  scope = 'scope',
}: {
  nextState?: Record<string, unknown>;
  scope?: string;
}) => {
  const navigate = useNavigate();
  return (
    <>
      <Probe scope={scope} />
      <button onClick={() => navigate('/home/details', { state: nextState })}>
        Next asset
      </button>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
};

it('resets persistent panes when a new asset opens at the same pathname', () => {
  const view = render(
    <MemoryRouter
      initialEntries={[
        { pathname: '/home/details', state: { id: 'first-asset' } },
      ]}
    >
      <SameRouteProbe />
    </MemoryRouter>
  );
  const pane = view.container.querySelector<HTMLElement>(
    '[data-navigation-scroll]'
  )!;
  pane.scrollTop = 220;
  fireEvent.click(view.getByText('Next asset'));
  expect(pane.scrollTop).toBe(0);
});

it("does not apply another wallet scope's same-route scroll state", () => {
  const view = render(
    <MemoryRouter initialEntries={['/home/details']}>
      <SameRouteProbe
        scope={JSON.stringify({ account: 'selected-account' })}
        nextState={{
          id: 'other-asset',
          walletScope: { account: 'other-account' },
          scrollPositions: { items: 500 },
        }}
      />
    </MemoryRouter>
  );
  const pane = view.container.querySelector<HTMLElement>(
    '[data-navigation-scroll]'
  )!;
  pane.scrollTop = 220;
  fireEvent.click(view.getByText('Next asset'));
  expect(pane.scrollTop).toBe(220);
});

it('preserves explicit scroll restoration when returning to the same pathname', async () => {
  const view = render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/home/details',
          state: { id: 'first-asset', scrollPositions: { items: 220 } },
        },
      ]}
    >
      <SameRouteProbe />
    </MemoryRouter>
  );
  const pane = view.container.querySelector<HTMLElement>(
    '[data-navigation-scroll]'
  )!;
  await act(async () => {
    await new Promise(requestAnimationFrame);
  });
  expect(pane.scrollTop).toBe(220);
  fireEvent.click(view.getByText('Next asset'));
  expect(pane.scrollTop).toBe(0);
  pane.scrollTop = 140;
  fireEvent.click(view.getByText('Back'));
  await act(async () => {
    await new Promise(requestAnimationFrame);
  });
  expect(pane.scrollTop).toBe(220);
});

const BrowserHistoryProbe = ({ scope = 'scope' }: { scope?: string }) => {
  const navigate = useNavigate();
  return (
    <>
      <Probe scope={scope} />
      <button onClick={() => navigate('/settings/edit-account')}>
        Open editor
      </button>
      <button onClick={() => navigate(-1)}>Browser Back</button>
      <button onClick={() => navigate(1)}>Browser Forward</button>
    </>
  );
};

it('restores native browser Back and Forward positions without explicit return metadata', async () => {
  const view = render(
    <React.StrictMode>
      <MemoryRouter initialEntries={['/settings/manage-accounts']}>
        <BrowserHistoryProbe />
      </MemoryRouter>
    </React.StrictMode>
  );
  const pane = view.container.querySelector<HTMLElement>(
    '[data-navigation-scroll]'
  )!;
  pane.scrollTop = 220;
  fireEvent.scroll(pane);
  fireEvent.click(view.getByText('Open editor'));
  expect(pane.scrollTop).toBe(0);
  pane.scrollTop = 140;
  fireEvent.scroll(pane);
  fireEvent.click(view.getByText('Browser Back'));
  await act(async () => new Promise(requestAnimationFrame));
  expect(pane.scrollTop).toBe(220);
  fireEvent.click(view.getByText('Browser Forward'));
  await act(async () => new Promise(requestAnimationFrame));
  expect(pane.scrollTop).toBe(140);
});

const ControlledHistoryProbe = ({
  scope = 'scope',
  onNavigate,
}: {
  onNavigate: (navigate: NavigateFunction) => void;
  scope?: string;
}) => {
  onNavigate(useNavigate());
  return <Probe scope={scope} />;
};

it('retains native history positions across same-page field replacements', async () => {
  let navigate!: NavigateFunction;
  const view = render(
    <MemoryRouter initialEntries={['/tokens/add']}>
      <ControlledHistoryProbe
        onNavigate={(next) => {
          navigate = next;
        }}
      />
    </MemoryRouter>
  );
  const pane = view.container.querySelector<HTMLElement>(
    '[data-navigation-scroll]'
  )!;
  pane.scrollTop = 220;
  fireEvent.scroll(pane);
  act(() =>
    navigate('/tokens/add', { replace: true, state: { customTokenId: '2' } })
  );
  expect(pane.scrollTop).toBe(220);
  act(() => navigate('/home/details'));
  act(() => navigate(-1));
  await act(async () => new Promise(requestAnimationFrame));
  expect(pane.scrollTop).toBe(220);
});

it.each(['account', 'network'])(
  'keeps native history caches isolated when %s changes',
  async (part) => {
    let navigate!: NavigateFunction;
    const initial = { account: 'account-a', network: 'network-a' };
    const tree = (scope: typeof initial) => (
      <MemoryRouter initialEntries={['/home']}>
        <ControlledHistoryProbe
          scope={JSON.stringify(scope)}
          onNavigate={(next) => {
            navigate = next;
          }}
        />
      </MemoryRouter>
    );
    const view = render(tree(initial));
    const pane = view.container.querySelector<HTMLElement>(
      '[data-navigation-scroll]'
    )!;
    pane.scrollTop = 220;
    fireEvent.scroll(pane);
    view.rerender(tree({ ...initial, [part]: part + '-b' }));
    expect(pane.scrollTop).toBe(0);
    pane.scrollTop = 70;
    fireEvent.scroll(pane);
    act(() => navigate('/receive'));
    act(() => navigate(-1));
    await act(async () => new Promise(requestAnimationFrame));
    expect(pane.scrollTop).toBe(70);
  }
);

it('caps remembered native history and evicts the oldest entry instead of growing unbounded', async () => {
  let navigate!: NavigateFunction;
  const view = render(
    <MemoryRouter initialEntries={['/home']}>
      <ControlledHistoryProbe
        onNavigate={(next) => {
          navigate = next;
        }}
      />
    </MemoryRouter>
  );
  const pane = view.container.querySelector<HTMLElement>(
    '[data-navigation-scroll]'
  )!;
  for (let id = 0; id <= 40; id++) {
    if (id) act(() => navigate('/entry-' + id));
    pane.scrollTop = 100 + id;
    fireEvent.scroll(pane);
  }
  act(() => navigate(-39));
  await act(async () => new Promise(requestAnimationFrame));
  expect(pane.scrollTop).toBe(101);
  act(() => navigate(-1));
  await act(async () => new Promise(requestAnimationFrame));
  expect(pane.scrollTop).toBe(0);
});

it('honors explicit Back targets instead of remembered native positions', async () => {
  let navigate!: NavigateFunction;
  const view = render(
    <MemoryRouter initialEntries={['/home']}>
      <ControlledHistoryProbe
        onNavigate={(next) => {
          navigate = next;
        }}
      />
    </MemoryRouter>
  );
  const pane = view.container.querySelector<HTMLElement>(
    '[data-navigation-scroll]'
  )!;
  pane.scrollTop = 220;
  fireEvent.scroll(pane);
  act(() => navigate('/home/details'));
  act(() =>
    navigate('/home', {
      replace: true,
      state: {
        scrollPositions: { items: 40 },
        scrollRestorationKey: 'explicit-back',
      },
    })
  );
  await act(async () => new Promise(requestAnimationFrame));
  expect(pane.scrollTop).toBe(40);
});

it.each(['arrive', 'navigate away', 'unmount'])(
  'handles remembered history with lazy content when rows %s',
  async (finish) => {
    let navigate!: NavigateFunction;
    let capacity = 1000;
    let top = 0;
    const read = jest
      .spyOn(HTMLElement.prototype, 'scrollTop', 'get')
      .mockImplementation(() => top);
    const write = jest
      .spyOn(HTMLElement.prototype, 'scrollTop', 'set')
      .mockImplementation((value) => {
        top = Math.min(capacity, value);
      });
    const view = render(
      <React.StrictMode>
        <MemoryRouter initialEntries={['/home']}>
          <ControlledHistoryProbe
            onNavigate={(next) => {
              navigate = next;
            }}
          />
        </MemoryRouter>
      </React.StrictMode>
    );
    try {
      const pane = view.container.querySelector<HTMLElement>(
        '[data-navigation-scroll]'
      )!;
      pane.scrollTop = 320;
      fireEvent.scroll(pane);
      act(() => navigate('/receive'));
      capacity = 0;
      act(() => navigate(-1));
      await act(async () => new Promise(requestAnimationFrame));
      expect(top).toBe(0);
      if (finish === 'navigate away') act(() => navigate('/settings/about'));
      if (finish === 'unmount') view.unmount();
      capacity = 1000;
      await act(async () => {
        document.body.append(document.createElement('div'));
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      expect(top).toBe(finish === 'arrive' ? 320 : 0);
    } finally {
      view.unmount();
      write.mockRestore();
      read.mockRestore();
    }
  }
);

it('restores a marked nested pane after lazy rows arrive and stops on user input', async () => {
  let capacity = 0;
  let scrollTop = 0;
  const read = jest
    .spyOn(HTMLElement.prototype, 'scrollTop', 'get')
    .mockImplementation(() => scrollTop);
  const write = jest
    .spyOn(HTMLElement.prototype, 'scrollTop', 'set')
    .mockImplementation((value) => {
      scrollTop = Math.min(value, capacity);
    });
  const view = render(
    <MemoryRouter
      initialEntries={[
        { pathname: '/home', state: { scrollPositions: { items: 320 } } },
      ]}
    >
      <Probe />
    </MemoryRouter>
  );
  try {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(scrollTop).toBe(0);
    capacity = 1000;
    await act(async () => {
      view.container
        .querySelector('[data-navigation-scroll]')!
        .append(document.createElement('div'));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(scrollTop).toBe(320);
    fireEvent.wheel(view.container);
    scrollTop = 140;
    await act(async () => {
      view.container
        .querySelector('[data-navigation-scroll]')!
        .append(document.createElement('div'));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(scrollTop).toBe(140);
  } finally {
    write.mockRestore();
    read.mockRestore();
  }
});
it('cancels pending restoration as soon as the user scrolls', async () => {
  let scrollTop = 0;
  let capacity = 0;
  const read = jest
    .spyOn(HTMLElement.prototype, 'scrollTop', 'get')
    .mockImplementation(() => scrollTop);
  const write = jest
    .spyOn(HTMLElement.prototype, 'scrollTop', 'set')
    .mockImplementation((value) => {
      scrollTop = Math.min(value, capacity);
    });
  const view = render(
    <MemoryRouter
      initialEntries={[
        { pathname: '/home', state: { scrollPositions: { items: 500 } } },
      ]}
    >
      <Probe />
    </MemoryRouter>
  );
  try {
    fireEvent.wheel(view.container);
    capacity = 1000;
    await act(async () => {
      view.container
        .querySelector('[data-navigation-scroll]')!
        .append(document.createElement('div'));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(scrollTop).toBe(0);
  } finally {
    write.mockRestore();
    read.mockRestore();
  }
});
