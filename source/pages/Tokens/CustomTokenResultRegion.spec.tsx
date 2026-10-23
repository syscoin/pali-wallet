/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { ImportableAssetsList } from 'components/ImportableAssetsList';

import { CustomTokenResultRegion } from './CustomTokenResultRegion';

jest.mock('components/index', () => ({
  IconButton: jest.requireActual('components/IconButton').IconButton,
}));
jest.mock('components/Icon/Icon', () => ({
  FiDownload: () => null,
  RiShareForward2Line: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('utils/index', () => jest.requireActual('utils/format'));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const en = jest.requireActual('assets/locales/en.json');
      const template = key
        .split('.')
        .reduce((value, part) => value?.[part], en);
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        typeof template === 'string' ? template : key
      );
    },
  }),
}));

const CONTRACT = `0x${'33'.repeat(20)}`;
const SCOPE = `account-0:network-1:${CONTRACT}`;
const asset = (tokenId = '7', balance = 3) => ({
  id: CONTRACT,
  contractAddress: CONTRACT,
  tokenStandard: 'ERC-1155',
  tokenId,
  balance,
  decimals: 0,
  symbol: 'COLLECTION',
});
let measuredHeight: number;
let observers: TestResizeObserver[];
let originalResizeObserver: PropertyDescriptor | undefined;
let rectSpy: jest.SpyInstance;
const onImport = jest.fn(async () => undefined);
const onDetailsClick = jest.fn();

class TestResizeObserver {
  observe = jest.fn();
  disconnect = jest.fn();
  constructor(private callback: ResizeObserverCallback) {
    observers.push(this);
  }
  emit() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const content = (isPending: boolean, scope = SCOPE, readyAsset = asset()) => (
  <CustomTokenResultRegion isPending={isPending} scope={scope}>
    <ImportableAssetsList
      assets={isPending ? [] : [readyAsset]}
      isLoading={isPending}
      onImport={onImport}
      onDetailsClick={onDetailsClick}
      importedAssetIds={new Set()}
      currentlyImporting={null}
      assetType="evm"
    />
  </CustomTokenResultRegion>
);

beforeEach(() => {
  jest.clearAllMocks();
  measuredHeight = 158;
  observers = [];
  originalResizeObserver = Object.getOwnPropertyDescriptor(
    globalThis,
    'ResizeObserver'
  );
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  });
  rectSpy = jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 240,
      bottom: measuredHeight,
      width: 240,
      height: measuredHeight,
      toJSON: () => ({}),
    }));
});

afterEach(() => {
  rectSpy.mockRestore();
  if (originalResizeObserver)
    Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserver);
  else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

it('reserves the completed height while pending without retaining its balance or actions', () => {
  const view = render(content(false));
  const region = view.container.firstElementChild as HTMLElement;
  expect(region.style.minHeight).toBe('');
  expect(screen.getByText('3')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Import COLLECTION token' })
  ).toBeEnabled();

  measuredHeight = 128;
  view.rerender(content(true));
  expect(region).toHaveStyle({ minHeight: '158px' });
  expect(region.querySelector('.animate-spin')).not.toBeNull();
  expect(region.querySelector('ul')).toBeNull();
  expect(screen.queryByText('3')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(onImport).not.toHaveBeenCalled();
  expect(onDetailsClick).not.toHaveBeenCalled();

  expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  act(() => observers[0].emit());
  view.rerender(content(true));
  expect(region).toHaveStyle({ minHeight: '158px' });
});

it('releases the reservation for a fresh completed result and keeps exact current actions', async () => {
  const view = render(content(false));
  const region = view.container.firstElementChild as HTMLElement;
  view.rerender(content(true));
  expect(region).toHaveStyle({ minHeight: '158px' });

  const current = asset('8', 5);
  measuredHeight = 94;
  view.rerender(content(false, SCOPE, current));
  expect(region.style.minHeight).toBe('');
  expect(screen.getByText('5')).toBeVisible();
  expect(screen.queryByText('3')).toBeNull();
  expect(region.querySelector('.animate-spin')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'View details for COLLECTION token',
    })
  );
  expect(onDetailsClick).toHaveBeenCalledWith(current);
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Import COLLECTION token' })
    );
  });
  expect(onImport).toHaveBeenCalledWith(current);

  view.rerender(content(true));
  expect(region).toHaveStyle({ minHeight: '94px' });
  expect(screen.queryByRole('button')).toBeNull();
});

it('tracks live completed resizing but ignores already queued observer callbacks while pending', () => {
  const view = render(content(false));
  const region = view.container.firstElementChild as HTMLElement;
  expect(observers[0].observe).toHaveBeenCalledWith(region);
  measuredHeight = 238.5;
  act(() => observers[0].emit());

  measuredHeight = 128;
  view.rerender(content(true));
  expect(region).toHaveStyle({ minHeight: '238.5px' });
  act(() => observers[0].emit());
  view.rerender(content(true));
  expect(region).toHaveStyle({ minHeight: '238.5px' });
  expect(observers).toHaveLength(1);
});

it.each([
  ['account', `account-1:network-1:${CONTRACT}`],
  ['network', `account-0:network-2:${CONTRACT}`],
  ['contract', `account-0:network-1:0x${'44'.repeat(20)}`],
])(
  'does not carry a completed footprint into another %s context',
  (_, scope) => {
    const view = render(content(false));
    const region = view.container.firstElementChild as HTMLElement;
    view.rerender(content(true));
    expect(region).toHaveStyle({ minHeight: '158px' });

    measuredHeight = 128;
    view.rerender(content(true, scope));
    expect(region.style.minHeight).toBe('');
    act(() => observers[0].emit());
    view.rerender(content(true, scope));
    expect(region.style.minHeight).toBe('');
    expect(screen.queryByRole('button')).toBeNull();

    measuredHeight = 82;
    view.rerender(content(false, scope));
    expect(region.style.minHeight).toBe('');
    view.rerender(content(true, scope));
    expect(region).toHaveStyle({ minHeight: '82px' });
  }
);

it('disconnects the observer on unmount and does not read through a queued callback', () => {
  const view = render(content(false));
  view.unmount();
  expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  const reads = rectSpy.mock.calls.length;
  observers[0].emit();
  expect(rectSpy).toHaveBeenCalledTimes(reads);
});

it('retains the initial completed measurement when ResizeObserver is unavailable', () => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  const view = render(content(false));
  const region = view.container.firstElementChild as HTMLElement;
  measuredHeight = 128;
  view.rerender(content(true));
  expect(region).toHaveStyle({ minHeight: '158px' });
  expect(observers).toHaveLength(0);
  expect(screen.queryByRole('button')).toBeNull();
});
