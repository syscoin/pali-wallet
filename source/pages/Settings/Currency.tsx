import { Popover } from '@headlessui/react';
import getSymbolFromCurrency from 'currency-symbol-map';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { ArrowDownSvg } from 'components/Icon/Icon';
import { Button, DefaultModal, PageActionFooter } from 'components/index';
import { usePrice, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { formatNumber } from 'utils/index';
import { navigateBack } from 'utils/navigationState';

const CurrencyView = () => {
  const { controllerEmitter } = useController();
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
    if (!hasUnsavedChanges || savingRef.current) return;
    const currencyToSave = selectedCoin.toLowerCase();
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      await controllerEmitter(['wallet', 'saveFiatCurrency'], [currencyToSave]);
      setSavedCoin(currencyToSave);
      setConfirmed(true);
    } catch {
      setSaveError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  //* Constants
  const { syscoin: syscoinBalance, ethereum: ethereumBalance } =
    activeAccount.balances;

  const actualBalance = isBitcoinBased ? syscoinBalance : ethereumBalance;

  //* States
  const initialCurrency = (fiat.asset || 'usd').toLowerCase();
  const [selectedCoin, setSelectedCoin] = useState<string>(initialCurrency);
  const [savedCoin, setSavedCoin] = useState<string>(initialCurrency); // Track saved currency
  const [confirmed, setConfirmed] = useState(false);
  const [inputValue, setInputValue] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const savingRef = useRef(false);
  const draftEdited = useRef(false);

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
    if (fiat.asset) {
      const lowerAsset = fiat.asset.toLowerCase();
      setSavedCoin(lowerAsset);
      // Price refreshes or another open wallet view can update the saved fiat
      // while this form has an unsaved selection. Keep that local choice.
      if (!draftEdited.current) setSelectedCoin(lowerAsset);
    }
  }, [fiat.asset]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = selectedCoin !== savedCoin;

  const fiatPriceValue = useMemo(() => {
    // The quote belongs to the saved currency until Save returns a new quote.
    // An unsaved selection must not relabel that amount with different units.
    const getAmount = getFiatAmount(
      actualBalance > 0 ? actualBalance : 0,
      4,
      initialCurrency.toUpperCase(),
      true,
      true
    );

    return getAmount;
  }, [actualBalance, initialCurrency, getFiatAmount]);

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

      <div className="flex flex-col gap-y-6 items-center justify-center text-center w-full">
        <p className="mb-2 text-left text-white text-sm">
          {t('settings.setYourPreferred')}
        </p>

        <Popover
          as="div"
          className="relative inline-block w-full max-w-[352px] text-left"
        >
          {({ open, close }) => (
            <>
              <Popover.Button
                aria-label={t('settings.setYourPreferred')}
                disabled={!fiat || !coins || saving}
                className="inline-flex justify-between p-[10px] w-full h-[44px] text-white text-sm font-light bg-brand-blue600 border border-alpha-whiteAlpha300 focus:border-fields-input-borderfocus rounded-[10px] hover:bg-brand-blue500 hover:bg-opacity-20 transition-all duration-200 group"
              >
                <div className="flex items-center gap-2 ml-2">
                  <span className="text-lg transform transition-transform duration-300 group-hover:scale-110">
                    {currencyFlags[selectedCoin.toLowerCase()] || '💰'}
                  </span>
                  <div className="flex flex-col items-start">
                    <span className="text-sm font-medium">
                      {selectedCoin.toUpperCase()}
                    </span>
                    <span className="text-xs text-brand-gray200">
                      {getSymbolFromCurrency(selectedCoin.toUpperCase())}
                    </span>
                  </div>
                </div>

                <ArrowDownSvg
                  className={`transform transition-transform duration-200 ${
                    open ? 'rotate-180' : ''
                  }`}
                />
              </Popover.Button>

              {fiat && coins && (
                <Popover.Panel
                  as="div"
                  focus
                  className={`scrollbar-styled absolute z-10 px-4 py-5 w-full max-h-80 text-brand-white font-poppins bg-brand-blue600 border border-fields-input-border rounded-[10px] shadow-2xl overflow-auto origin-top-right
                  transform transition-all duration-100 ease-out ${
                    open
                      ? 'opacity-100 scale-100 pointer-events-auto'
                      : 'opacity-0 scale-95 pointer-events-none'
                  }`}
                >
                  <div className="flex justify-center items-center mb-4">
                    <input
                      className="text-xs text-brand-gray200 w-full h-[40px] py-[11px] px-[20px] bg-brand-blue800 border border-alpha-whiteAlpha300 rounded-[100px]"
                      aria-label={t('settings.searchCurrencies')}
                      placeholder={t('settings.searchCurrencies')}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                    />
                  </div>
                  {filteredCoins.map((coin) => (
                    <button
                      key={coin}
                      type="button"
                      onClick={() => {
                        draftEdited.current = true;
                        setSelectedCoin(coin.toLowerCase());
                        setInputValue(''); // Clear search when currency is selected
                        setSaveError(false);
                        close();
                      }}
                      className={`group flex gap-x-3 items-center justify-start px-4 py-3 w-full hover:text-brand-royalbluemedium text-brand-white font-poppins text-sm border-0 border-b border-dashed border-border-default transition-all duration-200 hover:bg-brand-blue500 hover:bg-opacity-20 rounded-lg ${
                        selectedCoin === coin.toLowerCase()
                          ? 'text-brand-royalbluemedium bg-brand-blue500 bg-opacity-20'
                          : ''
                      }`}
                    >
                      <span
                        className={`text-lg flex-shrink-0 transform transition-transform duration-200 group-hover:scale-110 ${
                          selectedCoin === coin.toLowerCase() ? 'scale-110' : ''
                        }`}
                      >
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
                      {selectedCoin === coin.toLowerCase() && (
                        <span className="ml-auto text-brand-royalbluemedium">
                          ✓
                        </span>
                      )}
                    </button>
                  ))}
                  {filteredCoins.length === 0 && (
                    <p
                      role="status"
                      className="px-4 py-3 text-sm text-content-secondary"
                    >
                      {t('settings.noCurrenciesFound')}
                    </p>
                  )}
                </Popover.Panel>
              )}
            </>
          )}
        </Popover>

        <div
          className="flex w-full max-w-[352px] flex-col items-center justify-center text-center bg-brand-blue800 rounded-lg p-6 border border-brand-blue600 hover:border-brand-blue500 transition-all duration-200 group mx-auto"
          key={`balance-${initialCurrency}`}
        >
          <p className="text-brand-gray200 text-xs mb-4">
            {t('components.currentBalance')}
          </p>
          <div className="flex items-center gap-4 w-full">
            <span className="text-4xl transform transition-transform duration-200 group-hover:scale-110">
              {currencyFlags[initialCurrency] || '💰'}
            </span>
            {activeNetwork.chainId === 5700 ? (
              <div className="flex flex-col items-start min-w-0 w-full">
                <div className="flex flex-wrap gap-x-1 items-baseline min-w-0 w-full">
                  <p className="font-poppins text-2xl font-medium text-white truncate max-w-full">
                    {formatNumber(Number(actualBalance) || 0)}
                  </p>
                  <p
                    className="font-poppins text-sm text-brand-gray300 min-w-0 max-w-full break-all text-left"
                    title={activeNetwork.currency?.toUpperCase() || ''}
                  >
                    {activeNetwork.currency
                      ? activeNetwork.currency.toUpperCase()
                      : ''}
                  </p>
                </div>
                <p className="text-brand-gray200 text-sm mt-1 font-medium">
                  {fiatPriceValue || '$0.00'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-start min-w-0 w-full">
                <div className="flex flex-wrap gap-x-1 items-baseline min-w-0 w-full">
                  <p className="font-poppins text-2xl font-medium text-white truncate max-w-full">
                    {formatNumber(actualBalance || 0)}
                  </p>
                  <p
                    className="font-poppins text-sm text-brand-gray300 min-w-0 max-w-full break-all text-left"
                    title={activeNetwork.currency?.toUpperCase() || ''}
                  >
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
          {hasUnsavedChanges && (
            <p className="text-xs text-brand-royalblue300 mt-3 text-center italic">
              {t('settings.saveToUpdateRate')}
            </p>
          )}
        </div>
      </div>

      <PageActionFooter
        error={saveError ? t('settings.preferencesSaveFailed') : undefined}
      >
        <Button
          variant="neutral"
          className="text-sm text-brand-royalblue"
          fullWidth={true}
          type="button"
          disabled={!hasUnsavedChanges || saving}
          loading={saving}
          onClick={handleConfirmCurrencyChange}
        >
          {t('buttons.save')}
        </Button>
      </PageActionFooter>
    </>
  );
};

export default CurrencyView;
