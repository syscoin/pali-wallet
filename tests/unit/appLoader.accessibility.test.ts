/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';
import { runInNewContext } from 'vm';

const source = fs.readFileSync(
  path.join(process.cwd(), 'source/assets/js/appLoader.js'),
  'utf8'
);
let readyListener: EventListener | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  document.body.className = '';
  document.body.innerHTML =
    '<div id="initial-loader"><h1>Pali</h1></div><main id="app-root"></main>';
  const add = window.addEventListener.bind(window);
  jest
    .spyOn(window, 'addEventListener')
    .mockImplementation((name, listener, options) => {
      if (name === 'pali-app-ready') readyListener = listener as EventListener;
      add(name, listener, options);
    });
  // Execute the shipped bootstrap with only its browser-view classification stubbed.
  runInNewContext(source, {
    document,
    window,
    performance,
    setTimeout,
    clearTimeout,
    chrome: { extension: { getViews: () => [] } },
  });
});

afterEach(() => {
  if (readyListener)
    window.removeEventListener('pali-app-ready', readyListener);
  readyListener = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

it('keeps the startup loader available until the application is ready', () => {
  const loader = document.getElementById('initial-loader')!;
  expect(loader).not.toHaveAttribute('aria-hidden');
  expect(loader).not.toHaveAttribute('inert');
  jest.advanceTimersByTime(1800);
  expect(loader.querySelector('button')).toHaveTextContent('Reload wallet');
});

it('retires the loader and its slow-start recovery control when the application becomes ready', () => {
  const loader = document.getElementById('initial-loader')!;
  jest.advanceTimersByTime(1800);
  expect(loader.querySelector('button')).not.toBeNull();
  window.dispatchEvent(new Event('pali-app-ready'));
  expect(document.body).toHaveClass('app-loaded');
  expect(loader).toHaveAttribute('aria-hidden', 'true');
  expect(loader).toHaveProperty('inert', true);
});

it('does not append an invisible recovery control after a fast startup', () => {
  window.dispatchEvent(new Event('pali-app-ready'));
  jest.advanceTimersByTime(5000);
  expect(document.querySelector('#initial-loader button')).toBeNull();
});
