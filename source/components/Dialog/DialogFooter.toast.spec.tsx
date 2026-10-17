/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';

import { DialogFooter } from './Dialog';

jest.mock('components/Button', () => ({ Button: () => null }));

const property = '--pali-toast-footer-clearance';
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
let resizeCallbacks: ResizeObserverCallback[];
const resizeDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'ResizeObserver'
);
const heightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');

const setRect = (node: HTMLElement, top: number, height: number) => {
  node.style.position = 'static';
  node.style.visibility = 'visible';
  node.style.opacity = '1';
  jest.spyOn(node, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 320,
    width: 320,
    height,
    toJSON: () => undefined,
  });
};

const flush = () => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
};

beforeEach(() => {
  frames = new Map();
  resizeCallbacks = [];
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 360,
  });
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: jest.fn((callback: ResizeObserverCallback) => {
      resizeCallbacks.push(callback);
      return {
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
      };
    }),
  });
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty(property);
  jest.restoreAllMocks();
  for (const [key, descriptor] of [
    ['ResizeObserver', resizeDescriptor],
    ['innerHeight', heightDescriptor],
    ['innerWidth', widthDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(window, key, descriptor);
    else delete (window as any)[key];
  }
});

it('reserves space above a static modal footer without changing its button behavior', () => {
  const cancel = jest.fn();
  const confirm = jest.fn();
  const submit = jest.fn((event) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <DialogFooter>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
        <button type="submit" disabled onClick={confirm}>
          Confirm
        </button>
      </DialogFooter>
    </form>
  );
  const cancelButton = screen.getByRole('button', { name: 'Cancel' });
  setRect(cancelButton.closest('footer')!, 240, 104);
  act(() => {
    window.dispatchEvent(new Event('resize'));
    flush();
  });
  expect(document.documentElement.style.getPropertyValue(property)).toBe(
    '120px'
  );
  fireEvent.click(cancelButton);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

it('keeps the remaining footer clearance and retires queued work after StrictMode unmount', () => {
  document.documentElement.style.setProperty(property, '12px');
  const contents = (second: boolean) => (
    <React.StrictMode>
      <section key="first">
        <DialogFooter>
          <button>First</button>
        </DialogFooter>
      </section>
      {second && (
        <section key="second">
          <DialogFooter>
            <button>Second</button>
          </DialogFooter>
        </section>
      )}
    </React.StrictMode>
  );
  const view = render(contents(true));
  setRect(
    screen.getByRole('button', { name: 'First' }).closest('footer')!,
    260,
    84
  );
  setRect(
    screen.getByRole('button', { name: 'Second' }).closest('footer')!,
    230,
    114
  );
  act(() => {
    window.dispatchEvent(new Event('resize'));
    flush();
  });
  expect(document.documentElement.style.getPropertyValue(property)).toBe(
    '130px'
  );
  view.rerender(contents(false));
  expect(document.documentElement.style.getPropertyValue(property)).toBe(
    '100px'
  );
  window.dispatchEvent(new Event('resize'));
  expect(frames.size).toBe(1);
  view.unmount();
  expect(frames.size).toBe(0);
  expect(document.documentElement.style.getPropertyValue(property)).toBe(
    '12px'
  );
  act(() => {
    resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
    window.dispatchEvent(new Event('resize'));
    flush();
  });
  expect(frames.size).toBe(0);
  expect(document.documentElement.style.getPropertyValue(property)).toBe(
    '12px'
  );
});
