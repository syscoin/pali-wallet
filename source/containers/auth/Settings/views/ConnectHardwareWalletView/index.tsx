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
      <div className="flex flex-col items-center justify-center w-full">
        <div className="scrollbar-styled px-4 h-85 text-sm overflow-auto">
          <p className="mb-1 mt-8 mx-4 text-white text-sm">
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

          <div className="mb-6 mx-2 p-4 text-brand-white text-xs bg-bkg-4 border border-dashed border-brand-royalblue rounded-lg">
            <p>
              <b>Don't have a hardware wallet?</b>
              <br />
              <br />
              Order a Trezor wallet and keep your funds in cold storage.
            </p>

            <p
              className="mt-2 w-16 hover:text-brand-white text-button-primary cursor-pointer"
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
                  } mt-3 w-80 py-2 px-4 flex justify-between items-center ml-2 border border-bkg-1 cursor-pointer transition-all duration-300 bg-bkg-1`}
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
                  <div className="flex flex-col items-start justify-start mx-2 px-4 py-2 w-80 bg-bkg-3 border border-bkg-3 rounded-b-lg cursor-pointer transition-all duration-300">
                    <p className="my-2 text-sm">
                      1 - Connect a hardware wallet
                    </p>

                    <span className="mb-4 text-xs">
                      Connect your hardware wallet directly to your computer.
                    </span>

                    <p className="my-2 text-sm">
                      2 - Start using SYS powered sites and more
                    </p>

                    <span className="mb-1 text-xs">
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
