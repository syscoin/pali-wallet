/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// The action's real SVG/button has no Ant Design dependency; unrelated registry
// glyphs import ESM-only color helpers that the Jest runtime does not transform.
jest.mock('@ant-design/icons', () => ({}));

import { DetailArrowSvg } from './Icon';

it.each(['{Enter}', ' '])(
  'opens details once with %s after normal keyboard focus',
  async (key) => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(
      <DetailArrowSvg ariaLabel="View transaction details" onClick={onClick} />
    );
    const action = screen.getByRole('button', {
      name: 'View transaction details',
    });
    await user.tab();
    expect(document.activeElement).toBe(action);
    expect(action.className).toContain('focus-visible:ring-2');
    expect(action.className).toContain('focus-visible:ring-white');
    await user.keyboard(key);
    expect(onClick).toHaveBeenCalledTimes(1);
  }
);

it('keeps the 16-pixel glyph decorative and pointer activation does not submit a surrounding form', async () => {
  const user = userEvent.setup();
  const onClick = jest.fn();
  const onSubmit = jest.fn((event) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <DetailArrowSvg ariaLabel="View transaction details" onClick={onClick} />
    </form>
  );
  const action = screen.getByRole('button', {
    name: 'View transaction details',
  });
  expect(action.getAttribute('type')).toBe('button');
  expect(action.className).toContain('w-4');
  expect(action.className).toContain('h-4');
  const glyph = action.querySelector('svg')!;
  expect(glyph.getAttribute('aria-hidden')).toBe('true');
  expect(glyph.getAttribute('focusable')).toBe('false');
  expect(glyph.getAttribute('width')).toBe('16');
  expect(glyph.getAttribute('height')).toBe('16');
  await user.click(glyph);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
});
