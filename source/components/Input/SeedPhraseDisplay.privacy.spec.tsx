/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { SeedPhraseDisplay } from './SeedPhraseDisplay';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const seed = 'synthetic phrase one';
const replacement = 'synthetic replacement two';
const mask =
  '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****';
const displayModes = ['words', 'textarea'] as const;
const renderedPhrase = (container: HTMLElement, displayMode: string) =>
  displayMode === 'textarea'
    ? container.querySelector('textarea')!.value
    : Array.from(container.querySelectorAll('p'))
        .map((word) => word.textContent)
        .join(' ');

it.each(displayModes)(
  'masks the rendered %s content before Show and after Hide',
  (displayMode) => {
    const { container } = render(
      <SeedPhraseDisplay displayMode={displayMode} seedPhrase={seed} />
    );
    expect(renderedPhrase(container, displayMode)).toBe(mask);
    fireEvent.click(
      screen.getByRole('button', { name: 'import.showSeedPhrase' })
    );
    expect(renderedPhrase(container, displayMode)).toBe(seed);
    fireEvent.click(
      screen.getByRole('button', { name: 'import.hideSeedPhrase' })
    );
    expect(renderedPhrase(container, displayMode)).toBe(mask);
    expect(
      screen.getByRole('button', { name: 'import.showSeedPhrase' })
    ).toBeEnabled();
  }
);

it.each(displayModes)(
  'keeps a supplied %s seed masked while disabled',
  (displayMode) => {
    const view = render(
      <SeedPhraseDisplay
        displayMode={displayMode}
        seedPhrase={seed}
        isEnabled={false}
      />
    );
    expect(renderedPhrase(view.container, displayMode)).toBe(mask);
    const show = screen.getByRole('button', { name: 'import.showSeedPhrase' });
    expect(show).toBeDisabled();
    fireEvent.click(show);
    expect(renderedPhrase(view.container, displayMode)).toBe(mask);
    view.rerender(
      <SeedPhraseDisplay displayMode={displayMode} seedPhrase={seed} />
    );
    expect(renderedPhrase(view.container, displayMode)).toBe(mask);
  }
);

it.each(displayModes)(
  'resets %s content after auth reset and seed replacement',
  (displayMode) => {
    const props = { displayMode, seedPhrase: seed, isEnabled: true };
    const view = render(<SeedPhraseDisplay {...props} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'import.showSeedPhrase' })
    );
    expect(renderedPhrase(view.container, displayMode)).toBe(seed);
    view.rerender(<SeedPhraseDisplay {...props} isEnabled={false} />);
    expect(renderedPhrase(view.container, displayMode)).toBe(mask);
    expect(
      screen.getByRole('button', { name: 'import.showSeedPhrase' })
    ).toBeDisabled();
    view.rerender(<SeedPhraseDisplay {...props} />);
    expect(renderedPhrase(view.container, displayMode)).toBe(mask);
    fireEvent.click(
      screen.getByRole('button', { name: 'import.showSeedPhrase' })
    );
    view.rerender(<SeedPhraseDisplay {...props} seedPhrase={replacement} />);
    expect(renderedPhrase(view.container, displayMode)).toBe(mask);
    fireEvent.click(
      screen.getByRole('button', { name: 'import.showSeedPhrase' })
    );
    expect(renderedPhrase(view.container, displayMode)).toBe(replacement);
    view.rerender(<SeedPhraseDisplay {...props} />);
    expect(renderedPhrase(view.container, displayMode)).toBe(mask);
  }
);

it.each(displayModes)(
  'does not carry %s reveal across clearing and restoring the same phrase',
  (displayMode) => {
    const view = render(
      <SeedPhraseDisplay displayMode={displayMode} seedPhrase={seed} />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'import.showSeedPhrase' })
    );
    view.rerender(<SeedPhraseDisplay displayMode={displayMode} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(renderedPhrase(view.container, displayMode)).toBe(mask);
    view.rerender(
      <SeedPhraseDisplay displayMode={displayMode} seedPhrase={seed} />
    );
    expect(
      screen.getByRole('button', { name: 'import.showSeedPhrase' })
    ).toBeVisible();
    expect(renderedPhrase(view.container, displayMode)).toBe(mask);
    if (displayMode === 'textarea')
      expect(screen.getByRole('textbox')).toHaveClass('blur-sm');
  }
);

it.each(displayModes)(
  'keeps explicit no-eye-toggle %s mode visible only while enabled',
  (displayMode) => {
    const props = { displayMode, seedPhrase: seed, showEyeToggle: false };
    const view = render(<SeedPhraseDisplay {...props} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(renderedPhrase(view.container, displayMode)).toBe(seed);
    view.rerender(<SeedPhraseDisplay {...props} isEnabled={false} />);
    expect(renderedPhrase(view.container, displayMode)).toBe(mask);
    view.rerender(<SeedPhraseDisplay {...props} />);
    expect(renderedPhrase(view.container, displayMode)).toBe(seed);
  }
);

it.each(displayModes)(
  'preserves the custom %s placeholder when no phrase is available',
  (displayMode) => {
    const { container } = render(
      <SeedPhraseDisplay
        displayMode={displayMode}
        placeholder="Pending recovery phrase"
        isEnabled={false}
      />
    );
    expect(renderedPhrase(container, displayMode)).toBe(
      'Pending recovery phrase'
    );
    expect(screen.queryByRole('button')).toBeNull();
    if (displayMode === 'textarea') {
      expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
      expect(screen.getByRole('textbox')).toHaveAttribute(
        'placeholder',
        'settings.enterYourPassword'
      );
    }
  }
);
