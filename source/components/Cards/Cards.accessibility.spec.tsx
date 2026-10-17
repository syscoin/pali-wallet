/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { CopyCard } from './Cards';

jest.mock('..', () => ({ Icon: () => <span aria-hidden="true" /> }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'buttons.copy' ? 'Copy' : key),
  }),
}));

it('copies public card content by Enter and Space without submitting its surrounding form', async () => {
  const copy = jest.fn();
  const submit = jest.fn((event) => event.preventDefault());
  const user = userEvent.setup();
  render(
    <form onSubmit={submit}>
      <CopyCard label="Your XPUB" onClick={copy}>
        <p>public-fixture-xpub</p>
      </CopyCard>
    </form>
  );
  const button = screen.getByRole('button', { name: 'Copy Your XPUB' });
  await user.tab();
  expect(document.activeElement).toBe(button);
  await user.keyboard('{Enter} ');
  expect(copy).toHaveBeenCalledTimes(2);
  expect(submit).not.toHaveBeenCalled();
});
