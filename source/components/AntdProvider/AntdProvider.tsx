import { ConfigProvider, theme as antdTheme } from 'antd';
import React, { FC, PropsWithChildren } from 'react';

/**
 * Single antd theme entry point (antd v6, CSS variables mode).
 *
 * Tokens mirror the semantic palette in palette.js / tailwind.config.js so
 * antd defaults blend into the Pali dark design without per-component CSS
 * overrides. Legacy `.ant-*` override files still win specificity over the
 * `:where()`-scoped cssinjs styles, so existing screens keep their exact
 * look while overrides are gradually retired.
 */
// v6 enables CSS variables mode by default; no cssVar flag needed.
const PALI_ANTD_THEME = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    borderRadius: 8, // rounded-field (0.5rem)
    colorBgBase: '#07152A', // surface.base / bkg-1
    colorBgContainer: '#111E33', // surface.raised / bkg-2
    colorBgElevated: '#162742', // surface.overlay / bkg-3
    colorBorder: '#283851', // brand.whiteAlpaBlue
    // colorError intentionally left at the antd default (#ff4d4f): the brand
    // reds (#D70000/#AF0404) are too dark for error chrome on dark surfaces.
    colorLink: '#4CA1CF',
    colorPrimary: '#4CA1CF', // accent.primary / button.primary
    colorSuccess: '#8EC100', // brand.green
    colorTextBase: '#FFFFFF',
    colorWarning: '#FE9B07', // brand.orange
    controlHeight: 40,
    fontFamily:
      "Poppins, Rubik, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  components: {
    Form: {
      // Pali forms label via placeholders/own markup; antd labels are rare.
      labelColor: '#FFFFFF',
      // Forms add their own flex gaps; keep antd's per-item margin small so
      // stacked fields don't double up into long scrolling pages.
      itemMarginBottom: 8,
    },
    Input: {
      colorBgContainer: '#07152A', // fields.input.primary
      colorBorder: 'rgba(255, 255, 255, 0.16)',
      colorTextPlaceholder: '#808795', // brand.gray300
    },
  },
} as const;

export const AntdProvider: FC<PropsWithChildren> = ({ children }) => (
  <ConfigProvider theme={PALI_ANTD_THEME}>{children}</ConfigProvider>
);
