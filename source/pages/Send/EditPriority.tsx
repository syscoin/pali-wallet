import { Disclosure } from '@headlessui/react';
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton, Icon } from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

import { PriorityBar } from './components/PriorityBar';

export const EditPriorityFee = () => {
  const controller = getController();
  const { navigate } = useUtils();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const { register } = useForm();

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();
  const { ...externalTx } = useQueryData();
  const isExternal = Boolean(externalTx.amount);
  const tx = isExternal ? externalTx : state.tx;

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [priority, setPriority] = useState<number>(0);

  return (
    <Layout title="EDIT PRIORITY">
      <DefaultModal
        show={confirmed}
        title="New priority fee set"
        description="Your priority fee has been successfully set."
        onClose={() => {
          controller.refresh(false);
          if (isExternal) window.close();
          else navigate('/send/eth', { state: { priority } });
        }}
      />

      <p className="flex flex-col items-center justify-center text-center font-poppins text-xs">
        <span className="font-rubik text-base">
          {`${tx.amount} ${' '} ${
            tx.token ? tx.token.symbol : activeNetwork.currency?.toUpperCase()
          }`}
        </span>

        <span className="text-brand-royalblue">
          <b>Max fee</b>: {tx.fee}
        </span>

        <span className="mt-4">Likely in 30 seconds</span>
      </p>

      <PriorityBar
        priority={priority}
        onClick={(value) => setPriority(value)}
      />

      <Disclosure>
        {({ open }) => (
          <>
            <Disclosure.Button
              className={`${
                open ? 'rounded-t-lg' : 'rounded-lg'
              } mt-8 w-80 md:w-full py-2 px-4 flex justify-between items-center mx-auto border border-bkg-1 cursor-pointer transition-all duration-300 bg-bkg-1 text-xs`}
            >
              Advanced options
              <Icon
                name="select-down"
                className={`${
                  open ? 'transform rotate-180' : ''
                } mb-1 text-brand-deepPink100`}
              />
            </Disclosure.Button>

            <Disclosure.Panel
              as="div"
              className="scrollbar-styled h-24 overflow-auto"
            >
              <form className="flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-left md:max-w-md">
                <input
                  type="text"
                  placeholder="Gas Limit"
                  className="input-extra-small relative md:w-full"
                  {...register('gasLimit', {
                    required: false,
                  })}
                />

                <input
                  type="text"
                  placeholder="Max Priority Fee (GWEI)"
                  className="input-extra-small relative md:w-full"
                  {...register('maxPriorityFee', {
                    required: false,
                  })}
                />

                <input
                  type="text"
                  placeholder="Max Fee (GWEI)"
                  className="input-extra-small relative md:w-full"
                  {...register('maxFee', {
                    required: false,
                  })}
                />
              </form>
            </Disclosure.Panel>
          </>
        )}
      </Disclosure>

      <p className="mt-3 text-center text-brand-white text-xs">
        How should I choose
      </p>

      <NeutralButton
        onClick={() => setConfirmed(true)}
        type="button"
        className="absolute bottom-12 md:static md:mt-10"
      >
        Confirm
      </NeutralButton>
    </Layout>
  );
};
