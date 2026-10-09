import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  isInfrastructureStatus,
  SmartAccountInfrastructure,
} from './SmartAccountInfrastructure';

let mockChanging = false;
let mockDisconnected = false;
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        activeNetwork: { chainId: 31337, url: 'https://local.test' },
        activeAccount: { id: 0, type: 'HDAccount' },
        isBitcoinBased: false,
      },
      vaultGlobal: { networkStatus: mockChanging ? 'switching' : 'idle' },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => options?.defaultValue || key,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: jest.fn(),
    connectionUnavailable: mockDisconnected,
    isUnlocked: true,
  }),
}));
jest.mock('components/index', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  Button: ({ children, variant, ...props }: any) => (
    <button data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

const status = {
  chainId: 31337,
  ready: false,
  create2Deployer: { deployed: true },
  contracts: [{ id: 'factory', displayName: 'Factory', deployed: false }],
};

const render = (values: any[]) => {
  values.splice(5, 0, false);
  const state = jest.spyOn(React, 'useState');
  values.forEach((value) =>
    state.mockImplementationOnce(() => [value, jest.fn()])
  );
  return renderToStaticMarkup(<SmartAccountInfrastructure />);
};

describe('smart account setup status safety', () => {
  beforeEach(() => {
    mockChanging = false;
    mockDisconnected = false;
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not label an unknown network response as missing CREATE2 support', () => {
    const markup = render([null, false, true, false, false, '']);
    expect(markup).toContain('buttons.loading');
    expect(markup).not.toContain('settings.smartAccountCreate2Missing');
    expect(markup).not.toContain('settings.deploySmartAccountInfrastructure');
  });

  it('shows useful feedback during a slow initial check', () => {
    const markup = render([null, false, true, false, true, '']);
    expect(markup).toContain('taking longer than expected');
    expect(markup).not.toContain('settings.smartAccountCreate2Missing');
  });

  it('does not offer deployment based on stale status after a failed refresh', () => {
    const markup = render([status, true, false, false, true, '']);
    expect(markup).not.toContain('settings.deploySmartAccountInfrastructure');
    expect(markup).not.toContain(
      'settings.smartAccountInfrastructureMissingCount'
    );
    expect(markup).toContain('Check status');
  });

  it('keeps a pending deployment disabled after reopening the screen', () => {
    const markup = render([
      {
        ...status,
        pending: { contractId: 'factory', transactionHash: '0x123' },
      },
      false,
      false,
      false,
      false,
      '',
    ]);
    expect(markup).toContain('Deployment is pending');
    expect(markup).toMatch(
      /<button[^>]*disabled[^>]*>settings.deploySmartAccountInfrastructure/
    );
  });

  it.each(['transition', 'disconnect'])(
    'disables deployment during %s',
    (reason) => {
      mockChanging = reason === 'transition';
      mockDisconnected = reason === 'disconnect';
      const markup = render([status, false, false, false, false, '']);
      expect(markup).toMatch(
        /<button[^>]*disabled[^>]*>settings.deploySmartAccountInfrastructure/
      );
    }
  );

  it('rejects wrong-chain and incomplete status replies', () => {
    expect(isInfrastructureStatus(status, 31337)).toBe(true);
    expect(isInfrastructureStatus(status, 1)).toBe(false);
    expect(
      isInfrastructureStatus({ ...status, contracts: [null] }, 31337)
    ).toBe(false);
    expect(
      isInfrastructureStatus({ ...status, create2Deployer: {} }, 31337)
    ).toBe(false);
  });
});
