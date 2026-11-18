/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';

import { projectLocale } from '../../config/loaders/localeProjection';
import { controllerEmitter } from '../../scripts/Background/controllers/controllerEmitter';

import { SmartAccountAuthorizations } from './SmartAccountAuthorizations';

jest.mock('react-redux', () => ({
  useSelector: (selector) =>
    selector({
      vault: {
        activeAccount: { id: 0, type: 'SmartAccount' },
        activeNetwork: { chainId: 1, url: 'https://rpc.test' },
        isBitcoinBased: false,
      },
    }),
}));
jest.mock('../../utils/navigationState', () => ({
  getWalletNavigationScope: () => ({ account: 'one', network: 'eth' }),
}));
jest.mock('../../scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('./useSmartAccountCancellation', () => ({
  useSmartAccountCancellation: () => ({ busy: false, content: null }),
}));

const emit = controllerEmitter as jest.Mock;

it.each(['en', 'es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru'])(
  '%s renders Signed instructions controls from the actual extension base resources',
  async (language) => {
    // Jest's ?baseMessages mapper returns the full JSON. Apply the real build
    // projection so a mobile-only key cannot appear available in this test.
    const resource = jest.requireActual(
      `../../assets/locales/${language}.json`
    );
    const instance = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: false,
      initImmediate: false,
      resources: {
        [language]: { translation: projectLocale(resource, 'base') },
      },
    });
    expect(instance.exists('mobile.infrastructure.refresh')).toBe(false);
    emit.mockReset();
    emit.mockResolvedValue({ entries: [], nextCursor: null });
    const view = render(
      <I18nextProvider i18n={instance}>
        <SmartAccountAuthorizations />
      </I18nextProvider>
    );
    const details = view.container.querySelector('details')!;
    await act(async () => {
      details.open = true;
      fireEvent(details, new Event('toggle'));
    });
    await screen.findByText(resource.transactions.smartAuthorizations.empty);
    const refresh = screen.getByRole('button', {
      name: resource.mobile.infrastructure.refresh,
    });
    expect(view.container.textContent).not.toMatch(
      /(?:mobile|transactions|buttons)\./
    );
    expect(emit).toHaveBeenCalledTimes(1);
    const hash = '0x' + '11'.repeat(32);
    emit.mockResolvedValueOnce({
      entries: [
        {
          chainId: '1',
          operationHash: hash,
          operationNonce: ((BigInt(1) << BigInt(200)) + BigInt(4)).toString(),
          createdAt: 123,
        },
      ],
      nextCursor: hash,
    });
    await act(async () => fireEvent.click(refresh));
    await screen.findByText(hash);
    const sequence = screen.getByText(resource.transactions.sequence);
    expect(sequence.nextElementSibling?.textContent).toBe('4');
    const technical = screen
      .getByText(resource.transactions.technicalDetails)
      .closest('details')!;
    expect(technical.open).toBe(false);
    technical.open = true;
    expect(
      within(technical).getByText(
        ((BigInt(1) << BigInt(200)) + BigInt(4)).toString()
      )
    ).toBeTruthy();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(
      ['wallet', 'getSmartAccountAuthorizations'],
      [{ maximum: 20 }]
    );
    expect(
      screen.getByRole('button', { name: resource.buttons.loadMore })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: resource.transactions.smartAuthorizations.cancelInstruction,
      })
    ).toBeTruthy();
    emit.mockResolvedValueOnce({
      operationHash: hash,
      kind: 'observed',
      success: true,
    });
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', {
          name: resource.transactions.smartAuthorizations.checkStatus,
        })
      )
    );
    await screen.findByText(
      resource.transactions.smartAuthorizations.observedSuccess
    );
    emit.mockRejectedValueOnce(Error('offline'));
    await act(async () => fireEvent.click(refresh));
    expect((await screen.findByRole('alert')).textContent).toBe(
      resource.transactions.smartAuthorizations.unavailable
    );
    expect(view.container.textContent).not.toMatch(
      /(?:mobile|transactions|buttons)\./
    );
    view.unmount();
  }
);

it.each(['0', '9007199254740993'])(
  'preserves exact sequence %s and full packed nonce without Number narrowing',
  async (sequence) => {
    const resource = jest.requireActual('../../assets/locales/en.json');
    const instance = createInstance();
    await instance.init({
      lng: 'en',
      fallbackLng: false,
      initImmediate: false,
      resources: { en: { translation: projectLocale(resource, 'base') } },
    });
    const operationNonce = (
      (BigInt(1) << BigInt(200)) +
      BigInt(sequence)
    ).toString();
    const hash = '0x' + '11'.repeat(32);
    emit.mockReset();
    emit.mockResolvedValue({
      entries: [
        { chainId: '1', operationHash: hash, operationNonce, createdAt: 123 },
      ],
      nextCursor: null,
    });
    const view = render(
      <I18nextProvider i18n={instance}>
        <SmartAccountAuthorizations />
      </I18nextProvider>
    );
    const list = view.container.querySelector('details')!;
    await act(async () => {
      list.open = true;
      fireEvent(list, new Event('toggle'));
    });
    await screen.findByText(hash);
    expect(
      screen.getByText(resource.transactions.sequence).nextElementSibling
        ?.textContent
    ).toBe(sequence);
    const technical = screen
      .getByText(resource.transactions.technicalDetails)
      .closest('details')!;
    expect(technical.open).toBe(false);
    technical.open = true;
    expect(within(technical).getByText(operationNonce)).toBeTruthy();
    expect(emit).toHaveBeenCalledTimes(1);
    view.unmount();
  }
);
