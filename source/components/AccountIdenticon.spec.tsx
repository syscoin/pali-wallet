/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { toSvg } from 'jdenticon';
import React from 'react';

import { AccountIdenticon } from './AccountIdenticon';

jest.mock('jdenticon', () => ({
  toSvg: jest.fn(
    (identifier, size) =>
      `<svg data-identifier="${identifier}" width="${size}"></svg>`
  ),
}));

beforeEach(() => jest.clearAllMocks());

it('uses public extended key first and updates the actual icon with identity and size', () => {
  const { container, rerender } = render(
    <AccountIdenticon
      account={{ xpub: 'public-one', address: 'address-one' }}
    />
  );
  expect(toSvg).toHaveBeenLastCalledWith('public-one', 40, {
    backColor: '#07152B',
    padding: 1,
  });
  rerender(
    <AccountIdenticon
      account={{ xpub: '', address: 'address-two' }}
      size={48}
      className="fixture-icon"
    />
  );
  expect(toSvg).toHaveBeenLastCalledWith('address-two', 48, {
    backColor: '#07152B',
    padding: 1,
  });
  expect(container.querySelector('svg')?.dataset.identifier).toBe(
    'address-two'
  );
  expect(container.firstChild).toHaveClass('fixture-icon');
  expect(container.firstChild).toHaveStyle({ width: '48px', height: '48px' });
});

it('does not regenerate the icon for a fresh account object with the same public identity', () => {
  const { rerender } = render(
    <AccountIdenticon
      account={{ xpub: 'public-one', address: 'address-one' }}
    />
  );
  rerender(
    <AccountIdenticon
      account={{ xpub: 'public-one', address: 'address-one' }}
    />
  );
  expect(toSvg).toHaveBeenCalledTimes(1);
});

it('keeps a missing public identity empty', () => {
  const { container } = render(<AccountIdenticon />);
  expect(toSvg).not.toHaveBeenCalled();
  expect(container.firstChild).toBeEmptyDOMElement();
});
