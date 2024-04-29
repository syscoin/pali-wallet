import React from 'react';

import { Icon } from '..';
import image from 'assets/images/faucetmodal.png';
import rolluxLogo from 'assets/images/rolluxChain.png';
import sysLogo from 'assets/images/sysChain.svg';

interface IFaucetFirstAccessModal {
  onClose?: () => any;
  show?: boolean;
}

export const FaucetFirstAccessModal = () => (
  <div className="z-[88] border border-brand-blue400 left-[6%] absolute bottom-6 w-[352px] h-[91px]  flex items-center rounded-[20px]  bg-gradient-to-r from-[#7192C6] via-[#436AA8] to-[#314E7C]">
    <div className="w-full relative p-[13px]">
      <div className="relative bottom-[0.5rem] z-[9999]">
        <img className="absolute z-20 w-16" src={rolluxLogo} />
        <img className="absolute right-[13.6rem] z-10 w-16" src={sysLogo} />
      </div>
      <div className="relative ml-32">
        <h1 className="text-base text-white w-[70%]">
          Grab $SYS with our faucet!
        </h1>
      </div>
    </div>
    <img
      className="absolute w-[352px] rounded-[20px] h-[91px] left-0 overflow-hidden"
      src={image}
    />
    <Icon
      name="Close"
      className="cursor-pointer absolute left-[90%] top-[10%] w-6 hover:opacity-70 transition-opacity"
      isSvg
    />
  </div>
);
