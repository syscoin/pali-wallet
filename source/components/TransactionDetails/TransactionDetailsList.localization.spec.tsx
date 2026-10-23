/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';

import { TransactionDetailsList } from './TransactionDetailsList';

// Decoration only: preserve the real native copy button and real Tooltip.
jest.mock('components/Icon', () => ({
  Icon: () => <span aria-hidden="true" />,
}));
jest.mock('utils/index', () => jest.requireActual('utils/format'));

const resources = { en, es, pt, fr, de, zh, ja, ko, ru };
const locales = Object.keys(resources) as Array<keyof typeof resources>;
const ADDRESS = '0x' + '12'.repeat(20);
const HASH = '0x' + '34'.repeat(32);

afterEach(cleanup);

it.each(locales)(
  'localizes the %s display while preserving exact raw copy labels and values',
  async (locale) => {
    const instance = createInstance();
    await instance.use(initReactI18next).init({
      initImmediate: false,
      lng: locale,
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: Object.fromEntries(
        Object.entries(resources).map(([language, translation]) => [
          language,
          { translation },
        ])
      ),
    });
    const onCopy = jest.fn();
    const details = [
      { label: 'From', value: ADDRESS, canCopy: true },
      { label: 'Block Hash', value: HASH, copyValue: HASH, canCopy: true },
      { label: 'Success', value: 'Failed' },
      { label: 'Timestamp', value: null },
      { label: 'exactABIField', value: 'raw-public-value' },
    ];
    const before = JSON.stringify(details);
    render(
      <I18nextProvider i18n={instance}>
        <TransactionDetailsList details={details} onCopy={onCopy} />
      </I18nextProvider>
    );
    const fromRow = screen.getByText(resources[locale].send.from)
      .parentElement!;
    const hashRow = screen.getByText(
      resources[locale].transactionDisplay.blockHash
    ).parentElement!;
    const copyName = resources[locale].buttons.copy;
    const fromCopyName = `${copyName}: ${resources[locale].send.from}`;
    const firstCopy = within(fromRow).getByRole('button', {
      name: fromCopyName,
    });
    expect(firstCopy).toHaveAccessibleName(fromCopyName);
    await userEvent.click(firstCopy);
    const hashCopy = within(hashRow).getByRole('button', {
      name: `${copyName}: ${resources[locale].transactionDisplay.blockHash}`,
    });
    hashCopy.focus();
    expect(hashCopy).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onCopy.mock.calls).toEqual([
      [ADDRESS, 'From'],
      [HASH, 'Block Hash'],
    ]);
    expect(screen.getByText(resources[locale].send.failed)).toBeVisible();
    expect(
      screen.getByText(resources[locale].components.notAvailable)
    ).toBeVisible();
    expect(screen.getByText('exactABIField')).toBeVisible();
    expect(screen.getByText('raw-public-value')).toBeVisible();
    expect(JSON.stringify(details)).toBe(before);
    expect(instance.language).toBe(locale);
  }
);

it.each(locales)(
  'preserves raw N/A and its exact copy in %s while localizing only missing values',
  async (locale) => {
    const instance = createInstance();
    await instance.use(initReactI18next).init({
      initImmediate: false,
      lng: locale,
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: Object.fromEntries(
        Object.entries(resources).map(([language, translation]) => [
          language,
          { translation },
        ])
      ),
    });
    const onCopy = jest.fn();
    const details = [
      {
        label: 'Revert Reason',
        value: 'N/A',
        tooltip: 'N/A',
        canCopy: true,
      },
      { label: 'Timestamp', value: 'N/A' },
      { label: 'Success', value: 'N/A', tooltip: 'N/A', canCopy: true },
      { label: 'missing-null', value: null },
      { label: 'missing-empty', value: '' },
      { label: 'missing-undefined', value: undefined },
      { label: 'zero-value', value: 0 },
    ];
    const before = JSON.stringify(details);
    render(
      <I18nextProvider i18n={instance}>
        <TransactionDetailsList details={details} onCopy={onCopy} />
      </I18nextProvider>
    );
    const revertRow = screen.getByText(
      resources[locale].transactionDisplay.revertReason
    ).parentElement!;
    const timestampRow = screen.getByText(
      resources[locale].transactionDisplay.timestamp
    ).parentElement!;
    const rawStatusRow = screen.getByText(resources[locale].buttons.success)
      .parentElement!;
    expect(within(revertRow).getByText('N/A')).toBeVisible();
    expect(within(timestampRow).getByText('N/A')).toBeVisible();
    expect(within(rawStatusRow).getByText('N/A')).toBeVisible();
    const copyButton = within(revertRow).getByRole('button', {
      name: `${resources[locale].buttons.copy}: ${resources[locale].transactionDisplay.revertReason}`,
    });
    copyButton.focus();
    expect(copyButton).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const statusCopy = within(rawStatusRow).getByRole('button', {
      name: `${resources[locale].buttons.copy}: ${resources[locale].buttons.success}`,
    });
    statusCopy.focus();
    expect(statusCopy).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onCopy.mock.calls).toEqual([
      ['N/A', 'Revert Reason'],
      ['N/A', 'Success'],
    ]);
    for (const label of ['missing-null', 'missing-empty']) {
      const row = screen.getByText(label).parentElement!;
      expect(
        within(row).getByText(resources[locale].components.notAvailable)
      ).toBeVisible();
    }
    expect(screen.queryByText('missing-undefined')).not.toBeInTheDocument();
    expect(
      within(screen.getByText('zero-value').parentElement!).getByText('0')
    ).toBeVisible();
    expect(JSON.stringify(details)).toBe(before);
    expect(details[5].value).toBeUndefined();
    expect(instance.language).toBe(locale);
  }
);
