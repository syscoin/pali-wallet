/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { SeedPhraseDisplay } from './SeedPhraseDisplay';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it.each(['words', 'textarea'] as const)(
  'resets %s reveal after auth reset and seed replacement',
  (displayMode) => {
    const props = {
      displayMode,
      seedPhrase: 'synthetic phrase one',
      isEnabled: true,
    };
    const view = render(<SeedPhraseDisplay {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('button', { name: 'Hide' })).toBeVisible();
    view.rerender(<SeedPhraseDisplay {...props} isEnabled={false} />);
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled();
    view.rerender(<SeedPhraseDisplay {...props} />);
    expect(screen.getByRole('button', { name: 'Show' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    view.rerender(
      <SeedPhraseDisplay {...props} seedPhrase="synthetic replacement" />
    );
    expect(screen.getByRole('button', { name: 'Show' })).toBeVisible();
    view.rerender(<SeedPhraseDisplay {...props} />);
    expect(screen.getByRole('button', { name: 'Show' })).toBeVisible();
  }
);

it('does not carry reveal across clearing and restoring the same phrase', () => {
  const view = render(
    <SeedPhraseDisplay displayMode="textarea" seedPhrase="synthetic phrase" />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  view.rerender(<SeedPhraseDisplay displayMode="textarea" />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(
    <SeedPhraseDisplay displayMode="textarea" seedPhrase="synthetic phrase" />
  );
  expect(screen.getByRole('button', { name: 'Show' })).toBeVisible();
  expect(screen.getByRole('textbox')).toHaveClass('blur-sm');
});
