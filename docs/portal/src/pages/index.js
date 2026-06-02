/* eslint-disable react/jsx-filename-extension */
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React from 'react';

import styles from './index.module.css';

const featureCards = [
  {
    title: 'MetaMask-compatible EVM dapps',
    description:
      'Use familiar EIP-1193, EIP-6963, permissions, signing, chain management, assets, and batch call flows through window.ethereum.',
    to: '/docs/evm-api/overview',
  },
  {
    title: 'UTXO and Syscoin dapps',
    description:
      'Use window.pali for Syscoin UTXO accounts, PSBT signing, change addresses, xpub-aware state, SPT assets, and Bitcoin-style integrations.',
    to: '/docs/utxo-syscoin-api/overview',
  },
  {
    title: 'Passkeys for institutions',
    description:
      'Create and recover passkey smart accounts, attach sponsor policy, and submit atomic batches with a single WebAuthn approval.',
    to: '/docs/passkeys-institutions/overview',
  },
];

function HomepageHeader() {
  return (
    <header className={styles.hero}>
      <div className="container">
        <p className={styles.eyebrow}>Pali Wallet documentation</p>
        <h1 className={styles.heroTitle}>
          One wallet surface for EVM, Syscoin UTXO, Bitcoin-style apps, and
          passkey accounts.
        </h1>
        <p className={styles.heroSubtitle}>
          Pali is a secure browser extension wallet for users, developers, and
          institutions building across account-based and UTXO-based chains.
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--primary button--lg"
            to="/docs/developers/provider-discovery"
          >
            Build with Pali
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/docs/users/getting-started"
          >
            User guides
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
      title="Pali Wallet Docs"
      description="Developer, user, and institutional documentation for Pali Wallet."
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
            <h2>Choose the right integration path</h2>
            <div className={styles.flowGrid}>
              <div>
                <span className={styles.step}>1</span>
                <h3>Detect providers</h3>
                <p>
                  Prefer EIP-6963 for EVM dapps, then use window.ethereum.
                  Syscoin UTXO and Bitcoin-like flows use window.pali.
                </p>
              </div>
              <div>
                <span className={styles.step}>2</span>
                <h3>Connect the account</h3>
                <p>
                  Request accounts with eth_requestAccounts or
                  sys_requestAccounts. Pali keeps one active account per dapp
                  origin.
                </p>
              </div>
              <div>
                <span className={styles.step}>3</span>
                <h3>Request work</h3>
                <p>
                  Send EVM transactions, sign typed data, sign UTXO PSBTs, or
                  create passkey smart accounts with sponsor policy.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
