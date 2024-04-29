import React from 'react';

import rolluxLogo from 'assets/images/rolluxChain.png';
import sysLogo from 'assets/images/sysChain.svg';

interface IFaucetFirstAccessModal {
  onClose?: () => any;
  show?: boolean;
}

export const FaucetAccessModal = () => (
  <div className="z-[88] py-2 justify-center absolute left-[4.3%] top-[8rem] w-[364px] flex items-center rounded-b-[20px] bg-brand-blue400">
    <div className="relative flex items-center">
      <img className="relative z-20 w-4" src={rolluxLogo} />
      <img className="relative left-[-6px] z-10 w-4" src={sysLogo} />
    </div>
    <h1 className="text-xs text-white">
      Grab $SYS with our faucet on the Rollux chain!
    </h1>
  </div>
);
