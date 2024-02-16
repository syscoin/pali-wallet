import React from 'react';

import ethChainImg from 'assets/images/ethChain.svg';
import rolluxChainImg from 'assets/images/rolluxChain.png';
import sysChainImg from 'assets/images/sysChain.svg';

export const getChainImage = (chain: number) => {
  let chainImage: string;

  switch (chain) {
    case 1:
      chainImage = ethChainImg;
      break;
    case 57:
      chainImage = sysChainImg;
      break;
    case 570:
      chainImage = rolluxChainImg;
      break;
    case 5700:
      chainImage = rolluxChainImg;
      break;
    default:
      <div
        className="rounded-full flex items-center justify-center text-brand-blue200 bg-white text-sm"
        style={{ width: '100px', height: '100px' }}
      ></div>;
  }
  return chainImage;
};
