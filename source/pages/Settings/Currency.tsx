import { Menu, Transition } from '@headlessui/react';
import { Input, Form } from 'antd';
import getSymbolFromCurrency from 'currency-symbol-map';
import React, { useEffect, Fragment, useState, useMemo } from 'react';
import { useSelector } from 'react-redux';

import { Layout, Icon, DefaultModal, NeutralButton } from 'components/index';
import { usePrice, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { formatNumber } from 'utils/index';

const CurrencyView = () => {
  const controller = getController();
  const { navigate } = useUtils();
  const { getFiatAmount } = usePrice();

  //* Selectors
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeAccountId = useSelector(
    (state: RootState) => state.vault.activeAccount.id
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const fiat = useSelector((state: RootState) => state.price.fiat);
  const coins = useSelector((state: RootState) => state.price.coins);

  if (!activeAccount) throw new Error('No account');

  //* Functions
  const convertCurrency = (value: number, toCoin: string) =>
    value * coins[toCoin];

  const convertToCrypto = (value: number, fromCoin: string) =>
    value / coins[fromCoin];

  //* Handlers
  const handleConvert = (value: number, toCoin: string) => {
    setConversorValues({
      crypto: value,
      fiat: convertCurrency(value, toCoin),
    });
  };

  const handleReverseConvert = (value: number, fromCoin: string) => {
    setConversorValues({
      crypto: convertToCrypto(value, fromCoin),
      fiat: value,
    });
  };

  const handleConfirmCurrencyChange = () => {
    setConfirmed(true);
  };

  //* Constants
  const isUnlocked =
    controller.wallet.isUnlocked() && activeAccount.address !== '';

  const fiatCurrency = fiat.asset ? String(fiat.asset).toUpperCase() : 'USD';

  const { syscoin: syscoinBalance, ethereum: ethereumBalance } =
    activeAccount.balances;

  const actualBalance = isBitcoinBased ? syscoinBalance : ethereumBalance;

  //* States
  const [selectedCoin, setSelectedCoin] = useState(String(fiat.asset));
  const [checkValueCoin, setCheckValueCoin] = useState('usd');
  const [confirmed, setConfirmed] = useState(false);
  const [conversorValues, setConversorValues] = useState({
    crypto: actualBalance,
    fiat: convertCurrency(actualBalance, checkValueCoin),
  });

  //* Effects
  useEffect(() => {
    if (isUnlocked && accounts && accounts[activeAccountId]) {
      controller.refresh(true);
    }
  }, [isUnlocked, activeAccountId]);

  useEffect(() => {
    if (selectedCoin) {
      controller.utils.setFiat(
        selectedCoin,
        isBitcoinBased ? 'syscoin' : 'ethereum'
      );
    }
  }, [selectedCoin, isBitcoinBased]);

  const fiatPriceValue = useMemo(() => {
    const getAmount = getFiatAmount(
      actualBalance > 0 ? actualBalance : 0,
      4,
      String(selectedCoin).toUpperCase(),
      true,
      true
    );

    return getAmount;
  }, [
    isUnlocked,
    activeAccount,
    activeAccount.address,
    activeNetwork,
    activeNetwork.chainId,
    selectedCoin,
    fiat.asset,
    fiat.price,
  ]);

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

      <p className="mb-2 text-left text-white text-sm md:max-w-full">
        You can choose and set your preferred currency to see in your wallet.
      </p>

      <div className="flex flex-col gap-y-5 items-center justify-center">
        <Menu as="div" className="relative inline-block text-left">
          <Menu.Button
            disabled={!fiat || !coins}
            className="inline-flex justify-center py-2 w-80 text-white text-sm font-medium bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full"
          >
            <p className="ml-2">
              {selectedCoin ? selectedCoin.toUpperCase() : fiatCurrency}
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
            {fiat && coins && (
              <Menu.Items
                as="div"
                className="scrollbar-styled absolute z-10 mt-2 py-3 w-full h-44 text-brand-white font-poppins bg-bkg-4 border border-fields-input-border rounded-xl shadow-2xl overflow-auto origin-top-right"
              >
                {Object.entries(coins).map(([key]) => (
                  <Menu.Item as="div" key={key}>
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
            <div className="flex gap-x-0.5 items-center justify-center">
              <p className="font-rubik text-5xl font-medium">
                {formatNumber(Number(actualBalance) || 0)}{' '}
              </p>

              <p className="font-poppins md:mt-4">TSYS</p>
            </div>
          ) : (
            <>
              <div className="flex gap-x-0.5 items-center justify-center">
                <p className="font-rubik text-5xl font-medium">
                  {formatNumber(actualBalance || 0)}{' '}
                </p>

                <p className="font-poppins md:mt-4">
                  {activeNetwork.currency
                    ? activeNetwork.currency.toUpperCase()
                    : ''}
                </p>
              </div>

              <p>{fiatPriceValue || 0}</p>
            </>
          )}
        </div>

        <NeutralButton type="button" onClick={handleConfirmCurrencyChange}>
          Save
        </NeutralButton>
      </div>

      <div className="h-max absolute bottom-0 flex flex-col items-center justify-center mt-6 py-4 w-full max-w-2xl bg-bkg-4">
        <p className="text-left text-white text-sm">
          Check your balance in different currencies
        </p>

        <Form
          validateMessages={{ default: '' }}
          id="currency-form"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 8 }}
          onFinish={() => undefined}
          autoComplete="off"
          className="flex flex-col gap-3 items-center justify-center mt-4 text-center text-base md:w-full"
        >
          <Form.Item
            name="receiver"
            className="relative md:w-full md:max-w-md"
            hasFeedback
            rules={[
              {
                required: true,
                message: '',
              },
            ]}
          >
            <Input
              type="number"
              onChange={(event) =>
                handleConvert(Number(event.target.value), checkValueCoin)
              }
              maxLength={20}
              value={Number(conversorValues.crypto)}
              className="input-small"
            />

            <div className="absolute bottom-2 right-4 flex gap-x-3 items-center justify-center">
              <p
                className="cursor-pointer"
                onClick={() =>
                  handleConvert(Number(actualBalance), checkValueCoin)
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
          </Form.Item>

          <Form.Item
            name="receiver"
            className="relative md:w-full md:max-w-md"
            hasFeedback
            rules={[
              {
                required: true,
                message: '',
              },
              () => ({
                validator(_, value) {
                  if (!value) {
                    return Promise.resolve();
                  }

                  return Promise.reject();
                },
              }),
            ]}
          >
            <Input
              type="number"
              maxLength={20}
              onChange={(event) => {
                handleReverseConvert(
                  Number(event.target.value),
                  checkValueCoin
                );
              }}
              value={Number(conversorValues.fiat)}
              className="input-small"
            />

            <div className="absolute bottom-3 right-2 flex gap-x-3 items-center justify-center">
              <Menu as="div" className="relative inline-block text-left">
                <Menu.Button
                  disabled={!fiat || !coins}
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
                  {fiat && coins && (
                    <Menu.Items
                      as="div"
                      className="scrollbar-styled absolute z-10 bottom-10 right-0 mt-2 py-3 w-44 h-56 text-brand-white font-poppins bg-bkg-4 border border-fields-input-border rounded-xl shadow-2xl overflow-auto origin-bottom-right"
                    >
                      {Object.entries(coins).map(([key]) => (
                        <Menu.Item as="div" key={key}>
                          <button
                            key={key}
                            onClick={() => {
                              setCheckValueCoin(key);
                              handleConvert(conversorValues.crypto, key);
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
          </Form.Item>
        </Form>
      </div>
    </Layout>
  );
};

export default CurrencyView;
