import React, { useState } from 'react';
import { browser } from 'webextension-polyfill-ts';

import {
  DefaultModal,
  Layout,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
const CustomRPCExternal = () => {
  const { host, ...data } = useQueryData();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { alert } = useUtils();
  const controller = getController();
  const wallet = controller.wallet;
  const onSubmit = async (customRpc: any) => {
    setLoading(true);

    try {
      await controller.wallet.addCustomRpc(customRpc).then((network) => {
        setConfirmed(true);
        setLoading(false);
        const type = data.eventName;
        dispatchBackgroundEvent(`${type}.${host}`, null);
        wallet.setActiveNetwork(network, 'ethereum');
      });
    } catch (error: any) {
      alert.removeAll();
      alert.error(error.message);

      setLoading(false);
    }
  };

  return (
    <Layout canGoBack={false} title={'Add New Chain'}>
      <DefaultModal
        show={confirmed}
        onClose={window.close}
        title={'RPC successfully added.'}
        buttonText="Got it"
      />

      <div className="flex flex-col items-center justify-center w-full">
        <div className="relative top-5 flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
          <h2 className="text-center text-lg">
            Allow {host} to add a network ?
          </h2>
          <div className="flex flex-col mt-1 px-4 w-full text-center text-xs">
            <span>This will allow this network to be used within Pali.</span>
            <span>
              <b>Pali does not verify custom networks.</b>
            </span>
          </div>
          <div className="flex flex-col items-center justify-center w-full">
            <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                Network Name
                <span className="text-brand-royalblue text-xs">
                  {data.label}
                </span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                Network URL
                <span className="text-brand-royalblue text-xs">{data.url}</span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                Chain ID
                <span className="text-brand-royalblue text-xs">
                  {data.chainId}
                </span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                Currency Symbol
                <span className="text-brand-royalblue text-xs">
                  {data.symbol}
                </span>
              </p>
            </div>
          </div>
        </div>

        <div className="absolute bottom-10 flex items-center justify-between px-10 w-full md:max-w-2xl">
          <SecondaryButton type="button" onClick={window.close}>
            Cancel
          </SecondaryButton>

          <PrimaryButton
            type="submit"
            disabled={confirmed}
            loading={loading}
            onClick={() => onSubmit(data)}
          >
            Add Network
          </PrimaryButton>
        </div>
      </div>
    </Layout>
  );
};

export default CustomRPCExternal;
