/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { PriorityBar } from './PriorityBar';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it('exposes every fee preset to keyboard users without changing selection values', async () => {
  const onClick = jest.fn();
  render(<PriorityBar priority={1} onClick={onClick} />);
  expect(screen.getByRole('group', { name: 'send.editFee' })).toBeDefined();
  expect(
    screen
      .getByRole('button', { name: 'send.medium' })
      .getAttribute('aria-pressed')
  ).toBe('true');
  await userEvent.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'send.low' })
  );
  await userEvent.keyboard('{Enter}');
  expect(onClick).toHaveBeenLastCalledWith(0);
  await userEvent.tab();
  await userEvent.tab();
  await userEvent.keyboard(' ');
  expect(onClick).toHaveBeenLastCalledWith(2);
});
