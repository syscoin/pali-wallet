import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  BsCheck2 as CheckIcon,
  CgSearch as SearchIcon,
  FaRegStickyNote as StickyNoteIcon,
  MdClose as CloseIcon,
  RiArrowLeftSLine as GoBackIcon,
  RiOrderPlayLine as OrderByIcon,
  RiCoinLine as CoinIcon,
} from 'components/Icon/Icon';
import { Tooltip } from 'components/Tooltip';

interface IAssetsHeader {
  isCoinSelected: boolean;
  searchValue: string;
  setIsCoinSelected: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchValue: React.Dispatch<React.SetStateAction<string>>;
  setSortyByValue: React.Dispatch<React.SetStateAction<string>>;
  sortByValue: string;
}

export const AssetsHeader = ({
  isCoinSelected,
  searchValue,
  setIsCoinSelected,
  setSearchValue,
  setSortyByValue,
  sortByValue,
}: IAssetsHeader) => {
  const { t } = useTranslation();
  const [isSortByOpen, setIsSortByOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(
    Boolean(searchValue)
  );
  const currentSortBy = sortByValue;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const firstSortOptionRef = useRef<HTMLButtonElement>(null);
  const focusSearch = useRef(false);
  const restoreSearchFocus = useRef(false);
  const restoreSortFocus = useRef(false);

  useEffect(() => {
    if (isSearchOpen && focusSearch.current) {
      searchInputRef.current?.focus();
      focusSearch.current = false;
    } else if (!isSearchOpen && restoreSearchFocus.current) {
      searchButtonRef.current?.focus();
      restoreSearchFocus.current = false;
    }
  }, [isSearchOpen]);

  useEffect(() => {
    if (isSortByOpen) firstSortOptionRef.current?.focus();
    else if (restoreSortFocus.current) {
      sortButtonRef.current?.focus();
      restoreSortFocus.current = false;
    }
  }, [isSortByOpen]);

  const closeSearch = () => {
    restoreSearchFocus.current = true;
    setIsSearchOpen(false);
    setSearchValue('');
  };

  const closeSort = () => {
    restoreSortFocus.current = true;
    setIsSortByOpen(false);
  };

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
    focusSearch.current = true;
    setIsSearchOpen(true);
  };

  const handleInputChange = (e) => {
    const { value } = e.target;
    // The list already defers filtering; keep the visible input and return state in sync.
    setSearchValue(value);
  };

  const handleSortSelection = (sortValue: string) => {
    setSortyByValue(sortValue);
    closeSort();
  };

  const handleClearSort = () => {
    setSortyByValue('');
    closeSort();
  };

  const showDefaultHeader = !isSearchOpen;

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
              <button
                ref={sortButtonRef}
                type="button"
                aria-label={t('tooltip.sortAssets')}
                aria-expanded={isSortByOpen}
                aria-controls="asset-sort-options"
                className={`flex items-center justify-center cursor-pointer p-2 rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-brand-royalblue ${
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
              </button>
            </Tooltip>
            <Tooltip content={t('tooltip.searchAssets')}>
              <button
                ref={searchButtonRef}
                type="button"
                aria-label={t('tooltip.searchAssets')}
                className="flex items-center justify-center cursor-pointer p-2 rounded-full bg-bkg-deepBlue focus-visible:ring-2 focus-visible:ring-brand-royalblue"
                onClick={() => showSearchInput()}
              >
                <SearchIcon size={14.5} color="#fff" />
              </button>
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
                <button
                  type="button"
                  aria-label={t('tooltip.viewTokens')}
                  aria-pressed={isCoinSelected}
                  className={`cursor-pointer w-6 h-6 rounded-full relative z-10 transition-colors duration-200 
                              flex items-center justify-center focus-visible:ring-2 focus-visible:ring-brand-royalblue ${
                                isCoinSelected
                                  ? 'text-white'
                                  : 'text-brand-gray200 hover:text-brand-gray100'
                              }`}
                  onClick={() => setIsCoinSelected(true)}
                >
                  <CoinIcon size={14} />
                </button>
              </Tooltip>
              <Tooltip content={t('tooltip.viewNFTs')}>
                <button
                  type="button"
                  aria-label={t('tooltip.viewNFTs')}
                  aria-pressed={!isCoinSelected}
                  className={`cursor-pointer w-6 h-6 rounded-full relative z-10 transition-colors duration-200 
                              flex items-center justify-center focus-visible:ring-2 focus-visible:ring-brand-royalblue ${
                                !isCoinSelected
                                  ? 'text-white'
                                  : 'text-brand-gray200 hover:text-brand-gray100'
                              }`}
                  onClick={() => setIsCoinSelected(false)}
                >
                  <StickyNoteIcon size={14} />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      ) : null}

      {isSearchOpen ? (
        <div
          className="flex w-full gap-2"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeSearch();
            }
          }}
        >
          <button
            type="button"
            aria-label={t('buttons.back')}
            className="flex items-center justify-center cursor-pointer p-2 rounded-full bg-bkg-deepBlue focus-visible:ring-2 focus-visible:ring-brand-royalblue"
            onClick={closeSearch}
          >
            <GoBackIcon size={16} color="#fff" />
          </button>

          <div className="w-full flex items-center">
            <input
              ref={searchInputRef}
              type="text"
              aria-label={t('assetsHeader.tokenOrContractAddress')}
              placeholder={t('assetsHeader.tokenOrContractAddress')}
              className="w-full max-h-8 border bg-brand-blue800 border-bkg-white200 font-poppins 
              text-xs font-normal p-4 text-brand-gray200 outline-none"
              style={{ borderRadius: '100px' }}
              onChange={handleInputChange}
              value={searchValue}
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
        <div
          id="asset-sort-options"
          className="flex w-full bg-brand-blue500 p-6 rounded-2xl font-poppins"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeSort();
            }
          }}
        >
          <div className="flex flex-col items-start gap-3.5">
            <h3 className="text-sm font-semibold text-brand-gray200">
              {t('assetsHeader.sortBy')}
            </h3>
            <ul className="flex flex-col items-start gap-3.5 w-full">
              <li className="w-full">
                <button
                  ref={firstSortOptionRef}
                  type="button"
                  aria-pressed={currentSortBy === 'Balance'}
                  className="cursor-pointer flex items-center justify-between w-full hover:text-brand-royalblue transition-colors rounded focus-visible:ring-2 focus-visible:ring-brand-royalblue"
                  onClick={() => handleSortSelection('Balance')}
                >
                  <span className="text-sm">{t('send.balance')}</span>
                  {currentSortBy === 'Balance' && (
                    <CheckIcon size={16} className="text-brand-royalblue" />
                  )}
                </button>
              </li>
              <li className="w-full">
                <button
                  type="button"
                  aria-pressed={currentSortBy === 'Name'}
                  className="cursor-pointer flex items-center justify-between w-full hover:text-brand-royalblue transition-colors rounded focus-visible:ring-2 focus-visible:ring-brand-royalblue"
                  onClick={() => handleSortSelection('Name')}
                >
                  <span className="text-sm">{t('assetsHeader.name')}</span>
                  {currentSortBy === 'Name' && (
                    <CheckIcon size={16} className="text-brand-royalblue" />
                  )}
                </button>
              </li>
              {currentSortBy && (
                <li className="w-full">
                  <button
                    type="button"
                    className="cursor-pointer flex items-center justify-between w-full hover:text-red-400 transition-colors pt-2 border-t border-brand-gray200/20 rounded focus-visible:ring-2 focus-visible:ring-brand-royalblue"
                    onClick={handleClearSort}
                  >
                    <span className="text-sm text-brand-gray300">
                      {t('assetsHeader.clearSort')}
                    </span>
                  </button>
                </li>
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
};
