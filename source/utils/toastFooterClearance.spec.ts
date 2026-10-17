/** @jest-environment jsdom */
import { registerToastFooter } from './toastFooterClearance';

const property = '--pali-toast-footer-clearance';
let callbacks: Map<number, FrameRequestCallback>;
let nextId = 0;
let resize: () => void;
let disconnect: jest.Mock;
const cleanups: (() => void)[] = [];
const originalResizeObserver = global.ResizeObserver;
afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
});

const footer = (top: number, height: number, position = 'fixed') => {
  const node = document.createElement('div');
  node.style.position = position;
  node.style.visibility = 'visible';
  node.style.opacity = '1';
  node.getBoundingClientRect = () => ({
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
  document.body.append(node);
  return node;
};
const register = (node: HTMLElement) => {
  const cleanup = registerToastFooter(node);
  cleanups.push(cleanup);
  return cleanup;
};
const flushFrame = () => {
  const queue = [...callbacks.values()];
  callbacks.clear();
  queue.forEach((callback) => callback(0));
};
const clearance = () =>
  document.documentElement.style.getPropertyValue(property);

beforeEach(() => {
  callbacks = new Map();
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 360,
  });
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 320,
  });
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    callbacks.delete(id);
  });
  disconnect = jest.fn();
  global.ResizeObserver = jest.fn().mockImplementation((callback) => {
    resize = callback;
    return { observe: jest.fn(), unobserve: jest.fn(), disconnect };
  });
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
  document.documentElement.style.removeProperty(property);
  jest.restoreAllMocks();
});

it('reserves the largest visible obstruction, including a bottom offset, not the sum', () => {
  register(footer(304, 40));
  expect(clearance()).toBe('56px');
  const removeSecond = register(footer(260, 100, 'sticky'));
  expect(clearance()).toBe('100px');
  removeSecond();
  expect(clearance()).toBe('56px');
});

it('remeasures translated feedback and resizing, coalescing queued events', () => {
  const node = footer(300, 60);
  register(node);
  node.getBoundingClientRect = footer(230, 130).getBoundingClientRect;
  resize();
  window.dispatchEvent(new Event('resize'));
  document.dispatchEvent(new Event('scroll'));
  expect(callbacks.size).toBe(1);
  flushFrame();
  expect(clearance()).toBe('130px');
});

it('ignores hidden, offscreen, disconnected and ordinary in-flow footers', () => {
  register(footer(280, 80, 'relative'));
  register(footer(400, 60));
  const hidden = footer(260, 100);
  hidden.style.display = 'none';
  register(hidden);
  const transparent = footer(270, 90);
  transparent.style.opacity = '0';
  register(transparent);
  const disconnected = footer(250, 110);
  disconnected.remove();
  register(disconnected);
  expect(clearance()).toBe('0px');
});

it('restores prior root state and cancels callbacks after the last unmount', () => {
  document.documentElement.style.setProperty(property, '12px');
  const remove = register(footer(300, 60));
  resize();
  expect(callbacks.size).toBe(1);
  remove();
  expect(clearance()).toBe('12px');
  expect(callbacks.size).toBe(0);
  expect(disconnect).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('resize'));
  expect(callbacks.size).toBe(0);
});

it('does not overwrite a newer external root assignment during cleanup', () => {
  const remove = register(footer(300, 60));
  document.documentElement.style.setProperty(property, '17px');
  remove();
  expect(clearance()).toBe('17px');
});

it('does not mutate root styles again when scrolling leaves clearance unchanged', () => {
  register(footer(300, 60));
  const setProperty = jest.spyOn(document.documentElement.style, 'setProperty');
  document.dispatchEvent(new Event('scroll'));
  resize();
  flushFrame();
  expect(setProperty).not.toHaveBeenCalled();
});
