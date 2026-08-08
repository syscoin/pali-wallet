jest.mock('components/Icon/Icon', () => ({
  NftFallbackSvg: () => null,
}));

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { getKnownTokenLogo } from 'utils/tokens';

import { clearTokenIconCache, TokenIcon } from './TokenIcon';

describe('TokenIcon UTXO identity enforcement', () => {
  afterEach(() => {
    clearTokenIconCache();
  });

  it('does not render a legacy official logo for a noncanonical SPT', () => {
    const officialLogo = getKnownTokenLogo('SYSX', undefined, '123456');
    expect(officialLogo).not.toBeNull();

    const markup = renderToStaticMarkup(
      <TokenIcon assetGuid="987654321" logo={officialLogo!} symbol="SYSX" />
    );

    expect(markup).not.toContain('<img');
    expect(markup).toContain('>S</span>');
  });
});
