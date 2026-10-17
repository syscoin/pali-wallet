/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { Button } from './Button';

jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg aria-hidden="true" />,
}));

it.each(['primary', 'unstyled'] as const)(
  'retains its name and forwards focus for a busy %s button',
  (variant) => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} variant={variant} loading>
        Save policy
      </Button>
    );
    const button = screen.getByRole('button', {
      name: 'Save policy',
    }) as HTMLButtonElement;
    expect(ref.current).toBe(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  }
);

it('preserves an explicit accessible name for icon controls', () => {
  render(
    <Button aria-label="Close dialog">
      <svg aria-hidden="true" />
    </Button>
  );
  expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDefined();
});
