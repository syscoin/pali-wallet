import React from 'react';

import { useNetworkInfo } from './NetworkInfo';

export const NetworkList = () => {
  const {
    networkThatNeedsChanging,
    networkDescription,
    selectedNetworkText,
    leftLogo,
    rightLogo,
  } = useNetworkInfo();

  return (
    <div className="rounded-[20px] bg-brand-blue500 p-5 h-max w-[22rem]">
      <div className="relative flex mb-4">
        <img src={leftLogo} className="relative z-[0px]" />
        <img src={rightLogo} className="absolute top-[2px] left-8 z-[1px]" />
        <div className="flex flex-col ml-11">
          <h1 className="text-lg font-bold text-white">
            {networkThatNeedsChanging}
          </h1>
          <h1 className="text-xs font-light text-white">
            {networkDescription}
          </h1>
        </div>
      </div>
      <div className="flex flex-col mb-2">
        <p className="text-brand-gray200 text-xs font-medium mb-2">
          {selectedNetworkText}
        </p>
        <div className="bg-brand-blue600 mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800">
          Syscoin NEVM
        </div>
      </div>
      <div className="flex flex-col">
        <p className="text-brand-gray200 text-xs font-medium mb-2">
          Testnet network:
        </p>
        <div className="bg-brand-blue600 mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800">
          Syscoin NEVM
        </div>
      </div>
      <div className="mt-4">
        <div className="flex justify-center items-center gap-2 mb-4">
          <img src="assets/icons/network.svg" alt="Network Icon" />
          <span className="underline text-white font-normal text-sm">
            Add new network
          </span>
        </div>
        <button className="bg-white rounded-[100px] w-[19.5rem] h-[40px] text-brand-blue400 text-base font-medium">
          Connect
        </button>
      </div>
    </div>
  );
};
