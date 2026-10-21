/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { Tooltip } from './Tooltip';

const PAYLOAD = `0x${'ab'.repeat(2048)}`;
const KEYS = [
  ['ArrowUp', 80, 40],
  ['ArrowDown', 80, 120],
  ['PageUp', 600, 300],
  ['PageDown', 600, 900],
  ['Home', 600, 0],
  ['End', 600, 1500],
] as const;

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function layout(
  region: HTMLElement,
  height: number,
  contentHeight: number,
  start = 0
) {
  let position = start;
  Object.defineProperties(region, {
    clientHeight: { configurable: true, value: height },
    scrollHeight: { configurable: true, value: contentHeight },
    // Match the browser's native clamping of scrollTop assignments.
    scrollTop: {
      configurable: true,
      get: () => position,
      set: (next: number) => {
        position = Math.max(0, Math.min(contentHeight - height, next));
      },
    },
  });
}

async function open({
  focusable = true,
  content = PAYLOAD,
  withCopy = false,
} = {}) {
  const bubbled = jest.fn();
  const copy = jest.fn();
  const user = userEvent.setup();
  render(
    <div onKeyDown={bubbled}>
      <button type="button">Before</button>
      <div className="tippy-content">
        <div>
          <div data-testid="unrelated-scroll-region" />
        </div>
      </div>
      <Tooltip content={content} focusable={focusable}>
        <span>Preview</span>
        {withCopy && (
          <button type="button" onClick={copy}>
            Copy
          </button>
        )}
      </Tooltip>
      <button type="button">After</button>
    </div>
  );
  const reference = screen.getByText('Preview').parentElement!;
  if (focusable) {
    await user.tab();
    await user.tab();
    expect(reference).toHaveFocus();
  } else await user.hover(reference);
  const tooltip = await screen.findByRole('tooltip');
  const region = within(tooltip).getByText(content, { exact: true });
  bubbled.mockClear();
  return { user, reference, tooltip, region, bubbled, copy };
}

function key(reference: HTMLElement, value: string) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    reference.dispatchEvent(event);
  });
  return event;
}

it('bounds only opted-in content while retaining the exact text and aria description', async () => {
  const { reference, tooltip, region } = await open();
  expect(region.parentElement?.parentElement).toHaveClass('tippy-content');
  expect(region.style.maxHeight).toBe('50vh');
  expect(region.style.overflowY).toBe('auto');
  expect(region.textContent).toBe(PAYLOAD);
  expect(
    document.getElementById(reference.getAttribute('aria-describedby')!)
  ).toContainElement(tooltip);
});

it.each(KEYS)(
  'scrolls its own overflowing region with %s while retaining focus',
  async (value, start, expected) => {
    const { reference, region, bubbled } = await open();
    const unrelated = screen.getByTestId('unrelated-scroll-region');
    layout(region, 300, 1800, start);
    layout(unrelated, 300, 1800, 100);
    expect(key(reference, value).defaultPrevented).toBe(true);
    expect(region.scrollTop).toBe(expected);
    expect(unrelated.scrollTop).toBe(100);
    expect(reference).toHaveFocus();
    expect(bubbled).not.toHaveBeenCalled();
  }
);

it('does not intercept scrolling keys when short content does not overflow', async () => {
  const { reference, region, bubbled } = await open({
    content: 'Short complete value',
  });
  layout(region, 40, 40);
  for (const [value] of KEYS)
    expect(key(reference, value).defaultPrevented).toBe(false);
  expect(region.scrollTop).toBe(0);
  expect(bubbled).toHaveBeenCalledTimes(KEYS.length);
  expect(reference).toHaveFocus();
});

it('leaves non-focusable Tooltip content and ordinary Tab order unchanged', async () => {
  const { reference, region, user } = await open({ focusable: false });
  expect(reference).not.toHaveAttribute('tabindex');
  expect(region.parentElement?.parentElement).toHaveClass('tippy-content');
  expect(region.style.maxHeight).toBe('');
  expect(region.style.overflowY).toBe('');
  await user.tab();
  expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
});

it('retains Escape dismissal and focus after opening an overflowing disclosure', async () => {
  const { reference, region, tooltip, user } = await open();
  layout(region, 300, 1800);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(tooltip).not.toBeVisible());
  expect(reference).toHaveFocus();
  expect(reference).not.toHaveAttribute('aria-describedby');
});

it('does not consume Enter from the separate native copy button', async () => {
  const { reference, region, user, copy } = await open({ withCopy: true });
  layout(region, 300, 1800, 100);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Copy' })).toHaveFocus();
  await user.hover(reference);
  await user.keyboard('{Enter}');
  expect(copy).toHaveBeenCalledTimes(1);
  expect(region.scrollTop).toBe(100);
});
