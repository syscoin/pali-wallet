// @ts-check

const docsLocaleConfigs = {
  en: {
    label: 'English',
    htmlLang: 'en-US',
  },
  es: {
    label: 'Español',
    htmlLang: 'es',
  },
  pt: {
    label: 'Português',
    htmlLang: 'pt',
  },
  fr: {
    label: 'Français',
    htmlLang: 'fr',
  },
  de: {
    label: 'Deutsch',
    htmlLang: 'de',
  },
  ru: {
    label: 'Русский',
    htmlLang: 'ru',
  },
  zh: {
    label: '中文',
    htmlLang: 'zh',
  },
  ja: {
    label: '日本語',
    htmlLang: 'ja',
  },
  ko: {
    label: '한국어',
    htmlLang: 'ko',
  },
};

const docsLocales = Object.keys(docsLocaleConfigs);
const searchLanguages = docsLocales.filter((locale) => locale !== 'ko');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Pali Wallet Docs',
  tagline:
    'Build EVM, Syscoin UTXO, Bitcoin-style, and smart-account dapps with Pali Wallet.',
  favicon: 'img/favicon.svg',

  url: 'https://docs.paliwallet.com',
  baseUrl: '/',
  organizationName: 'syscoin',
  projectName: 'pali_wallet',

  onBrokenLinks: 'throw',
  trailingSlash: false,
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    // Match Pali Wallet locales. Non-English routes are enabled so the
    // language selector, translated chrome, and localized docs are published.
    locales: docsLocales,
    localeConfigs: docsLocaleConfigs,
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: 'docs',
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl:
            'https://github.com/syscoin/pali-wallet/tree/master/docs/portal/',
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themes: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        indexBlog: false,
        // `lunr-languages` currently breaks the combined search regex when
        // `ko` is included because its wordCharacters value is already wrapped
        // in a character class. Korean routes still build; Latin technical
        // identifiers remain searchable, but Korean stemming/tokenization is
        // intentionally excluded until the upstream issue is fixed.
        language: searchLanguages,
      },
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/pali-docs-card.svg',
      navbar: {
        title: 'Pali Docs',
        logo: {
          alt: 'Pali Wallet',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'tutorialSidebar',
            position: 'left',
            label: 'Docs',
          },
          {
            to: '/docs/developers/provider-discovery',
            label: 'Developers',
            position: 'left',
          },
          {
            to: '/docs/passkeys-institutions/overview',
            label: 'Smart Accounts',
            position: 'left',
          },
          {
            href: 'https://github.com/syscoin/pali-wallet',
            label: 'GitHub',
            position: 'right',
          },
          {
            type: 'localeDropdown',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Build',
            items: [
              {
                label: 'Developer Quickstart',
                to: '/docs/developers/provider-discovery',
              },
              {
                label: 'EVM API',
                to: '/docs/evm-api/overview',
              },
              {
                label: 'UTXO and Syscoin API',
                to: '/docs/utxo-syscoin-api/overview',
              },
            ],
          },
          {
            title: 'Smart Accounts',
            items: [
              {
                label: 'Pali Smart Accounts',
                to: '/docs/passkeys-institutions/overview',
              },
              {
                label: 'Gas and Funding',
                to: '/docs/passkeys-institutions/gas-funding',
              },
            ],
          },
          {
            title: 'Community',
            items: [
              {
                label: 'Syscoin Discord',
                href: 'https://discord.com/invite/syscoin',
              },
              {
                label: 'Pali Wallet GitHub',
                href: 'https://github.com/syscoin/pali-wallet',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Syscoin. Built for Pali Wallet.`,
      },
      prism: {
        additionalLanguages: ['bash', 'json'],
      },
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
    }),
};

module.exports = config;
