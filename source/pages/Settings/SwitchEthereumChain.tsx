import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { browser } from 'webextension-polyfill-ts';

import { Layout, PrimaryButton, SecondaryButton } from 'components/index';
import { useQueryData } from 'hooks/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';

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
      wallet
        .setActiveNetwork(network, 'ethereum')
        .then(async ({ networkVersion }: any) => {
          const tabs = await browser.tabs.query({
            windowType: 'normal',
          });

          for (const tab of tabs) {
            browser.tabs.sendMessage(Number(tab.id), {
              type: 'CHAIN_CHANGED',
              data: { networkVersion, chainId },
            });
          }
        });
    } catch (networkError) {
      return {
        code: -32603,
        message: `Error switching network ${networkError}`,
      };
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
          <div className="flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
            <h1>{activeNetwork.label}</h1>
          </div>
          <div className="flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
            <h1 className="text-lg">{host}</h1>
            <h2 className="text-lg">Allow this site to switch the network ?</h2>
            <div className="scrollbar-styled mt-1 px-4 w-full h-40 text-xs overflow-auto">
              <span>
                This will switch the selected network within Pali to a
                previously added network
              </span>
            </div>
            <div className="flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
              <span>
                Switch from {activeNetwork.label} to {network.label}
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
