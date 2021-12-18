import React, { FC, useState } from 'react';
import { Button, Icon } from 'components/index';;
import { AuthViewLayout } from 'containers/common/Layout';

import { Form, Input } from 'antd';
import { WarningCard } from 'components/Cards';
import { useUtils } from 'hooks/useUtils';
import { Disclosure } from '@headlessui/react';

const ConnectHardwareWalletView: FC = () => {
  const [selected, setSelected] = useState<boolean>(false);

  const { history } = useUtils();

  return (
    <AuthViewLayout title="CONNECT HARDWARE WALLET">
      <div className="flex items-center flex-col justify-center w-full">
        <div className="text-sm overflow-auto px-4 h-96">
          <p className="text-white text-sm py-3 pl-1 mt-3">
            Select the hardware wallet you'd like to connect to Pali
          </p>

          <p
            className="rounded-full py-3 px-4 w-44 mx-auto text-center bg-brand-navyborder border border-brand-royalBlue text-sm mb-6 mt-3"
          >
            Trezor
          </p>

          <div className="bg-brand-navydarker border border-dashed border-brand-royalBlue text-brand-white mx-2 p-4 text-xs rounded-lg">
            <p>
              <b>Don't have a hardware wallet?</b><br />

              Order a Trezor wallet and keep your funds in cold storage.
            </p>

            <p onClick={() => window.open('https://trezor.io/')}>
              Buy now
            </p>
          </div>

          <Disclosure>
            {({ open }) => (
              <>
                <Disclosure.Button>
                  <Disclosure.Button
                    className="my-3 py-2 px-4 flex justify-between items-center rounded-lg w-full border border-brand-royalBlue cursor-pointer transition-all duration-300 bg-brand-navydarker"
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
                </Disclosure.Button>

                <Disclosure.Panel>
                  <div className="mx-2 my-6 py-2 px-4 flex justify-between items-center rounded-lg w-80 border border-brand-royalBlue cursor-pointer transition-all duration-300 bg-brand-navydarker">
                    <p>
                      1 - Connect a hardware wallet
                      Connect your hardware wallet directly to your computer.

                      2 - Start using sys powered sites and more!
                      Use your hardware account like you would with any SYS account. Connect to SYS web3 sites, send SYS, buy and store SPT tokens.

                    </p>
                  </div>

                </Disclosure.Panel>
              </>
            )}
          </Disclosure>
        </div>

        <Button
          type="button"
          className="bg-brand-navydarker"
          classNameBorder="absolute bottom-12"
          onClick={() => history.push('/home')}
          disabled={!selected}
        >
          Connect
        </Button>
      </div>
    </AuthViewLayout>
  );
};

export default ConnectHardwareWalletView;
