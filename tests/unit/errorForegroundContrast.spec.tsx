/** @jest-environment node */
import { theme } from 'antd';
import { readFileSync } from 'fs';
import path from 'path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AntdProvider } from 'components/AntdProvider/AntdProvider';

import palette from '../../palette.js';
import config from '../../tailwind.config.js';

const roles = [
  'content-error',
  'warning-error',
  'alert-lighterror',
  'alert-darkerror',
  'status-error',
  'status-errorBright',
  'extraColors-red',
  'brand-red',
  'brand-redDark',
  'red-400',
  'red-500',
  'red-600',
];
const rgb = (value: string): number[] => {
  if (/^#[0-9a-f]{6}$/i.test(value))
    return value
      .slice(1)
      .match(/../g)!
      .map((part) => parseInt(part, 16));
  const channels = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!channels) throw new Error('Unsupported generated color: ' + value);
  return channels.slice(1, 4).map(Number);
};
const luminance = (channels: number[]) =>
  channels
    .map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    })
    .reduce(
      (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
      0
    );
const contrast = (first: number[], second: number[]) => {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const composite = (foreground: number[], background: number[], alpha: number) =>
  foreground.map(
    (channel, index) => channel * alpha + background[index] * (1 - alpha)
  );

let sheet: any;
beforeAll(async () => {
  const classes = [
    ...roles.map((role) => 'text-' + role),
    'text-brand-white',
    'bg-warning-error',
    'bg-alert-lighterror',
    'bg-alert-darkerror',
    'bg-status-error',
    'bg-status-errorBright',
    'bg-extraColors-red',
    'border-warning-error',
    'bg-brand-red',
    'bg-brand-redDark',
    'bg-red-400',
    'bg-red-500',
    'border-red-600',
  ];
  sheet = (
    await postcss([
      tailwind({
        ...config,
        content: [
          {
            raw: '<div class="' + classes.join(' ') + '"></div>',
            extension: 'html',
          },
        ],
        corePlugins: { preflight: false },
      }),
    ]).process(
      readFileSync(
        path.resolve(__dirname, '../../source/assets/styles/index.css'),
        'utf8'
      ),
      { from: undefined }
    )
  ).root;
});
const declaration = (selector: string, property: string): string => {
  let result: string | undefined;
  sheet.walkRules((rule: any) => {
    if (
      !rule.selector
        .split(',')
        .map((part: string) => part.trim())
        .includes(selector)
    )
      return;
    rule.walkDecls(property, (value: any) => {
      result = value.value;
    });
  });
  if (!result)
    throw new Error('Missing generated role: ' + selector + ' ' + property);
  return result;
};

// These are actual Pali surface tokens, not a white-background contrast test.
// Alpha-card contexts used by nested settings cards are included explicitly.
const surfaces = () =>
  [
    ['base', rgb(palette.surface.base)],
    ['raised', rgb(palette.surface.raised)],
    ['elevated', rgb(palette.surface.elevated)],
    ['overlay', rgb(palette.surface.overlay)],
    [
      'elevated alpha-card',
      composite([255, 255, 255], rgb(palette.surface.elevated), 0.06),
    ],
    [
      'overlay alpha-card',
      composite([255, 255, 255], rgb(palette.surface.overlay), 0.06),
    ],
  ] as Array<[string, number[]]>;

it.each(roles)(
  'keeps small %s error copy legible on Pali dark surfaces',
  (role) => {
    const foreground = rgb(declaration('.text-' + role, 'color'));
    for (const [, background] of surfaces())
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  }
);

it('preserves destructive fill and border colors while changing only foreground roles', () => {
  expect(rgb(declaration('.bg-warning-error', 'background-color'))).toEqual([
    175, 4, 4,
  ]);
  expect(rgb(declaration('.border-warning-error', 'border-color'))).toEqual([
    175, 4, 4,
  ]);
  for (const [role, value] of [
    ['alert-lighterror', [175, 4, 4]],
    ['alert-darkerror', [142, 7, 7]],
    ['status-error', [175, 4, 4]],
    ['status-errorBright', [215, 0, 0]],
    ['extraColors-red', [215, 0, 0]],
  ] as Array<[string, number[]]>) {
    expect(rgb(declaration('.bg-' + role, 'background-color'))).toEqual(value);
  }
  expect(rgb(declaration('.bg-brand-red', 'background-color'))).toEqual([
    215, 0, 0,
  ]);
  expect(rgb(declaration('.bg-brand-redDark', 'background-color'))).toEqual([
    198, 0, 0,
  ]);
  expect(rgb(declaration('.bg-red-400', 'background-color'))).toEqual([
    248, 113, 113,
  ]);
  expect(rgb(declaration('.bg-red-500', 'background-color'))).toEqual([
    239, 68, 68,
  ]);
  expect(rgb(declaration('.border-red-600', 'border-color'))).toEqual([
    220, 38, 38,
  ]);
  expect(rgb(declaration('.text-brand-white', 'color'))).toEqual([
    255, 255, 255,
  ]);
});

it('keeps Antd error copy readable without changing its error fills or borders', () => {
  let current: any;
  const ReadTokens = () => {
    current = theme.useToken().token;
    return null;
  };
  renderToStaticMarkup(
    <AntdProvider>
      <ReadTokens />
    </AntdProvider>
  );
  const original = theme.getDesignToken({
    algorithm: theme.darkAlgorithm,
    token: {
      colorBgBase: palette.bkg[1],
      colorBgContainer: palette.bkg[2],
      colorBgElevated: palette.bkg[3],
      colorTextBase: '#FFFFFF',
    },
  });
  expect(current.colorErrorBg).toBe(original.colorErrorBg);
  expect(current.colorErrorBorder).toBe(original.colorErrorBorder);
  expect(current.colorError).toBe(original.colorError);
  for (const field of [
    'colorErrorText',
    'colorErrorTextHover',
    'colorErrorTextActive',
    'colorErrorAffix',
  ]) {
    const foreground = rgb(current[field]);
    for (const [, background] of surfaces())
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  }
});

it('rejects the prior dark error foreground and saturated Antd red on the lighter overlay', () => {
  const background = rgb(palette.surface.overlay);
  expect(contrast(rgb('#AF0404'), background)).toBeLessThan(4.5);
  expect(contrast(rgb('#ff4d4f'), background)).toBeLessThan(4.5);
});

it.each([
  '.ant-form-item.ant-form-item-has-error .ant-form-item-explain-error',
  '.ant-form-item.ant-form-item-has-error .ant-form-item-feedback-icon-error',
])(
  'covers actual Antd Form foreground selector %s without relying on its fill token',
  (selector) => {
    const foreground = rgb(declaration(selector, 'color'));
    for (const [, background] of surfaces())
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  }
);
