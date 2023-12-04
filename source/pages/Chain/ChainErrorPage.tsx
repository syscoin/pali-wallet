import React from 'react';
import { useSelector } from 'react-redux';

import loadImg from 'assets/icons/loading.svg';
import ethChainImg from 'assets/images/ethChain.svg';
import rolluxChainImg from 'assets/images/rolluxChain.png';
import sysChainImg from 'assets/images/sysChain.svg';
import { Button } from 'components/Button';
import { Header } from 'components/Header';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';

export const ChainErrorPage = () => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { navigate } = useUtils();

  const CurrentChains = () => {
    let toChain: React.ReactNode;

    switch (activeNetwork.chainId) {
      case 1:
        toChain = <img src={ethChainImg} alt="eth" width="100px" />;
        break;
      case 57:
        toChain = <img src={sysChainImg} alt="sys" width="100px" />;
        break;
      case 570:
        toChain = <img src={rolluxChainImg} alt="sys" width="100px" />;
        break;
      case 5700:
        toChain = <img src={rolluxChainImg} alt="sys" width="100px" />;
        break;
      default:
        toChain = (
          <div
            className="rounded-full flex items-center justify-center text-brand-blue200 bg-white text-sm"
            style={{ width: '100px', height: '100px' }}
          >
            {activeNetwork.currency}
          </div>
        );
    }

    return (
      <div className="w-4/5 gap-4 flex items-center align-center flex-row">
        {toChain}
      </div>
    );
  };

  return (
    <>
      <Header />
      <div className="gap-4 mt-6 mb-7 w-full flex flex-col justify-center items-center">
        <div className="w-[65px] h-[65px] rounded-[100px] p-[15px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]'">
          <img src={loadImg} />
        </div>
        <span className="text-sm font-normal text-white text-center">
          CONNECTION IS TAKING TOO LONG TO REPLY
        </span>
        <div className="rounded-[20px] bg-brand-blue500 p-5 h-max w-[22rem]">
          <div className="relative flex mb-4">
            <CurrentChains />
            <div className="flex flex-col ml-11">
              <h1 className="text-xs font-light text-white">
                You are trying to connect on:
              </h1>
              <h1 className="text-lg font-bold text-white">
                {activeNetwork.label}
              </h1>
            </div>
          </div>
          <div className="flex flex-col mb-2">
            <div
              className={`bg-brand-blue600 mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800`}
            >
              Go to another network
            </div>
            <div
              className={`bg-brand-blue600 mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800`}
            >
              Edit RPC of current network
            </div>
          </div>
        </div>
        <div className="flex gap-6 justify-between mt-[7.313rem]">
          <Button
            type="submit"
            className="bg-transparent rounded-[100px] w-[10.25rem] h-[40px] text-white text-base font-medium border border-white"
            onClick={() => navigate('/home')}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="bg-white rounded-[100px] w-[10.25rem] h-[40px] text-brand-blue400 text-base font-medium"
          >
            Retry connect
          </Button>
        </div>
      </div>
    </>
  );
};
