/** @jest-environment jsdom */
import { act, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { useBrowsingNavigationScroll } from './useBrowsingNavigationScroll';

const Probe = ({ scope = 'scope' }: { scope?: string }) => {
  useBrowsingNavigationScroll(scope);
  return <div data-navigation-scroll="items">List</div>;
};
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
