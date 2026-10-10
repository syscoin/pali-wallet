/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { useTokenImportNavigation } from './useTokenImportNavigation';

const Editor = () => {
  const [address, setAddress] = useState('0x123');
  const [tokenId, setTokenId] = useState('0');
  useTokenImportNavigation('hashed-account-and-network-scope', {
    customContractAddress: address,
    customTokenId: tokenId,
  });
  const { state } = useLocation();
  return (
    <>
      <input
        aria-label="Contract"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      <input
        aria-label="Token ID"
        value={tokenId}
        onChange={(event) => setTokenId(event.target.value)}
      />
      <output data-testid="saved">{JSON.stringify(state)}</output>
    </>
  );
};

it('publishes current import identifiers for reopening without retaining stale validation results', () => {
  const returnContext = { returnRoute: '/home?tab=assets' };
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/tokens/add',
          search: '?tab=custom',
          state: {
            returnContext,
            customTokenDetails: { balance: 10, verified: true },
          },
        },
      ]}
    >
      <Editor />
    </MemoryRouter>
  );
  fireEvent.change(screen.getByLabelText('Contract'), {
    target: { value: `0x${'ab'.repeat(20)}` },
  });
  fireEvent.change(screen.getByLabelText('Token ID'), {
    target: { value: '123' },
  });
  const saved = JSON.parse(screen.getByTestId('saved').textContent!);
  expect(saved).toEqual({
    returnContext,
    tokenImportScope: 'hashed-account-and-network-scope',
    customContractAddress: `0x${'ab'.repeat(20)}`,
    customTokenId: '123',
  });
});
