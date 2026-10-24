/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { ellipsis } from 'utils/format';

import { AddressText, IAddressText } from './AddressText';

const mockCopy = jest.fn();
const mockInfo = jest.fn();
const mockTranslate = (key: string) => key;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    alert: { info: mockInfo },
    useCopyClipboard: () => [false, mockCopy, () => true],
  }),
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
// Deliberately do not mock AddressText, Tooltip, Tippy or native focus events.
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const frame = (props: Partial<IAddressText> = {}, onKeyDown = jest.fn()) => (
  <div onKeyDown={onKeyDown}>
    <button type="button">Before</button>
    <AddressText value={A} preset="short" copyable={false} {...props} />
    <button type="button">After</button>
  </div>
);
const reference = (value = A) =>
  screen.getByText(ellipsis(value, 4, 4), { exact: true }).parentElement!;

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it('opts a non-copyable short address into real hover, Tab, Shift+Tab and Escape disclosure', async () => {
  const user = userEvent.setup();
  render(frame({ tooltipFocusable: true }));
  const node = reference();
  expect(node).toHaveAttribute('tabindex', '0');
  expect(node).toHaveClass('focus-visible:outline-2');
  expect(screen.queryByRole('button', { name: 'buttons.copy' })).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();

  await user.hover(node);
  const hover = await screen.findByRole('tooltip');
  expect(within(hover).getByText(A, { exact: true })).toBeVisible();
  // JSDOM has zero-sized layout boxes; move outside Tippy's real 2px
  // interactive border instead of leaving the pointer at its default (0, 0).
  await user.pointer({
    target: document.body,
    coords: { clientX: 100, clientY: 100 },
  });
  await waitFor(() => expect(hover).not.toBeVisible());

  await user.tab();
  expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
  await user.tab();
  expect(node).toHaveFocus();
  const focused = await screen.findByRole('tooltip');
  expect(within(focused).getByText(A, { exact: true })).toBeVisible();
  expect(
    document.getElementById(node.getAttribute('aria-describedby')!)
  ).toContainElement(focused);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(focused).not.toBeVisible());
  expect(node).toHaveFocus();
  expect(node).not.toHaveAttribute('aria-describedby');

  await user.tab();
  expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(node).toHaveFocus();
  const reopened = await screen.findByRole('tooltip');
  expect(within(reopened).getByText(A, { exact: true })).toBeVisible();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  await waitFor(() => expect(reopened).not.toBeVisible());
  expect(mockCopy).not.toHaveBeenCalled();
  expect(mockInfo).not.toHaveBeenCalled();
});

it('does not turn disclosure Enter into a copy or consume its ordinary key event', async () => {
  const user = userEvent.setup();
  const bubbled = jest.fn();
  render(frame({ tooltipFocusable: true }, bubbled));
  await user.tab();
  await user.tab();
  expect(reference()).toHaveFocus();
  await screen.findByRole('tooltip');
  bubbled.mockClear();
  await user.keyboard('{Enter}');
  expect(bubbled.mock.calls.some(([event]) => event.key === 'Enter')).toBe(
    true
  );
  expect(mockCopy).not.toHaveBeenCalled();
  expect(mockInfo).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'buttons.copy' })).toBeNull();
});

it.each([undefined, false])(
  'leaves a default/non-opted-in non-copyable address outside native Tab order (%s)',
  async (tooltipFocusable) => {
    const user = userEvent.setup();
    render(frame({ tooltipFocusable }));
    const node = reference();
    expect(node).not.toHaveAttribute('tabindex');
    await user.hover(node);
    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText(A, { exact: true })).toBeVisible();
    await user.pointer({
      target: document.body,
      coords: { clientX: 100, clientY: 100 },
    });
    await waitFor(() => expect(tooltip).not.toBeVisible());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(mockCopy).not.toHaveBeenCalled();
  }
);

it.each([{ preset: 'full' as const }, { tooltip: false }])(
  'adds no redundant focus stop when the tooltip is not rendered (%o)',
  async (props) => {
    const user = userEvent.setup();
    render(frame({ tooltipFocusable: true, ...props }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(mockCopy).not.toHaveBeenCalled();
  }
);

it('preserves the existing default link and separate Copy button focus/actions', async () => {
  const user = userEvent.setup();
  const url = 'https://explorer.synthetic.invalid/address/' + A;
  render(frame({ explorerUrl: url, copyable: true }));
  expect(reference()).not.toHaveAttribute('tabindex');
  await user.tab();
  await user.tab();
  const link = screen.getByRole('link', { name: ellipsis(A, 4, 4) });
  expect(link).toHaveFocus();
  expect(link).toHaveAttribute('href', url);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noreferrer');
  await user.tab();
  const copy = screen.getByRole('button', { name: 'buttons.copy' });
  expect(copy).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(mockCopy).toHaveBeenCalledTimes(1);
  expect(mockCopy).toHaveBeenCalledWith(A);
  await user.tab();
  expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
});

it('updates the exact disclosed value without replacing the focused reference', async () => {
  const user = userEvent.setup();
  const view = render(frame({ tooltipFocusable: true }));
  const node = reference();
  await user.tab();
  await user.tab();
  expect(node).toHaveFocus();
  await screen.findByRole('tooltip');
  view.rerender(frame({ value: B, tooltipFocusable: true }));
  expect(reference(B)).toBe(node);
  expect(node).toHaveFocus();
  const tooltip = await screen.findByRole('tooltip');
  expect(within(tooltip).getByText(B, { exact: true })).toBeVisible();
  expect(within(tooltip).queryByText(A, { exact: true })).toBeNull();
  expect(mockCopy).not.toHaveBeenCalled();
});
