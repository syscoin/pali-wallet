/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';

import { projectLocale } from '../../config/loaders/localeProjection';
import { controllerEmitter } from '../../scripts/Background/controllers/controllerEmitter';

import { Instruction } from './SmartAccountAuthorizations';

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

const hash = '0x' + '11'.repeat(32);

async function renderActivityInstruction(language: string, sequence: string) {
  const resource = jest.requireActual(`../../assets/locales/${language}.json`);
  const instance = createInstance();
  await instance.init({
    lng: language,
    fallbackLng: false,
    initImmediate: false,
    resources: { [language]: { translation: projectLocale(resource, 'base') } },
  });
  const operationNonce = (
    (BigInt(1) << BigInt(200)) +
    BigInt(sequence)
  ).toString();
  const original = {
    account: '0x' + '22'.repeat(20),
    chainId: '1',
    operationHash: hash,
    operationNonce,
    createdAt: 123,
    payer: '0x' + '33'.repeat(20),
    observedAt: { hash, number: '1' },
  };
  const view = render(
    <I18nextProvider i18n={instance}>
      <ul>
        <Instruction
          group={{ hash, original, cancellations: [] }}
          scope="scope"
        />
      </ul>
    </I18nextProvider>
  );
  return { view, resource, operationNonce };
}

it.each(['en', 'es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru'])(
  '%s renders signed-only Activity controls from extension base resources',
  async (language) => {
    emit.mockReset();
    const { view, resource, operationNonce } = await renderActivityInstruction(
      language,
      '4'
    );
    expect(
      screen.getByRole('button', {
        name: resource.transactions.smartAuthorizations.cancelInstruction,
      })
    ).toBeTruthy();
    expect(
      screen.getByText(resource.transactions.smartAuthorizations.mayExecute)
    ).toBeTruthy();
    expect(emit).not.toHaveBeenCalled();
    emit.mockResolvedValueOnce({
      anchor: { hash, number: '1' },
      currentNonce: (BigInt(operationNonce) + BigInt(1)).toString(),
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
    expect(view.container.textContent).not.toMatch(
      /(?:mobile|transactions|buttons)\./
    );
    expect(emit).toHaveBeenCalledTimes(1);
  }
);

it.each(['0', '9007199254740993'])(
  'preserves exact sequence %s and full packed nonce without Number narrowing',
  async (sequence) => {
    const { resource, operationNonce } = await renderActivityInstruction(
      'en',
      sequence
    );
    const technical = screen
      .getByText(resource.transactions.technicalDetails)
      .closest('details')!;
    expect(technical.open).toBe(false);
    technical.open = true;
    expect(
      within(technical).getByText(resource.transactions.sequence)
        .nextElementSibling?.textContent
    ).toBe(sequence);
    expect(within(technical).getByText(operationNonce)).toBeTruthy();
  }
);
