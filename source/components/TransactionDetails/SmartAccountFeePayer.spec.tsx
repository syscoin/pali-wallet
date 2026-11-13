/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { SmartAccountFeePayer } from './SmartAccountFeePayer';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const catalogue = jest.requireActual('../../assets/locales/en.json');
      const message = key
        .split('.')
        .reduce((value: any, part) => value?.[part], catalogue);
      if (typeof message !== 'string')
        throw new Error(`Missing translation: ${key}`);
      return message;
    },
  }),
}));

it('shows the translated fee-payer label and exact approved address', () => {
  const address = '0x' + '44'.repeat(20);
  render(<SmartAccountFeePayer address={address} />);
  expect(screen.getByText('Fee payer')).toBeTruthy();
  expect(screen.getByText(address)).toBeTruthy();
});
