import { Menu, Transition } from '@headlessui/react';
import getSymbolFromCurrency from 'currency-symbol-map';
import React, { useEffect, Fragment, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Layout, Icon, DefaultModal, NeutralButton } from 'components/index';
import { usePrice, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { formatNumber } from 'utils/index';

const CurrencyView = () => {
  const { controllerEmitter, isUnlocked: _isUnlocked } = useController();
  const { navigate } = useUtils();
  const { getFiatAmount } = usePrice();
  const { t } = useTranslation();
  //* Selectors
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const fiat = useSelector((state: RootState) => state.price.fiat);
  const coins = useSelector((state: RootState) => state.price.coins);

  if (!activeAccount) throw new Error('No account');

  //* Functions
  const handleConfirmCurrencyChange = () => {
    setConfirmed(true);
  };

  //* Constants
  const isUnlocked = _isUnlocked && activeAccount.address !== '';

  const fiatCurrency = fiat.asset ? String(fiat.asset).toUpperCase() : 'USD';

  const { syscoin: syscoinBalance, ethereum: ethereumBalance } =
    activeAccount.balances;

  const actualBalance = isBitcoinBased ? syscoinBalance : ethereumBalance;

  //* States
  const [selectedCoin, setSelectedCoin] = useState(String(fiat.asset));
  const [confirmed, setConfirmed] = useState(false);
  const [inputValue, setInputValue] = useState<string>('');

  const filteredCoins = Object.keys(coins).filter((code) =>
    code.toLowerCase().includes(inputValue.toLowerCase())
  );

  useEffect(() => {
    if (selectedCoin) {
      controllerEmitter(['wallet', 'setFiat'], [selectedCoin]);
    }
  }, [selectedCoin]);

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
    <Layout title={t('settings.fiatCurrency')} id="fiat-currency-title">
      <DefaultModal
        show={confirmed}
        onClose={() => navigate('/home')}
        title={t('settings.fiatCurrencySetSuccessfully')}
        description={`${t('settings.nowYouWill', {
          currency: activeNetwork.currency.toUpperCase(),
        })} ${selectedCoin.toUpperCase() || 'USD'}`}
      />

      <p className="mb-2 text-left text-white text-sm md:max-w-full">
        {t('settings.setYourPreferred')}
      </p>

      <div className="flex flex-col gap-y-12">
        <Menu as="div" className="relative inline-block text-left">
          <Menu.Button
            disabled={!fiat || !coins}
            className="inline-flex justify-between p-[10px] w-[352px] h-[44px] text-white text-sm font-light bg-brand-blue600 border border-alpha-whiteAlpha300 focus:border-fields-input-borderfocus rounded-[10px]"
          >
            <p className="ml-2">
              {selectedCoin ? selectedCoin.toUpperCase() : fiatCurrency}
            </p>

            <Icon name="ArrowDown" isSvg />
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
                className="scrollbar-styled absolute z-10 px-4 py-5 w-full h-80 text-brand-white font-poppins bg-brand-blue600 border border-fields-input-border rounded-[10px] shadow-2xl overflow-auto origin-top-right"
              >
                <div className="flex justify-center items-center mb-[1px]">
                  <input
                    className="text-xs text-brand-gray200 w-[304px] h-[40px] py-[11px] px-[20px] bg-brand-blue800 border border-alpha-whiteAlpha300 rounded-[100px]"
                    placeholder="Search"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                  />
                </div>
                {filteredCoins.map((coin, index) => (
                  <Menu.Item as="div" key={index}>
                    <button
                      key={index}
                      onClick={() => {
                        setSelectedCoin(coin);
                        setInputValue(''); // Clear search when currency is selected
                      }}
                      className="group flex gap-x-1 items-center justify-start px-4 py-2 w-full hover:text-brand-royalbluemedium text-brand-white font-poppins text-sm border-0 border-b border-dashed border-border-default transition-all duration-300"
                    >
                      {getSymbolFromCurrency(coin.toUpperCase())}

                      <p>{coin.toUpperCase()}</p>
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
              <p className="font-poppins text-[50px] font-medium">
                {formatNumber(Number(actualBalance) || 0)}{' '}
              </p>

              <p className="font-poppins text-lg md:mt-4">TSYS</p>
            </div>
          ) : (
            <div className="flex flex-col justify-center items-center">
              <div className="flex w-full h-full gap-1 items-end">
                <p className="flex font-poppins text-[50px] font-medium">
                  {formatNumber(actualBalance || 0)}{' '}
                </p>

                <p className="font-poppins h-max text-lg">
                  {activeNetwork.currency
                    ? activeNetwork.currency.toUpperCase()
                    : ''}
                </p>
              </div>

              <p className="text-brand-gray200 mt-1">{fiatPriceValue || 0}</p>
            </div>
          )}
        </div>
        <div className="w-full relative bottom-[-8rem] right-[0%] md:static">
          <NeutralButton
            fullWidth={true}
            type="button"
            onClick={handleConfirmCurrencyChange}
          >
            {t('buttons.save')}
          </NeutralButton>
        </div>
      </div>
    </Layout>
  );
};

export default CurrencyView;
