import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  Erc20ApprovalAddresses,
  getErc20ApprovalAddressValues,
} from './Erc20ApprovalAddresses';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('components/AddressText', () => ({
  AddressText: ({ value }: { value: string }) => (
    <span data-address={value}>{value}</span>
  ),
}));

describe('Erc20ApprovalAddresses', () => {
  it('labels the decoded spender separately from the token contract', () => {
    const spender = '0x1111111111111111111111111111111111111111';
    const tokenContract = '0x2222222222222222222222222222222222222222';

    const approvalAddresses = getErc20ApprovalAddressValues(
      { inputs: [spender, 'unlimited approval amount'] },
      tokenContract
    );
    const markup = renderToStaticMarkup(
      <Erc20ApprovalAddresses {...approvalAddresses} />
    );

    expect(markup).toContain('transactions.spender');
    expect(markup).toContain(`data-address="${spender}"`);
    expect(markup).toContain('settings.contractAddress');
    expect(markup).toContain(`data-address="${tokenContract}"`);
  });
});
