/* eslint-disable */
import React, { FC, useState } from 'react';
import { PrimaryButton, Icon } from 'components/index';;
import { AuthViewLayout } from 'containers/common/Layout';
import { useController } from 'hooks/index';
import { Disclosure } from '@headlessui/react';

const ConnectHardwareWalletView: FC = () => {
  const [selected, setSelected] = useState<boolean>(false);

  const controller = useController();

  const handleCreateHardwareWallet = () => {
    controller.wallet.createHardwareWallet();
  };

  return (
    <AuthViewLayout title="CONNECT HARDWARE WALLET">
      <div className="flex items-center flex-col justify-center w-full">
        <div className="scrollbar-styled text-sm overflow-auto px-4 h-96">
          <p className="text-white text-sm py-3 pl-1 mt-3">
            Select the hardware wallet you'd like to connect to Pali
          </p>

          <p
            className={`${selected ? 'border-brand-deepPink100 bg-brand-navydarker' : 'bg-brand-navyborder border-brand-royalBlue'} rounded-full py-3 px-4 w-44 mx-auto text-center  border  text-sm mb-6 mt-3 cursor-pointer active:bg-brand-navydarker  focus:bg-brand-navydarker`}
            onClick={() => setSelected(!selected)}
          >
            Trezor
          </p>

          <div className="bg-brand-navydarker border border-dashed border-brand-royalBlue text-brand-white mx-2 p-4 text-xs rounded-lg">
            <p>
              <b>Don't have a hardware wallet?</b><br /><br />

              Order a Trezor wallet and keep your funds in cold storage.
            </p>

            <p onClick={() => window.open('https://trezor.io/')}>
              Buy now
            </p>
          </div>

          <Disclosure>
            {({ open }) => (
              <>
                <Disclosure.Button
                  className="my-3 w-80 py-2 px-4 flex justify-between items-center rounded-lg ml-2 border border-brand-royalBlue cursor-pointer transition-all duration-300 bg-brand-navydarker"
                >
                  Learn more

                  <Icon
                    name="select-up"
                    className={`${open ?
                      'transform rotate-180' :
                      ''
                      } mb-1 text-brand-deepPink100`}
                  />

                </Disclosure.Button>

                <Disclosure.Panel>
                  <div className="mx-2 py-2 px-4 flex flex-col justify-start items-start rounded-lg w-80 border border-brand-navyborder cursor-pointer transition-all duration-300 bg-brand-navyborder">
                    <p className="text-sm my-2">1 - Connect a hardware wallet</p>

                    <span className="text-xs mb-4">Connect your hardware wallet directly to your computer.</span>

                    <p className="text-sm my-2">2 - Start using SYS powered sites and more</p>

                    <span className="text-xs mb-1">Use your hardware account like you would with any SYS account. Connect to SYS web3 sites, send SYS, buy and store SPT tokens.</span>
                  </div>

                </Disclosure.Panel>
              </>
            )}
          </Disclosure>
        </div>

        <PrimaryButton
          type="button"
          onClick={handleCreateHardwareWallet}
          disabled={!selected}
        >
          Connect
        </PrimaryButton>
      </div>
    </AuthViewLayout>
  );
};

export default ConnectHardwareWalletView;
