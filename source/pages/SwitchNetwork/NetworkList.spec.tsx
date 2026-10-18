import React from 'react';

import { INetworkType } from 'types/network';

import { NetworkList } from './NetworkList';

let mockState: any;
const mockControllerEmitter = jest.fn();
const mockNavigate = jest.fn();
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Button', () => ({ Button: 'connect-button' }));
jest.mock('components/ChainIcon', () => ({ ChainIcon: 'chain-icon' }));
jest.mock('hooks/index', () => ({ useQueryData: () => ({}) }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockControllerEmitter }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: { error: jest.fn() } }),
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('./NetworkInfo', () => ({
  useNetworkInfo: () => ({
    leftLogo: 'left-icon',
    rightLogo: 'right-icon',
  }),
}));

const findAll = (
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean
): React.ReactElement[] =>
  React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    return [
      ...(predicate(child) ? [child] : []),
      ...findAll(child.props.children, predicate),
    ];
  });

describe('network picker controls', () => {
  let slots: any[];
  let cursor: number;
  const render = (props = {}) => {
    cursor = 0;
    return NetworkList(props);
  };
  const rows = (tree: React.ReactNode) =>
    findAll(
      tree,
      (element) => element.type === 'button' && !!element.props.title
    );
  const connect = (tree: React.ReactNode) =>
    findAll(tree, (element) => element.type === 'connect-button')[0];

  beforeEach(() => {
    slots = [];
    mockControllerEmitter.mockReset().mockResolvedValue(undefined);
    mockNavigate.mockReset();
    const first = {
      label: 'Same label',
      chainId: 57,
      kind: INetworkType.Syscoin,
      url: 'https://first.invalid',
    };
    mockState = {
      vault: { isBitcoinBased: true, activeNetwork: first },
      vaultGlobal: {
        networks: {
          syscoin: {
            57: first,
            5700: {
              ...first,
              chainId: 5700,
              url: 'https://second.invalid',
            },
          },
          ethereum: {},
        },
      },
    };
    jest.spyOn(React, 'useMemo').mockImplementation((callback) => callback());
    jest.spyOn(React, 'useEffect').mockImplementation(() => undefined);
    jest.spyOn(React, 'useRef').mockImplementation((initial?: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    });
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value: any) => {
          slots[index] =
            typeof value === 'function' ? value(slots[index]) : value;
        },
      ] as any;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('selects only the exact network when two networks share a display label', async () => {
    const initial = rows(render());
    expect(initial).toHaveLength(2);
    expect(initial.map((row) => row.props['aria-pressed'])).toEqual([
      true,
      false,
    ]);
    initial[1].props.onClick();
    const changed = render();
    expect(rows(changed).map((row) => row.props['aria-pressed'])).toEqual([
      false,
      true,
    ]);
    await connect(changed).props.onClick();
    expect(mockControllerEmitter).toHaveBeenCalledWith(
      ['wallet', 'setActiveNetwork'],
      [mockState.vaultGlobal.networks.syscoin[5700], false]
    );
    expect(mockNavigate).toHaveBeenCalledWith('/home');
  });

  it('uses non-submit buttons with pressed state for type and network selection', () => {
    const buttons = findAll(render(), (element) => element.type === 'button');
    expect(buttons).toHaveLength(4);
    buttons.forEach((button) => {
      expect(button.props.type).toBe('button');
      expect(typeof button.props['aria-pressed']).toBe('boolean');
    });
  });

  it('keeps a disabled source type disabled during a forced switch', () => {
    const tree = render({
      disabledNetworkType: 'syscoin',
      forceNetworkType: 'ethereum',
      isTypeSwitch: true,
    });
    const types = findAll(tree, (element) => element.type === 'button');
    expect(types[0].props.disabled).toBe(true);
    expect(types[0].props['aria-pressed']).toBe(false);
    expect(types[1].props['aria-pressed']).toBe(true);
    expect(connect(tree).props.disabled).toBe(true);
    types[0].props.onClick();
    expect(connect(render()).props.disabled).toBe(true);
  });
});
