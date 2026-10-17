/** @jest-environment jsdom */
import { act, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

import { useBrowsingNavigationScroll } from './useBrowsingNavigationScroll';

const Probe = ({ scope = 'scope' }: { scope?: string }) => {
  useBrowsingNavigationScroll(scope);
  return <div data-navigation-scroll="items">List</div>;
};

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
    read.mockRestore();
    write.mockRestore();
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
    read.mockRestore();
    write.mockRestore();
  }
});
