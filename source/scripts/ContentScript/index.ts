import { SupportedWalletMethods } from 'scripts/Background/controllers/MessageHandler/types';

import { provider } from '../Provider/index';

import { paliProvider, providerManager } from './inject';

provider.start();

const inject = (content: string) => {
  const container = document.head || document.documentElement;
  const scriptTag = document.createElement('script');

  scriptTag.setAttribute('async', 'false');
  scriptTag.textContent = `(() => {${content}})()`;

  console.log('injecting content', content);

  container.insertBefore(scriptTag, container.children[0]);

  console.log('content injected', content);
};

inject(
  `window.SUPPORTED_WALLET_METHODS = ${JSON.stringify(SupportedWalletMethods)}`
);
inject(providerManager);
inject(paliProvider);
