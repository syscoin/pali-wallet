import React, { useEffect, useState } from 'react';
import { ImWarning } from 'react-icons/im';
import { useSelector } from 'react-redux';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import { PrimaryButton } from '..';
import { Icon } from '..';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

const FIVE_SECONDS = 5000;

export const Loading = ({
  opacity = 60,
  usePopupSize = true,
}: {
  opacity?: number;
  usePopupSize?: boolean;
}) => {
  const { wallet } = getController(); //todo we need to get keyring to get setActiveAccount fn here

  const isPendingBalances = useSelector(
    (state: RootState) => state.vault.isPendingBalances
  );
  const syscoinNetworks = useSelector(
    (state: RootState) => state.vault.networks
  );

  const activeAccount = useSelector(
    (state: RootState) =>
      state.vault.accounts[state.vault.activeAccount.type][
        state.vault.activeAccount.id
      ]
  );

  const [timeoutError, setTimeoutError] = useState(false);

  const validateTimeoutError = () => {
    if (isPendingBalances) {
      setTimeout(() => {
        setTimeoutError(true);
      }, FIVE_SECONDS);
    }
  };

  const correctSyscoinNetwork = Object.values(syscoinNetworks.syscoin).find(
    (network) => network.chainId === 57
  );

  const connectToSyscoin = async () => {
    setTimeoutError(false);

    if (activeAccount.isImported) {
      // Set the Default UTX0 account to user can return safely to UTX0 Syscoin Network
      wallet.setActiveAccount(0, KeyringAccountType.HDAccount);
    }

    await wallet.setActiveNetwork(correctSyscoinNetwork, 'syscoin');
  };

  useEffect(() => {
    validateTimeoutError();
    return () => {
      setTimeoutError(false);
    };
  }, []);

  return (
    <>
      <div
        className={`${
          usePopupSize && 'min-w-popup min-h-popup'
        } relative z-20 flex flex-col items-center justify-center w-full bg-transparent`}
      >
        <div
          className={`flex items-center justify-center opacity-${opacity} ${
            timeoutError && 'mt-32'
          } `}
        >
          <Icon name="loading" className="text-brand-white animate-spin-slow" />
        </div>
        <div>
          {timeoutError ? (
            <div className="pb-3 px-5 w-full">
              <div
                className={`flex mb-8 mt-5 p-3 text-left border border-dashed opacity-${opacity}`}
                style={{ borderColor: '#DC1515' }}
              >
                <div className="mr-4">
                  <ImWarning
                    color="#DC1515"
                    size={32}
                    style={{ marginTop: '5px' }}
                  />
                </div>

                <div>
                  <span
                    className="text-sm"
                    style={{ color: '#FF1D1D', fontWeight: '600' }}
                  >
                    The RPC you're trying to connect with is taking too long to
                    reply. We recommend change to other provider for that
                    network.
                  </span>
                </div>
              </div>

              <div className="flex justify-center w-full">
                <PrimaryButton
                  width="full"
                  type="button"
                  onClick={() => connectToSyscoin()}
                  disabled={!timeoutError}
                >
                  Connect to default Syscoin Mainnet
                </PrimaryButton>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
};
