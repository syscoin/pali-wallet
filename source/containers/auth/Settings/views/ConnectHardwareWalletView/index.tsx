import React, { FC, useState } from 'react';
import { SecondaryButton, Icon } from 'components/index';
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
    <AuthViewLayout title="HARDWARE WALLET">
      <div className="flex items-center flex-col justify-center w-full">
        <div className="scrollbar-styled text-sm overflow-auto px-4 h-85">
          <p className="text-white text-sm mt-8 mb-1 mx-4">
            Select the hardware wallet you'd like to connect to Pali
          </p>

          <p
            className={`${
              selected
                ? 'bg-bkg-3 border-brand-deepPink'
                : 'bg-bkg-1 border-brand-royalblue'
            } rounded-full py-2 w-72 mx-auto text-center  border  text-sm my-6 cursor-pointer`}
            onClick={() => setSelected(!selected)}
          >
            Trezor
          </p>

          <div className="bg-bkg-4 border border-dashed border-brand-royalblue text-brand-white mx-2 p-4 text-xs rounded-lg mb-6">
            <p>
              <b>Don't have a hardware wallet?</b>
              <br />
              <br />
              Order a Trezor wallet and keep your funds in cold storage.
            </p>

            <p
              className="cursor-pointer hover:text-brand-white mt-2 w-16 text-button-primary buy-now-btn"
              onClick={() => window.open('https://trezor.io/')}
            >
              Buy now
            </p>
          </div>

          <Disclosure>
            {({ open }) => (
              <>
                <Disclosure.Button
                  className={`${
                    open ? 'rounded-t-lg' : 'rounded-lg'
                  } mt-3 w-80 py-2 px-4 flex justify-between items-center ml-2 border border-bkg-1 cursor-pointer transition-all duration-300 bg-bkg-1 learn-more-btn`}
                >
                  Learn more
                  <Icon
                    name="select-down"
                    className={`${
                      open ? 'transform rotate-180' : ''
                    } mb-1 text-brand-deepPink100`}
                  />
                </Disclosure.Button>

                <Disclosure.Panel>
                  <div className="mx-2 py-2 px-4 flex flex-col justify-start items-start rounded-b-lg w-80 border border-bkg-3 cursor-pointer transition-all duration-300 bg-bkg-3">
                    <p className="text-sm my-2">
                      1 - Connect a hardware wallet
                    </p>

                    <span className="text-xs mb-4">
                      Connect your hardware wallet directly to your computer.
                    </span>

                    <p className="text-sm my-2">
                      2 - Start using SYS powered sites and more
                    </p>

                    <span className="text-xs mb-1">
                      Use your hardware account like you would with any SYS
                      account. Connect to SYS web3 sites, send SYS, buy and
                      store SPT tokens.
                    </span>
                  </div>
                </Disclosure.Panel>
              </>
            )}
          </Disclosure>
        </div>

        <div className="absolute bottom-12">
          <SecondaryButton
            type="button"
            onClick={handleCreateHardwareWallet}
            disabled={!selected}
          >
            Connect
          </SecondaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};

export default ConnectHardwareWalletView;
