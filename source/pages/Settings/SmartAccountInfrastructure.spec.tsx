import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  isInfrastructureStatus,
  SmartAccountInfrastructure,
} from './SmartAccountInfrastructure';

let mockChanging = false;
let mockDisconnected = false;
const mockControllerEmitter = jest.fn();
let mockStateSetters: jest.Mock[];
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
    t: (key: string) => key,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockControllerEmitter,
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
  values.forEach((value) => {
    const setter = jest.fn();
    mockStateSetters.push(setter);
    state.mockImplementationOnce(() => [value, setter]);
  });
  return renderToStaticMarkup(<SmartAccountInfrastructure />);
};

describe('smart account setup status safety', () => {
  beforeEach(() => {
    mockChanging = false;
    mockDisconnected = false;
    mockStateSetters = [];
    mockControllerEmitter.mockReset();
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
    expect(markup).toContain('settings.smartAccountInfrastructureCheckingSlow');
    expect(markup).not.toContain('settings.smartAccountCreate2Missing');
  });

  it('keeps the twenty-second transport deadline separate from 1.2-second visible feedback', () => {
    jest.useFakeTimers();
    const previousWindow = global.window;
    global.window = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    } as any;
    const effects: Array<() => any> = [];
    jest.spyOn(React, 'useEffect').mockImplementation((effect) => {
      effects.push(effect);
    });
    mockControllerEmitter.mockReturnValue(new Promise(() => undefined));
    try {
      render([null, false, true, false, false, '']);
      const stopSubscription = effects[0]();
      const stopFeedback = effects[2]();
      expect(mockControllerEmitter).toHaveBeenCalledWith(
        ['wallet', 'getSmartAccountInfrastructureStatus'],
        [true],
        20000,
        false
      );
      jest.advanceTimersByTime(1199);
      expect(mockStateSetters[4]).toHaveBeenLastCalledWith(false);
      jest.advanceTimersByTime(1);
      expect(mockStateSetters[4]).toHaveBeenLastCalledWith(true);
      stopSubscription();
      stopFeedback();
    } finally {
      global.window = previousWindow;
      jest.useRealTimers();
    }
  });

  it('does not offer deployment based on stale status after a failed refresh', () => {
    const markup = render([status, true, false, false, true, '']);
    expect(markup).not.toContain('settings.deploySmartAccountInfrastructure');
    expect(markup).not.toContain(
      'settings.smartAccountInfrastructureMissingCount'
    );
    expect(markup).toContain('settings.smartAccountInfrastructureCheckStatus');
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
    expect(markup).toContain('settings.smartAccountInfrastructurePending');
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
