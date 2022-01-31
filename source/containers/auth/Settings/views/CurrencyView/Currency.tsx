import React, { useEffect, Fragment, useState } from 'react';
import { AuthViewLayout } from 'containers/common/Layout';
import {
  useController,
  usePrice,
  useStore,
  useFormat,
  useUtils,
  useAccount,
} from 'hooks/index';
import { SecondaryButton, Icon, Modal } from 'components/index';
import { Menu, Transition } from '@headlessui/react';
import { Input } from 'antd';
import getSymbolFromCurrency from 'currency-symbol-map';

const CurrencyView = () => {
  const controller = useController();
  const getFiatAmount = usePrice();
  const { activeAccount } = useAccount();

  const { accounts, activeAccountId, fiat, activeNetwork } = useStore();

  const [selectedCoin, setSelectedCoin] = useState(String(fiat.current));
  const [checkValueCoin, setCheckValueCoin] = useState('usd');
  const [confirmed, setConfirmed] = useState(false);

  const [conversorValues, setConversorValues] = useState({
    sys: activeAccount?.balance || 0,
    fiat: 0,
  });

  const { navigate } = useUtils();
  const { formatNumber } = useFormat();

  const handleRefresh = () => {
    controller.wallet.account.getLatestUpdate();
    controller.wallet.account.watchMemPool(accounts[activeAccountId]);
    controller.stateUpdater();
  };

  useEffect(() => {
    if (
      !controller.wallet.isLocked() &&
      accounts.length > 0 &&
      accounts.find((element) => element.id === activeAccountId)
    ) {
      handleRefresh();
    }
  }, [!controller.wallet.isLocked(), accounts.length > 0]);

  const handleSelectCoin = async (coin: string) => {
    setSelectedCoin(coin);
  };

  const handleConvert = (value: number, type: string, comparedCoin: string) => {
    if (type === 'sys') {
      setConversorValues({
        fiat: Number(
          value * fiat.availableCoins[comparedCoin || checkValueCoin]
        ),
        sys: Number(value),
      });

      return;
    }

    setConversorValues({
      fiat: Number(value),
      sys: Number(value * fiat.availableCoins[comparedCoin || checkValueCoin]),
    });
  };

  const handleConfirmCurrencyChange = () => {
    controller.utils.updateFiat(selectedCoin, 'syscoin');

    setConfirmed(true);
  };

  const useFiatCurrency = fiat.current
    ? String(fiat.current).toUpperCase()
    : 'USD';

  return (
    <AuthViewLayout title="FIAT CURRENCY" id="fiat-currency-title">
      {confirmed && (
        <Modal
          type="default"
          onClose={() => navigate('/home')}
          open={confirmed}
          title="Fiat currency set successfully"
          description={`Now you will see the values in your wallet in SYS and ${
            selectedCoin.toUpperCase() || 'USD'
          }`}
        />
      )}

      <p className="text-white text-xs text-left mx-6 my-3">
        You can choose and set your preferred currency to see in your wallet.
      </p>

      <div className="flex flex-col justify-center items-center">
        <Menu as="div" className="relative inline-block text-left">
          <Menu.Button
            disabled={!fiat || !fiat.availableCoins}
            className="bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus inline-flex justify-center w-80 py-2 text-sm font-medium text-white rounded-full"
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
              <Menu.Items className="scrollbar-styled rounded-xl overflow-auto h-44 bg-bkg-4 border border-fields-input-border text-brand-white w-full font-poppins shadow-2xl absolute z-10 mt-2 py-3 origin-top-right">
                {Object.entries(fiat.availableCoins).map(([key]) => (
                  <Menu.Item key={key}>
                    <button
                      key={key}
                      onClick={() => handleSelectCoin(key)}
                      className="hover:text-brand-royalbluemedium text-brand-white font-poppins transition-all duration-300 group border-b border-dashed border-brand-royalblue border-opacity-30 px-4 flex border-0 border-transparent items-center w-full py-2 gap-x-1 text-sm justify-start"
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

        <div className="text-center flex justify-center flex-col items-center">
          {activeNetwork === 'testnet' ? (
            <div className="flex items-center justify-center mt-8 gap-x-0.5">
              <p className="text-5xl font-medium font-rubik">
                {formatNumber(Number(activeAccount?.balance) || 0)}{' '}
              </p>

              <p className="font-poppins mt-4">TSYS</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center mt-8 gap-x-0.5">
                <p className="text-5xl font-medium font-rubik">
                  {formatNumber(activeAccount?.balance || 0)}{' '}
                </p>

                <p className="font-poppins mt-4">SYS</p>
              </div>

              <p>
                {getFiatAmount(
                  activeAccount?.balance || 0,
                  4,
                  String(selectedCoin || (fiat.current ? fiat.current : 'USD'))
                )}
              </p>
            </>
          )}
        </div>

        <div className="mt-8">
          <SecondaryButton type="button" onClick={handleConfirmCurrencyChange}>
            Save
          </SecondaryButton>
        </div>
      </div>

      <div className="bg-bkg-4 fixed flex gap-y-3 justify-center items-center flex-col h-44 bottom-0 left-0 w-full">
        <p className="text-white text-sm mb-2 text-left">
          Check your balance in different currencies
        </p>

        <div className="relative text-sm font-medium text-brand-royalblue ">
          <Input
            type="number"
            onChange={(event) =>
              handleConvert(Number(event.target.value), 'sys', checkValueCoin)
            }
            maxLength={20}
            value={Number(conversorValues.sys)}
            className="bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus flex justify-between items-center w-80 py-2 px-4 rounded-full outline-none"
          />

          <div className="absolute right-4 bottom-1.5 flex justify-center items-center gap-x-3">
            <p
              className="cursor-pointer"
              onClick={() =>
                handleConvert(
                  Number(activeAccount?.balance),
                  checkValueCoin,
                  checkValueCoin
                )
              }
            >
              MAX
            </p>

            <div className="flex justify-center items-center gap-x-3 border-l border-dashed border-gray-700">
              <Icon
                name="dolar"
                wrapperClassname="w-2 ml-4 mb-1.5"
                className="text-brand-royalblue"
              />

              <p>SYS</p>
            </div>
          </div>
        </div>

        <div className="relative text-sm font-medium text-brand-royalblue">
          <Input
            type="number"
            maxLength={20}
            onChange={(event) => {
              handleConvert(
                Number(event.target.value),
                checkValueCoin,
                checkValueCoin
              );
            }}
            value={Number(conversorValues.fiat)}
            className="bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus flex justify-between items-center w-80 py-2 px-4 rounded-full outline-none"
          />
          <div className="absolute right-2 bottom-2 flex justify-center items-center gap-x-3">
            <Menu as="div" className="relative inline-block text-left">
              <Menu.Button
                disabled={!fiat || !fiat.availableCoins}
                className="bg-fields-input-primary gap-x-1 flex justify-center text-sm mr-5 font-medium text-brand-royalblue rounded-full"
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
                  <Menu.Items className="scrollbar-styled rounded-xl overflow-auto h-56 bg-bkg-4 border border-fields-input-border text-brand-white w-44 font-poppins shadow-2xl absolute z-10 right-0 bottom-10 mt-2 py-3 origin-bottom-right">
                    {Object.entries(fiat.availableCoins).map(([key]) => (
                      <Menu.Item key={key}>
                        <button
                          key={key}
                          onClick={() => {
                            setCheckValueCoin(key);
                            handleConvert(0, key, key);
                          }}
                          className="hover:text-brand-royalbluemedium text-brand-white font-poppins transition-all duration-300 group border-b border-dashed border-brand-royalblue border-opacity-30 px-4 flex border-0 border-transparent items-center w-full py-2 gap-x-1 text-sm justify-start"
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
    </AuthViewLayout>
  );
};

export default CurrencyView;
