import debounce from 'lodash/debounce';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BsCheck2 as CheckIcon } from 'react-icons/bs';
import { CgSearch as SearchIcon } from 'react-icons/cg';
import { FaRegStickyNote as StickyNoteIcon } from 'react-icons/fa';
import { MdClose as CloseIcon } from 'react-icons/md';
import { RiArrowLeftSLine as GoBackIcon } from 'react-icons/ri';
import {
  RiOrderPlayLine as OrderByIcon,
  RiCoinLine as CoinIcon,
} from 'react-icons/ri';

import { Tooltip } from 'components/Tooltip';

interface IAssetsHeader {
  isCoinSelected: boolean;
  setIsCoinSelected: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchValue: React.Dispatch<React.SetStateAction<string>>;
  setSortyByValue: React.Dispatch<React.SetStateAction<string>>;
}

export const AssetsHeader = ({
  isCoinSelected,
  setIsCoinSelected,
  setSearchValue,
  setSortyByValue,
}: IAssetsHeader) => {
  const { t } = useTranslation();
  const [isSortByOpen, setIsSortByOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [currentSortBy, setCurrentSortBy] = useState<string>('');

  const showSortBy = () => {
    if (isSearchOpen) {
      setIsSearchOpen(false);
    }

    setIsSortByOpen(!isSortByOpen);
  };

  const showSearchInput = () => {
    if (isSortByOpen) {
      setIsSortByOpen(false);
    }
    setIsSearchOpen(!isSearchOpen);
  };

  const delayedSearch = debounce((value) => {
    setSearchValue(value);
  }, 300);

  const handleInputChange = (e) => {
    const { value } = e.target;
    delayedSearch(value);
  };

  const handleSortSelection = (sortValue: string) => {
    setCurrentSortBy(sortValue);
    setSortyByValue(sortValue);
    setIsSortByOpen(false);
  };

  const handleClearSort = () => {
    setCurrentSortBy('');
    setSortyByValue('');
  };

  const showDefaultHeader = !isSearchOpen;

  //Guarantee values empty when the search filter is closed (but preserve sort)
  useEffect(() => {
    if (!isSearchOpen) {
      setSearchValue('');
    }
  }, [isSearchOpen]);

  return (
    <>
      {showDefaultHeader ? (
        <div className="flex w-full justify-between items-center mb-2">
          <div className="flex items-center justify-center gap-x-2">
            <Tooltip
              content={
                isSortByOpen
                  ? t('tooltip.closeSortOptions')
                  : currentSortBy
                  ? `${t('assetsHeader.sortedBy')} ${currentSortBy}`
                  : t('tooltip.sortAssets')
              }
            >
              <div
                className={`flex items-center justify-center cursor-pointer p-2 rounded-full transition-colors duration-200 ${
                  currentSortBy
                    ? 'bg-brand-royalblue/30 border border-brand-royalblue/50'
                    : 'bg-bkg-deepBlue'
                }`}
                onClick={() => showSortBy()}
              >
                {isSortByOpen ? (
                  <CloseIcon size={14.5} color="#fff" />
                ) : (
                  <OrderByIcon
                    size={14.5}
                    color={currentSortBy ? '#4FC3F7' : '#fff'}
                  />
                )}
              </div>
            </Tooltip>
            <Tooltip content={t('tooltip.searchAssets')}>
              <div
                className="flex items-center justify-center cursor-pointer p-2 rounded-full bg-bkg-deepBlue"
                onClick={() => showSearchInput()}
              >
                <SearchIcon size={14.5} color="#fff" />
              </div>
            </Tooltip>
          </div>
          <div className="flex items-center justify-center gap-x-2">
            <div className="flex items-center w-14 h-8 justify-evenly bg-bkg-1 rounded-full relative p-1">
              {/* Background pill that slides to indicate selection */}
              <div
                className={`absolute w-6 h-6 bg-brand-royalblue rounded-full transition-all duration-200 shadow-md ${
                  isCoinSelected ? 'left-1' : 'left-7'
                }`}
              />
              <Tooltip content={t('tooltip.viewTokens')}>
                <span
                  className={`cursor-pointer w-6 h-6 rounded-full relative z-10 transition-colors duration-200 
                              flex items-center justify-center ${
                                isCoinSelected
                                  ? 'text-white'
                                  : 'text-brand-gray200 hover:text-brand-gray100'
                              }`}
                  onClick={() => setIsCoinSelected(true)}
                >
                  <CoinIcon size={14} />
                </span>
              </Tooltip>
              <Tooltip content={t('tooltip.viewNFTs')}>
                <span
                  className={`cursor-pointer w-6 h-6 rounded-full relative z-10 transition-colors duration-200 
                              flex items-center justify-center ${
                                !isCoinSelected
                                  ? 'text-white'
                                  : 'text-brand-gray200 hover:text-brand-gray100'
                              }`}
                  onClick={() => setIsCoinSelected(false)}
                >
                  <StickyNoteIcon size={14} />
                </span>
              </Tooltip>
            </div>
          </div>
        </div>
      ) : null}

      {isSearchOpen ? (
        <div className="flex w-full gap-2">
          <div
            className="flex items-center justify-center cursor-pointer p-2 rounded-full bg-bkg-deepBlue"
            onClick={() => setIsSearchOpen(false)}
          >
            <GoBackIcon size={16} color="#fff" />
          </div>

          <div className="w-full flex items-center">
            <input
              type="text"
              placeholder={t('assetsHeader.tokenOrContractAddress')}
              className="w-full max-h-8 border bg-brand-blue800 border-bkg-white200 font-poppins 
              text-xs font-normal p-4 text-brand-gray200 outline-none"
              style={{ borderRadius: '100px' }}
              onChange={handleInputChange}
            />

            <SearchIcon
              size={16}
              color="#fff"
              className="absolute"
              style={{ right: '8%' }}
            />
          </div>
        </div>
      ) : null}

      {isSortByOpen ? (
        <div className="flex w-full bg-brand-blue500 p-6 rounded-2xl font-poppins">
          <ul className="flex flex-col items-start gap-3.5">
            <h3 className="text-sm font-semibold text-brand-gray200">
              {t('assetsHeader.sortBy')}
            </h3>
            <li
              data-id="Balance"
              className="cursor-pointer flex items-center justify-between w-full hover:text-brand-royalblue transition-colors"
              onClick={(e) => handleSortSelection(e.currentTarget.dataset.id)}
            >
              <p className="text-sm">{t('send.balance')}</p>
              {currentSortBy === 'Balance' && (
                <CheckIcon size={16} className="text-brand-royalblue" />
              )}
            </li>
            <li
              data-id="Name"
              className="cursor-pointer flex items-center justify-between w-full hover:text-brand-royalblue transition-colors"
              onClick={(e) => handleSortSelection(e.currentTarget.dataset.id)}
            >
              <p className="text-sm">{t('assetsHeader.name')}</p>
              {currentSortBy === 'Name' && (
                <CheckIcon size={16} className="text-brand-royalblue" />
              )}
            </li>
            {currentSortBy && (
              <li
                className="cursor-pointer flex items-center justify-between w-full hover:text-red-400 transition-colors pt-2 border-t border-brand-gray200/20"
                onClick={handleClearSort}
              >
                <p className="text-sm text-brand-gray300">
                  {t('assetsHeader.clearSort')}
                </p>
              </li>
            )}
          </ul>
        </div>
      ) : null}
    </>
  );
};
