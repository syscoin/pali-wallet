import Head from '@docusaurus/Head';
import { useLocation } from '@docusaurus/router';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { PageMetadata, useThemeConfig } from '@docusaurus/theme-common';
import SiteMetadata from '@theme-original/SiteMetadata';
import React from 'react';

export default function SiteMetadataWrapper() {
  const { pathname } = useLocation();
  const { siteConfig } = useDocusaurusContext();
  const { image } = useThemeConfig();

  if (pathname !== '/privacy' && pathname !== '/privacy/') {
    return <SiteMetadata />;
  }

  // The policy is published in English only, so it has no locale alternates.
  const canonical = `${siteConfig.url}/privacy`;
  return (
    <>
      {image && <PageMetadata image={image} />}
      <Head>
        <link rel="canonical" href={canonical} />
        <meta property="og:url" content={canonical} />
        <meta property="og:locale" content="en_US" />
        <meta name="twitter:card" content="summary_large_image" />
        <body />
      </Head>
    </>
  );
}
