/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { Button } from './Button';

jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: (props: React.SVGProps<SVGSVGElement>) => (
    <svg {...props} aria-hidden="true" />
  ),
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

it.each(['primary', 'secondary', 'ghost', 'danger', 'neutral'] as const)(
  'keeps active %s progress visible without enabling a pending action',
  (variant) => {
    const action = jest.fn();
    const { rerender } = render(
      <Button variant={variant} loading onClick={action}>
        Continue
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Continue' });
    const spinner = button.querySelector('svg')!;
    expect(spinner.style.color.toLowerCase()).toBe(
      variant === 'neutral' ? 'rgb(77, 118, 184)' : 'currentcolor'
    );
    expect(button.className).toContain('opacity-100');
    expect(button.className).not.toContain('opacity-60');
    fireEvent.click(button);
    expect(action).not.toHaveBeenCalled();
    rerender(
      <Button variant={variant} disabled onClick={action}>
        Continue
      </Button>
    );
    expect(button.querySelector('svg')).toBeNull();
    expect(button.className).toContain('opacity-60');
    fireEvent.click(button);
    expect(action).not.toHaveBeenCalled();
  }
);
