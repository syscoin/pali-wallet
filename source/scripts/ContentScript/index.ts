import { provider } from '../Provider/index';

import { paliProvider, providerManager } from './inject';

provider.start();

const inject = (content: string) => {
  const container = document.head || document.documentElement;
  const scriptTag = document.createElement('script');

  scriptTag.setAttribute('async', 'false');
  scriptTag.textContent = `(() => {${content}})()`;

  container.insertBefore(scriptTag, container.children[0]);
};

inject(
  `window.SUPPORTED_WALLET_METHODS = ${JSON.stringify(
    window.SUPPORTED_WALLET_METHODS
  )}`
);
inject(providerManager);
inject(paliProvider);
