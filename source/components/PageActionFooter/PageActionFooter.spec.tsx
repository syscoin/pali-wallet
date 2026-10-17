/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { PageActionFooter } from './PageActionFooter';

it('keeps feedback and its original submit action in the same footer', () => {
  render(
    <form>
      <PageActionFooter error="Saving failed. Try again.">
        <button type="submit">Save</button>
      </PageActionFooter>
    </form>
  );
  const action = screen.getByRole('button', { name: 'Save' });
  const feedback = screen.getByRole('alert');
  expect(action.closest('[data-page-action-footer]')).toBe(
    feedback.closest('[data-page-action-footer]')
  );
  expect(action.getAttribute('type')).toBe('submit');
});

it('does not create empty feedback or change the action when no error exists', () => {
  render(
    <PageActionFooter>
      <button disabled>Save</button>
    </PageActionFooter>
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled
  ).toBe(true);
});

it('measures changing action height for native focus scrolling and cleans up', () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
  let notify: ResizeObserverCallback | undefined;
  const disconnect = jest.fn();
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: jest.fn((callback: ResizeObserverCallback) => {
      notify = callback;
      return { observe: jest.fn(), unobserve: jest.fn(), disconnect };
    }),
  });
  const container = document.createElement('div');
  container.dataset.navigationScroll = 'wallet-layout';
  container.style.setProperty('--wallet-page-action-height', '12px');
  document.body.append(container);
  const view = render(
    <PageActionFooter>
      <button>Save</button>
    </PageActionFooter>,
    { container }
  );
  try {
    const footer = container.querySelector('[data-page-action-footer]')!;
    const rect = jest.spyOn(footer, 'getBoundingClientRect');
    rect.mockReturnValue({ height: 64 } as DOMRect);
    notify?.([], {} as ResizeObserver);
    expect(
      container.style.getPropertyValue('--wallet-page-action-height')
    ).toBe('64px');
    rect.mockReturnValue({ height: 128 } as DOMRect);
    notify?.([], {} as ResizeObserver);
    expect(
      container.style.getPropertyValue('--wallet-page-action-height')
    ).toBe('128px');
    view.unmount();
    // Local keyboard scroll padding and shared toast clearance both release
    // their independent observers when the footer unmounts.
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(
      container.style.getPropertyValue('--wallet-page-action-height')
    ).toBe('12px');
  } finally {
    if (descriptor) Object.defineProperty(window, 'ResizeObserver', descriptor);
    else delete (window as any).ResizeObserver;
    container.remove();
  }
});
