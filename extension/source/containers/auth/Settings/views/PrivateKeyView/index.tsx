import React from 'react';
import { useFormat, useUtils, useStore, useController } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout';
import { Icon, Button } from 'components/index';
import { IAccountState } from 'state/wallet/types';
import { Disclosure } from '@headlessui/react';

const PrivateKeyView = () => {
  const controller = useController();
  const { history, useCopyClipboard } = useUtils();
  const { accounts } = useStore();
  const { ellipsis } = useFormat();

  const [copied, copyText] = useCopyClipboard();

  const sysExplorer = controller.wallet.account.getSysExplorerSearch();

  return (
    <AuthViewLayout title="XPUB">
      <ul className="text-sm overflow-auto px-4 h-96">
        {accounts.map((account: IAccountState) => {
          return (
            <Disclosure
              key={account.id}
            >
              {({ open }) => (
                <>
                  <Disclosure.Button
                    className="my-3 py-2 px-4 flex justify-between items-center rounded-lg w-full border border-brand-royalBlue cursor-pointer transition-all duration-300 bg-brand-navydarker"
                  >
                    {account.label}

                    <Icon
                      name="select-up"
                      className={`${open ?
                        'transform rotate-180' :
                        ''
                        } mb-1 text-brand-deepPink100`}
                    />

                  </Disclosure.Button>

                  <Disclosure.Panel>
                    <div
                      className="my-3 py-4 px-4 rounded-lg w-full border border-dashed border-brand-royalBlue flex flex-col transition-all duration-300 bg-brand-navydarker text-sm text-brand-white border-t-0 rounded-t-none"
                    >
                      <span>XPUB</span>

                      <span className="flex justify-between gap-x-1 items-center w-full mt-4 cursor-pointer rounded-lg bg-brand-navydark border border-dashed border-brand-deepPink100 p-2 text-sm">
                        WARNING: This is your account root indexer to check your full balance for this account, it isn’t a receiving address. DO NOT SEND FUNDS TO THIS ADDRESS, YOU WILL LOOSE THEM!
                      </span>

                      <div
                        className="flex justify-between gap-x-1 items-center w-full mt-4 cursor-pointer rounded-lg bg-brand-navydarker hover:bg-brand-navydark transition-all duration-200 border border-dashed border-brand-royalBlue p-2"
                        onClick={() => copyText(account.xpub)}
                      >
                        <p>{ellipsis(account.xpub, 4, 16)}</p>

                        <Icon name="copy" className="text-brand-deepPink100 mb-1" />
                      </div>

                      <div
                        className="flex justify-between mt-4 items-center gap-x-1 cursor-pointer rounded-lg bg-brand-navydarker hover:bg-brand-navydark transition-all duration-200 border border-dashed border-brand-royalBlue p-2"
                        onClick={() => window.open(`${sysExplorer}/xpub/${account.xpub}`)}
                      >
                        <p>View on explorer</p>

                        <Icon name="select" className="text-brand-deepPink100 mb-1" />
                      </div>
                    </div>

                  </Disclosure.Panel>
                </>
              )}
            </Disclosure>
          )
        })}
      </ul>

      <Button
        type="button"
        className="bg-brand-navydarker"
        classNameBorder="absolute bottom-8 ml-28"
        onClick={() => history.push('/home')}
      >
        {copied ? 'Copied' : 'Close'}
      </Button>
    </AuthViewLayout >
  );
};

export default PrivateKeyView;
