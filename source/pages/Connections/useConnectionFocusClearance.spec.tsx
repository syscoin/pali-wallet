/** @jest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import React from 'react';

import { useConnectionFocusClearance } from 'pages/Connections/useConnectionFocusClearance';

const property = 'scroll-padding-bottom';
const descriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'ResizeObserver'
);
type ObserverRecord = {
  callback: ResizeObserverCallback;
  disconnect: jest.Mock;
  observe: jest.Mock;
};
let observers: ObserverRecord[];
let footerHeight: number;
let hosts: HTMLElement[];

const Harness = ({
  footer = true,
  root = true,
  context = 'initial-network',
}: {
  context?: string;
  footer?: boolean;
  root?: boolean;
}) => {
  const ref = useConnectionFocusClearance();
  return root ? (
    <div ref={ref} data-network-context={context}>
      <input aria-label="Account search" />
      {footer && (
        <div data-connection-actions>
          <button>Cancel</button>
          <button>Confirm</button>
        </div>
      )}
    </div>
  ) : null;
};

const host = (scrollport = true) => {
  const element = document.createElement('div');
  if (scrollport) element.dataset.navigationScroll = 'wallet-layout';
  document.body.append(element);
  hosts.push(element);
  return element;
};

const notify = () =>
  act(() => {
    for (const observer of observers)
      observer.callback([], observer as unknown as ResizeObserver);
  });

const resize = () =>
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });

beforeEach(() => {
  hosts = [];
  observers = [];
  footerHeight = 64.2;
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: jest.fn((callback: ResizeObserverCallback) => {
      const observer = {
        callback,
        disconnect: jest.fn(),
        observe: jest.fn(),
      };
      observers.push(observer);
      return observer;
    }),
  });
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return {
        height: this.hasAttribute('data-connection-actions')
          ? footerHeight
          : 1000,
      } as DOMRect;
    });
});

afterEach(() => {
  cleanup();
  hosts.forEach((element) => element.remove());
  jest.restoreAllMocks();
  if (descriptor)
    Object.defineProperty(globalThis, 'ResizeObserver', descriptor);
  else delete (globalThis as any).ResizeObserver;
});

it('measures the actual footer on the nearest wallet scrollport only', () => {
  const outer = host();
  outer.style.setProperty(property, '7px', 'important');
  const nearest = document.createElement('div');
  nearest.dataset.navigationScroll = 'wallet-layout';
  outer.append(nearest);
  const unrelated = host();
  unrelated.style.setProperty(property, '19px', 'important');
  render(<Harness />, { container: nearest });
  expect(nearest.style.getPropertyValue(property)).toBe('calc(65px + 1rem)');
  expect(outer.style.getPropertyValue(property)).toBe('7px');
  expect(outer.style.getPropertyPriority(property)).toBe('important');
  expect(unrelated.style.getPropertyValue(property)).toBe('19px');
  expect(unrelated.style.getPropertyPriority(property)).toBe('important');
  expect(observers).toHaveLength(1);
  expect(observers[0].observe).toHaveBeenCalledTimes(1);
  expect(observers[0].observe).toHaveBeenCalledWith(
    nearest.querySelector('[data-connection-actions]')
  );
});

it('updates for actual footer ResizeObserver delivery and window resize', () => {
  const container = host();
  render(<Harness />, { container });
  footerHeight = 128;
  notify();
  expect(container.style.getPropertyValue(property)).toBe('calc(128px + 1rem)');
  footerHeight = 95.1;
  resize();
  expect(container.style.getPropertyValue(property)).toBe('calc(96px + 1rem)');
});

it.each([
  { previous: '', priority: '' },
  { previous: '12px', priority: 'important' },
])(
  'restores prior inline value and priority: $previous $priority',
  ({ previous, priority }) => {
    const container = host();
    if (previous) container.style.setProperty(property, previous, priority);
    const add = jest.spyOn(window, 'addEventListener');
    const remove = jest.spyOn(window, 'removeEventListener');
    const view = render(<Harness />, { container });
    const subscription = add.mock.calls.find(([event]) => event === 'resize');
    expect(subscription).toBeDefined();
    expect(container.style.getPropertyValue(property)).toBe(
      'calc(65px + 1rem)'
    );
    view.unmount();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls).toContainEqual(subscription);
    expect(container.style.getPropertyValue(property)).toBe(previous);
    expect(container.style.getPropertyPriority(property)).toBe(priority);
    // ResizeObserver may have queued a delivery before disconnect. Neither that
    // delivery nor a later resize may reclaim padding after the route unmounts.
    footerHeight = 200;
    notify();
    resize();
    expect(container.style.getPropertyValue(property)).toBe(previous);
    expect(container.style.getPropertyPriority(property)).toBe(priority);
  }
);

it.each(['value', 'priority'] as const)(
  'does not erase a later owner that changed only the %s',
  (change) => {
    const container = host();
    container.style.setProperty(property, '12px', 'important');
    const view = render(<Harness />, { container });
    const assigned = container.style.getPropertyValue(property);
    const assignedPriority = container.style.getPropertyPriority(property);
    const replacement = change === 'value' ? '209px' : assigned;
    const replacementPriority =
      change === 'priority'
        ? assignedPriority === 'important'
          ? ''
          : 'important'
        : assignedPriority;
    container.style.setProperty(property, replacement, replacementPriority);
    view.unmount();
    expect(container.style.getPropertyValue(property)).toBe(replacement);
    expect(container.style.getPropertyPriority(property)).toBe(
      replacementPriority
    );
    notify();
    resize();
    expect(container.style.getPropertyValue(property)).toBe(replacement);
    expect(container.style.getPropertyPriority(property)).toBe(
      replacementPriority
    );
  }
);

it('retains one measurement owner through same-route context rerenders', () => {
  const container = host();
  container.style.setProperty(property, '11px', 'important');
  const view = render(<Harness />, { container });
  view.rerender(<Harness context="updated-network-object" />);
  expect(observers).toHaveLength(1);
  footerHeight = 80;
  notify();
  expect(container.style.getPropertyValue(property)).toBe('calc(80px + 1rem)');
  view.unmount();
  expect(container.style.getPropertyValue(property)).toBe('11px');
  expect(container.style.getPropertyPriority(property)).toBe('important');
});

it('keeps resize fallback and cleanup when ResizeObserver is unavailable', () => {
  delete (globalThis as any).ResizeObserver;
  const container = host();
  const view = render(<Harness />, { container });
  expect(container.style.getPropertyValue(property)).toBe('calc(65px + 1rem)');
  expect(observers).toEqual([]);
  footerHeight = 100;
  resize();
  expect(container.style.getPropertyValue(property)).toBe('calc(100px + 1rem)');
  view.unmount();
  expect(container.style.getPropertyValue(property)).toBe('');
  footerHeight = 200;
  resize();
  expect(container.style.getPropertyValue(property)).toBe('');
});

it.each(['root', 'footer', 'scrollport'] as const)(
  'is inert when the %s is unavailable; it never borrows an unrelated scrollport',
  (missing) => {
    const unrelated = host();
    unrelated.style.setProperty(property, '17px', 'important');
    const container = host(missing !== 'scrollport');
    const view = render(
      <Harness root={missing !== 'root'} footer={missing !== 'footer'} />,
      { container }
    );
    expect(observers).toEqual([]);
    expect(container.style.getPropertyValue(property)).toBe('');
    resize();
    view.unmount();
    expect(container.style.getPropertyValue(property)).toBe('');
    expect(unrelated.style.getPropertyValue(property)).toBe('17px');
    expect(unrelated.style.getPropertyPriority(property)).toBe('important');
  }
);
