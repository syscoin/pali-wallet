import React, { useEffect, Fragment, useState } from 'react';
import { usePrice, useStore, useUtils } from 'hooks/index';
import { formatNumber } from 'utils/index';
import { getController } from 'utils/browser';
import { Layout, SecondaryButton, Icon, DefaultModal } from 'components/index';
import { Menu, Transition } from '@headlessui/react';
import { Input } from 'antd';
import getSymbolFromCurrency from 'currency-symbol-map';

const CurrencyView = () => {
  const controller = getController();
  const { navigate } = useUtils();
  const { getFiatAmount } = usePrice();
  const activeAccount = controller.wallet.account.getActiveAccount();

  if (!activeAccount) throw new Error('No account');

  const { accounts, activeAccountId, fiat, activeNetwork } = useStore();

  const [selectedCoin, setSelectedCoin] = useState(String(fiat.current));
  const [checkValueCoin, setCheckValueCoin] = useState('usd');
  const [confirmed, setConfirmed] = useState(false);

  const { availableCoins } = fiat;
  const convertCurrency = (value: number, toCoin: string) =>
    value * availableCoins[toCoin];

  const convertToSys = (value: number, fromCoin: string) =>
    value / availableCoins[fromCoin];

  const [conversorValues, setConversorValues] = useState({
    sys: activeAccount.balances.syscoin,
    fiat: convertCurrency(activeAccount.balances.syscoin, checkValueCoin),
  });

  const handleConvert = (value: number, toCoin: string) => {
    setConversorValues({
      sys: value,
      fiat: convertCurrency(value, toCoin),
    });
  };

  const handleReverseConvert = (value: number, fromCoin: string) => {
    setConversorValues({
      sys: convertToSys(value, fromCoin),
      fiat: value,
    });
  };

  const handleConfirmCurrencyChange = () => {
    controller.utils.updateFiat(selectedCoin, 'syscoin');

    setConfirmed(true);
  };

  const useFiatCurrency = fiat.current
    ? String(fiat.current).toUpperCase()
    : 'USD';

  const handleRefresh = () => {
    controller.wallet.account.getLatestUpdate();
    controller.wallet.account.watchMemPool(accounts[activeAccountId]);
    controller.stateUpdater();
  };

  useEffect(() => {
    if (
      !controller.wallet.isLocked() &&
      accounts &&
      accounts[activeAccountId]
    ) {
      handleRefresh();
    }
  }, [!controller.wallet.isLocked(), accounts]);

  return (
    <Layout title="FIAT CURRENCY" id="fiat-currency-title">
      <DefaultModal
        show={confirmed}
        onClose={() => navigate('/home')}
        title="Fiat currency set successfully"
        description={`Now you will see the values in your wallet in SYS and ${
          selectedCoin.toUpperCase() || 'USD'
        }`}
      />

      <p className="mx-4 my-3 max-w-xs text-left text-white text-sm md:max-w-full">
        You can choose and set your preferred currency to see in your wallet.
      </p>

      <div className="flex flex-col items-center justify-center">
        <Menu as="div" className="relative inline-block text-left">
          <Menu.Button
            disabled={!fiat || !fiat.availableCoins}
            className="inline-flex justify-center py-2 w-80 text-white text-sm font-medium bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full"
          >
            {getSymbolFromCurrency(
              selectedCoin ? selectedCoin.toUpperCase() : useFiatCurrency
            )}

            <p className="ml-2">
              {selectedCoin ? selectedCoin.toUpperCase() : useFiatCurrency}
            </p>

            <Icon
              name="select-down"
              className="text-brand-royalblue"
              wrapperClassname="w-8 absolute right-28 bottom-3"
            />
          </Menu.Button>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            {fiat && fiat.availableCoins && (
              <Menu.Items className="scrollbar-styled absolute z-10 mt-2 py-3 w-full h-44 text-brand-white font-poppins bg-bkg-4 border border-fields-input-border rounded-xl shadow-2xl overflow-auto origin-top-right">
                {Object.entries(fiat.availableCoins).map(([key]) => (
                  <Menu.Item key={key}>
                    <button
                      key={key}
                      onClick={() => setSelectedCoin(key)}
                      className="group flex gap-x-1 items-center justify-start px-4 py-2 w-full hover:text-brand-royalbluemedium text-brand-white font-poppins text-sm border-0 border-b border-dashed border-brand-royalblue border-transparent border-opacity-30 transition-all duration-300"
                    >
                      {getSymbolFromCurrency(key.toUpperCase())}

                      <p>{key.toUpperCase()}</p>
                    </button>
                  </Menu.Item>
                ))}
              </Menu.Items>
            )}
          </Transition>
        </Menu>

        <div className="flex flex-col items-center justify-center text-center">
          {activeNetwork.chainId === 5700 ? (
            <div className="flex gap-x-0.5 items-center justify-center mt-8">
              <p className="font-rubik text-5xl font-medium">
                {formatNumber(Number(activeAccount?.balances.syscoin) || 0)}{' '}
              </p>

              <p className="font-poppins md:mt-4">TSYS</p>
            </div>
          ) : (
            <>
              <div className="flex gap-x-0.5 items-center justify-center mt-8">
                <p className="font-rubik text-5xl font-medium">
                  {formatNumber(activeAccount?.balances.syscoin || 0)}{' '}
                </p>

                <p className="font-poppins md:mt-4">SYS</p>
              </div>

              <p>
                {getFiatAmount(
                  activeAccount?.balances.syscoin || 0,
                  4,
                  String(selectedCoin || (fiat.current ? fiat.current : 'USD'))
                )}
              </p>
            </>
          )}
        </div>

        <div className="mt-6 md:mt-8">
          <SecondaryButton type="button" onClick={handleConfirmCurrencyChange}>
            Save
          </SecondaryButton>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 flex flex-col gap-y-3 items-center justify-center w-full max-w-2xl h-44 bg-bkg-4 md:bottom-8 md:left-auto">
        <p className="mb-2 text-left text-white text-sm">
          Check your balance in different currencies
        </p>

        <div className="relative text-brand-royalblue text-sm font-medium">
          <Input
            type="number"
            onChange={(event) =>
              handleConvert(Number(event.target.value), checkValueCoin)
            }
            maxLength={20}
            value={Number(conversorValues.sys)}
            className="flex items-center justify-between px-4 py-2 w-80 bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full outline-none"
          />

          <div className="absolute bottom-1.5 right-4 flex gap-x-3 items-center justify-center">
            <p
              className="cursor-pointer"
              onClick={() =>
                handleConvert(
                  Number(activeAccount.balances.syscoin),
                  checkValueCoin
                )
              }
            >
              MAX
            </p>

            <div className="flex gap-x-3 items-center justify-center border-l border-dashed border-gray-700">
              <Icon
                name="dolar"
                wrapperClassname="w-2 ml-4 mb-1.5"
                className="text-brand-royalblue"
              />

              <p>SYS</p>
            </div>
          </div>
        </div>

        <div className="relative text-brand-royalblue text-sm font-medium">
          <Input
            type="number"
            maxLength={20}
            onChange={(event) => {
              handleReverseConvert(Number(event.target.value), checkValueCoin);
            }}
            value={Number(conversorValues.fiat)}
            className="flex items-center justify-between px-4 py-2 w-80 bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full outline-none"
          />
          <div className="absolute bottom-2 right-2 flex gap-x-3 items-center justify-center">
            <Menu as="div" className="relative inline-block text-left">
              <Menu.Button
                disabled={!fiat || !fiat.availableCoins}
                className="flex gap-x-1 justify-center mr-5 text-brand-royalblue text-sm font-medium bg-fields-input-primary rounded-full"
              >
                {getSymbolFromCurrency(checkValueCoin.toUpperCase())}
                {checkValueCoin.toUpperCase()}

                <Icon
                  name="select-down"
                  className="text-brand-royalblue"
                  wrapperClassname="w-8 absolute -right-1 bottom-1"
                />
              </Menu.Button>

              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                {fiat && fiat.availableCoins && (
                  <Menu.Items className="scrollbar-styled absolute z-10 bottom-10 right-0 mt-2 py-3 w-44 h-56 text-brand-white font-poppins bg-bkg-4 border border-fields-input-border rounded-xl shadow-2xl overflow-auto origin-bottom-right">
                    {Object.entries(fiat.availableCoins).map(([key]) => (
                      <Menu.Item key={key}>
                        <button
                          key={key}
                          onClick={() => {
                            setCheckValueCoin(key);
                            handleConvert(conversorValues.sys, key);
                          }}
                          className="group flex gap-x-1 items-center justify-start px-4 py-2 w-full hover:text-brand-royalbluemedium text-brand-white font-poppins text-sm border-0 border-b border-dashed border-brand-royalblue border-transparent border-opacity-30 transition-all duration-300"
                        >
                          {getSymbolFromCurrency(key.toUpperCase())}

                          <p>{key.toUpperCase()}</p>
                        </button>
                      </Menu.Item>
                    ))}
                  </Menu.Items>
                )}
              </Transition>
            </Menu>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default CurrencyView;
