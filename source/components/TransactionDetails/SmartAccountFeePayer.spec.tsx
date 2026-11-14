/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { projectLocale } from '../../config/loaders/localeProjection';

import { SmartAccountFeePayer } from './SmartAccountFeePayer';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const { projectLocale: projectResource } = jest.requireActual(
        '../../config/loaders/localeProjection'
      );
      const catalogue = projectResource(
        jest.requireActual('../../assets/locales/en.json'),
        'base'
      );
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

it.each(['en', 'es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru'])(
  'includes the translated fee-payer label in the %s extension base bundle',
  (locale) => {
    const resource = jest.requireActual(`../../assets/locales/${locale}.json`);
    const base = projectLocale(resource, 'base');
    expect(base.mobile).toBeUndefined();
    expect(base.transactions.feePayer).toBe(
      resource.mobile.infrastructure.feePayer
    );
    expect(base.transactions.feePayer.trim()).not.toBe('');
    expect(typeof base.transactionDisplay.contractInteraction).toBe('string');
  }
);
