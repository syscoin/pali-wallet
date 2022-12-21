import { RightOutlined } from '@ant-design/icons';
import { ethErrors } from 'helpers/errors';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { browser } from 'webextension-polyfill-ts';

import { Layout, PrimaryButton, SecondaryButton } from 'components/index';
import { useQueryData } from 'hooks/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import cleanErrorStack from 'utils/cleanErrorStack';

const SwitchChain: React.FC = () => {
  const { host, ...data } = useQueryData();
  const { chainId } = data;
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const networks = useSelector((state: RootState) => state.vault.networks);
  const network = networks.ethereum[chainId];
  const { wallet } = getController();

  const onSubmit = async () => {
    setLoading(true);
    try {
      wallet.setActiveNetwork(network, 'ethereum');
    } catch (networkError) {
      return cleanErrorStack(ethErrors.rpc.internal());
    }
    setConfirmed(true);
    setLoading(false);
    const type = data.eventName;
    dispatchBackgroundEvent(`${type}.${host}`, null);
    window.close();
  };
  return (
    <Layout canGoBack={false} title={'Switch Chain'}>
      {!loading && (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="relative top-20 flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
            <h2 className="text-center text-lg">
              Allow {host} to switch the network ?
            </h2>
            <div className="mt-1 px-4 w-full text-center text-xs">
              <span>
                This will switch the selected network within Pali to a
                previously added network
              </span>
            </div>
            <div className="flex flex-col pb-4 pt-4 w-full text-center">
              <span className="text-sm">
                {activeNetwork.label}{' '}
                <RightOutlined className="relative bottom-0.5 text-xl" />{' '}
                {network.label}
              </span>
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
              onClick={onSubmit}
            >
              Switch Network
            </PrimaryButton>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default SwitchChain;
