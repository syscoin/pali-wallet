/* eslint-disable react/jsx-filename-extension */
import Link from '@docusaurus/Link';
import Translate, { translate } from '@docusaurus/Translate';
import Layout from '@theme/Layout';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React from 'react';

import styles from './index.module.css';

const featureCards = [
  {
    title: translate({
      id: 'homepage.feature.evm.title',
      message: 'MetaMask-compatible EVM dapps',
    }),
    description: translate({
      id: 'homepage.feature.evm.description',
      message:
        'Use familiar EIP-1193, EIP-6963, permissions, signing, chain management, assets, and batch call flows through window.ethereum.',
    }),
    to: '/docs/evm-api/overview',
  },
  {
    title: translate({
      id: 'homepage.feature.utxo.title',
      message: 'UTXO and Syscoin dapps',
    }),
    description: translate({
      id: 'homepage.feature.utxo.description',
      message:
        'Use window.pali for Syscoin UTXO accounts, PSBT signing, change addresses, xpub-aware state, SPT assets, and Bitcoin-style integrations.',
    }),
    to: '/docs/utxo-syscoin-api/overview',
  },
  {
    title: translate({
      id: 'homepage.feature.passkeys.title',
      message: 'Passkeys for institutions',
    }),
    description: translate({
      id: 'homepage.feature.passkeys.description',
      message:
        'Create and recover passkey smart accounts, attach sponsor policy, and submit atomic batches with a single WebAuthn approval.',
    }),
    to: '/docs/passkeys-institutions/overview',
  },
];

function HomepageHeader() {
  return (
    <header className={styles.hero}>
      <div className="container">
        <p className={styles.eyebrow}>
          <Translate id="homepage.hero.eyebrow">
            Pali Wallet documentation
          </Translate>
        </p>
        <h1 className={styles.heroTitle}>
          <Translate id="homepage.hero.title">
            One wallet surface for EVM, Syscoin UTXO, Bitcoin-style apps, and
            passkey accounts.
          </Translate>
        </h1>
        <p className={styles.heroSubtitle}>
          <Translate id="homepage.hero.subtitle">
            Pali is a secure browser extension wallet for users, developers, and
            institutions building across account-based and UTXO-based chains.
          </Translate>
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--primary button--lg"
            to="/docs/developers/provider-discovery"
          >
            <Translate id="homepage.hero.primaryCta">Build with Pali</Translate>
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/docs/users/getting-started"
          >
            <Translate id="homepage.hero.secondaryCta">User guides</Translate>
          </Link>
        </div>
      </div>
    </header>
  );
}

function FeatureCard({ title, description, to }) {
  return (
    <Link className={styles.cardLink} to={to}>
      <article className={clsx('card', styles.featureCard)}>
        <div className="card__body">
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </article>
    </Link>
  );
}

FeatureCard.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  to: PropTypes.string.isRequired,
};

export default function Home() {
  return (
    <Layout
      title={translate({
        id: 'homepage.layout.title',
        message: 'Pali Wallet Docs',
      })}
      description={translate({
        id: 'homepage.layout.description',
        message:
          'Developer, user, and institutional documentation for Pali Wallet.',
      })}
    >
      <HomepageHeader />
      <main>
        <section className={styles.features}>
          <div className="container">
            <div className="row">
              {featureCards.map((card) => (
                <div className="col col--4" key={card.title}>
                  <FeatureCard {...card} />
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className={styles.flowSection}>
          <div className="container">
            <h2>
              <Translate id="homepage.flow.title">
                Choose the right integration path
              </Translate>
            </h2>
            <div className={styles.flowGrid}>
              <div>
                <span className={styles.step}>1</span>
                <h3>
                  <Translate id="homepage.flow.detect.title">
                    Detect providers
                  </Translate>
                </h3>
                <p>
                  <Translate id="homepage.flow.detect.description">
                    Prefer EIP-6963 for EVM dapps, then use window.ethereum.
                    Syscoin UTXO and Bitcoin-like flows use window.pali.
                  </Translate>
                </p>
              </div>
              <div>
                <span className={styles.step}>2</span>
                <h3>
                  <Translate id="homepage.flow.connect.title">
                    Connect the account
                  </Translate>
                </h3>
                <p>
                  <Translate id="homepage.flow.connect.description">
                    Request accounts with eth_requestAccounts or
                    sys_requestAccounts. Pali keeps one active account per dapp
                    origin.
                  </Translate>
                </p>
              </div>
              <div>
                <span className={styles.step}>3</span>
                <h3>
                  <Translate id="homepage.flow.request.title">
                    Request work
                  </Translate>
                </h3>
                <p>
                  <Translate id="homepage.flow.request.description">
                    Send EVM transactions, sign typed data, sign UTXO PSBTs, or
                    create passkey smart accounts with sponsor policy.
                  </Translate>
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
