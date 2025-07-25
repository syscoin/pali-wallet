import { Menu } from '@headlessui/react';
import getSymbolFromCurrency from 'currency-symbol-map';
import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { ArrowDownSvg } from 'components/Icon/Icon';
import { DefaultModal, NeutralButton } from 'components/index';
import { usePrice, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { formatNumber } from 'utils/index';
import { navigateBack } from 'utils/navigationState';

const CurrencyView = () => {
  const { controllerEmitter, isUnlocked: _isUnlocked } = useController();
  const { navigate } = useUtils();
  const { getFiatAmount } = usePrice();
  const { t } = useTranslation();
  const location = useLocation();
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
  // Currencies supported by both CoinGecko and Blockbook (from actual Blockbook API response)
  // This list matches exactly what Blockbook's /api/v2/tickers/currency endpoint returns
  const coins = [
    'aed',
    'ars',
    'aud',
    'bch',
    'bdt',
    'bhd',
    'bits',
    'bmd',
    'bnb',
    'brl',
    'btc',
    'cad',
    'chf',
    'clp',
    'cny',
    'czk',
    'dkk',
    'dot',
    'eos',
    'eth',
    'eur',
    'gbp',
    'gel',
    'hkd',
    'huf',
    'idr',
    'ils',
    'inr',
    'jpy',
    'krw',
    'kwd',
    'link',
    'lkr',
    'ltc',
    'mmk',
    'mxn',
    'myr',
    'ngn',
    'nok',
    'nzd',
    'php',
    'pkr',
    'pln',
    'rub',
    'sar',
    'sats',
    'sek',
    'sgd',
    'sol',
    'thb',
    'try',
    'twd',
    'uah',
    'usd',
    'vef',
    'vnd',
    'xag',
    'xau',
    'xdr',
    'xlm',
    'xrp',
    'yfi',
    'zar',
  ].reduce((acc: any, curr: string) => {
    acc[curr] = 1; // Convert to object format to match existing code
    return acc;
  }, {});

  if (!activeAccount) throw new Error('No account');

  //* Functions
  const handleConfirmCurrencyChange = async () => {
    if (hasUnsavedChanges) {
      // Actually save the currency
      await controllerEmitter(['wallet', 'setFiat'], [selectedCoin]);
      setSavedCoin(selectedCoin); // Update saved state
      setConfirmed(true);
    }
  };

  //* Constants
  const isUnlocked = _isUnlocked && activeAccount.address !== '';

  const fiatCurrency = fiat.asset ? String(fiat.asset).toUpperCase() : 'USD';

  const { syscoin: syscoinBalance, ethereum: ethereumBalance } =
    activeAccount.balances;

  const actualBalance = isBitcoinBased ? syscoinBalance : ethereumBalance;

  //* States
  const [selectedCoin, setSelectedCoin] = useState(String(fiat.asset));
  const [savedCoin, setSavedCoin] = useState(String(fiat.asset)); // Track saved currency
  const [confirmed, setConfirmed] = useState(false);
  const [inputValue, setInputValue] = useState<string>('');

  // Currency to flag mapping for all supported currencies
  const currencyFlags = {
    // Fiat currencies
    usd: '🇺🇸',
    eur: '🇪🇺',
    gbp: '🇬🇧',
    jpy: '🇯🇵',
    cad: '🇨🇦',
    aud: '🇦🇺',
    chf: '🇨🇭',
    cny: '🇨🇳',
    sek: '🇸🇪',
    nzd: '🇳🇿',
    mxn: '🇲🇽',
    sgd: '🇸🇬',
    hkd: '🇭🇰',
    nok: '🇳🇴',
    dkk: '🇩🇰',
    krw: '🇰🇷',
    inr: '🇮🇳',
    brl: '🇧🇷',
    rub: '🇷🇺',
    zar: '🇿🇦',
    try: '🇹🇷',
    pln: '🇵🇱',
    ils: '🇮🇱',
    czk: '🇨🇿',
    twd: '🇹🇼',
    thb: '🇹🇭',
    php: '🇵🇭',
    clp: '🇨🇱',
    aed: '🇦🇪',
    ars: '🇦🇷',
    bdt: '🇧🇩',
    bhd: '🇧🇭',
    bmd: '🇧🇲',
    gel: '🇬🇪',
    huf: '🇭🇺',
    idr: '🇮🇩',
    kwd: '🇰🇼',
    lkr: '🇱🇰',
    mmk: '🇲🇲',
    myr: '🇲🇾',
    ngn: '🇳🇬',
    pkr: '🇵🇰',
    sar: '🇸🇦',
    uah: '🇺🇦',
    vef: '🇻🇪',
    vnd: '🇻🇳',
    // Cryptocurrencies (only official symbols)
    btc: '₿',
    ltc: 'Ł',
    bits: '₿',
    // Others will use the default 💰 fallback
    // Precious metals & special
    xag: '🥈',
    xau: '🥇',
    xdr: '🏦',
  };

  const filteredCoins = Object.keys(coins).filter((code) =>
    code.toLowerCase().includes(inputValue.toLowerCase())
  );

  // Track changes to the saved fiat currency
  useEffect(() => {
    const currentSavedCoin = String(fiat.asset);
    setSavedCoin(currentSavedCoin);
    if (selectedCoin === savedCoin) {
      setSelectedCoin(currentSavedCoin);
    }
  }, [fiat.asset]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = selectedCoin !== savedCoin;

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
    <>
      <DefaultModal
        show={confirmed}
        onClose={() => navigateBack(navigate, location)}
        title={t('settings.fiatCurrencySetSuccessfully')}
        description={`${t('settings.nowYouWill', {
          currency: activeNetwork.currency.toUpperCase(),
        })} ${selectedCoin.toUpperCase() || 'USD'}`}
      />

      <div className="flex flex-col gap-y-6">
        <p className="mb-2 text-left text-white text-sm">
          {t('settings.setYourPreferred')}
        </p>

        <Menu as="div" className="relative inline-block text-left">
          {({ open }) => (
            <>
              <Menu.Button
                disabled={!fiat || !coins}
                className="inline-flex justify-between p-[10px] w-full h-[44px] text-white text-sm font-light bg-brand-blue600 border border-alpha-whiteAlpha300 focus:border-fields-input-borderfocus rounded-[10px]"
              >
                <div className="flex items-center gap-2 ml-2">
                  <span className="text-lg">
                    {currencyFlags[selectedCoin?.toLowerCase()] || '💰'}
                  </span>
                  <div className="flex flex-col items-start">
                    <span className="text-sm font-medium">
                      {selectedCoin ? selectedCoin.toUpperCase() : fiatCurrency}
                    </span>
                    <span className="text-xs text-brand-gray200">
                      {getSymbolFromCurrency(
                        selectedCoin?.toUpperCase() || fiatCurrency
                      )}
                    </span>
                  </div>
                </div>

                <ArrowDownSvg />
              </Menu.Button>

              {fiat && coins && (
                <Menu.Items
                  as="div"
                  className={`scrollbar-styled absolute z-10 px-4 py-5 w-full max-h-80 text-brand-white font-poppins bg-brand-blue600 border border-fields-input-border rounded-[10px] shadow-2xl overflow-auto origin-top-right
                  transform transition-all duration-100 ease-out ${
                    open
                      ? 'opacity-100 scale-100 pointer-events-auto'
                      : 'opacity-0 scale-95 pointer-events-none'
                  }`}
                  static
                >
                  <div className="flex justify-center items-center mb-4">
                    <input
                      className="text-xs text-brand-gray200 w-full h-[40px] py-[11px] px-[20px] bg-brand-blue800 border border-alpha-whiteAlpha300 rounded-[100px]"
                      placeholder="Search currencies..."
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                    />
                  </div>
                  {filteredCoins.map((coin, index) => (
                    <Menu.Item as="div" key={index}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCoin(coin);
                          setInputValue(''); // Clear search when currency is selected
                        }}
                        className={`group flex gap-x-3 items-center justify-start px-4 py-3 w-full hover:text-brand-royalbluemedium text-brand-white font-poppins text-sm border-0 border-b border-dashed border-border-default transition-all duration-300 ${
                          selectedCoin === coin
                            ? 'text-brand-royalbluemedium'
                            : ''
                        }`}
                      >
                        <span className="text-lg flex-shrink-0">
                          {currencyFlags[coin.toLowerCase()] || '💰'}
                        </span>
                        <div className="flex flex-col items-start text-left">
                          <span className="text-sm font-medium">
                            {coin.toUpperCase()}
                          </span>
                          <span className="text-xs text-brand-gray200">
                            {getSymbolFromCurrency(coin.toUpperCase())}
                          </span>
                        </div>
                        {selectedCoin === coin && (
                          <span className="ml-auto text-brand-royalbluemedium">
                            ✓
                          </span>
                        )}
                      </button>
                    </Menu.Item>
                  ))}
                </Menu.Items>
              )}
            </>
          )}
        </Menu>

        <div className="flex flex-col items-center justify-center text-center bg-brand-blue800 rounded-lg p-4">
          <p className="text-brand-gray200 text-xs mb-3">
            {t('components.currentBalance')}
          </p>
          {activeNetwork.chainId === 5700 ? (
            <div className="flex flex-col items-center">
              <div className="flex gap-x-1 items-baseline">
                <p className="font-poppins text-2xl font-medium text-white">
                  {formatNumber(Number(actualBalance) || 0)}
                </p>
                <p className="font-poppins text-sm text-brand-gray300">TSYS</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="flex gap-x-1 items-baseline">
                <p className="font-poppins text-2xl font-medium text-white">
                  {formatNumber(actualBalance || 0)}
                </p>
                <p className="font-poppins text-sm text-brand-gray300">
                  {activeNetwork.currency
                    ? activeNetwork.currency.toUpperCase()
                    : ''}
                </p>
              </div>
              <p className="text-brand-gray200 text-sm mt-1 font-medium">
                {fiatPriceValue || '$0.00'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="w-full px-4 absolute bottom-12 md:static">
        <NeutralButton
          fullWidth={true}
          type="button"
          disabled={!hasUnsavedChanges}
          onClick={handleConfirmCurrencyChange}
        >
          {t('buttons.save')}
        </NeutralButton>
      </div>
    </>
  );
};

export default CurrencyView;
