import React, { useState } from 'react';
import { CgSearch as SearchIcon } from 'react-icons/cg';
import { FaRegStickyNote as StickyNoteIcon } from 'react-icons/fa';
import { MdClose as CloseIcon } from 'react-icons/md';
import { RiArrowLeftSLine as GoBackIcon } from 'react-icons/ri';
import {
  RiOrderPlayLine as OrderByIcon,
  RiCoinLine as CoinIcon,
} from 'react-icons/ri';

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
  const [isSortByOpen, setIsSortByOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);

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

  const showDefaultHeader = !isSearchOpen;

  return (
    <>
      {showDefaultHeader ? (
        <div className="flex w-full justify-between items-center mb-2">
          <div className="flex items-center justify-center gap-x-2">
            <div
              className="flex items-center justify-center cursor-pointer p-2 rounded-full bg-bkg-deepBlue"
              onClick={() => showSortBy()}
            >
              {isSortByOpen ? (
                <CloseIcon size={14.5} color="#fff" />
              ) : (
                <OrderByIcon size={14.5} color="#fff" />
              )}
            </div>
            <div
              className="flex items-center justify-center cursor-pointer p-2 rounded-full bg-bkg-deepBlue"
              onClick={() => showSearchInput()}
            >
              <SearchIcon size={14.5} color="#fff" />
            </div>
          </div>
          <div className="flex items-center justify-center gap-x-2">
            <div
              className="flex items-center  w-14 h-8 justify-evenly bg-bkg-white200"
              style={{ borderRadius: '64px' }}
            >
              <span
                className={`cursor-pointer p-1 rounded-full ${
                  isCoinSelected ? 'bg-brand-blue' : 'transparent'
                }`}
                onClick={() => setIsCoinSelected(true)}
              >
                <CoinIcon size={14.5} color="#fff" />
              </span>
              <span
                className={`cursor-pointer p-1 rounded-full ${
                  !isCoinSelected ? 'bg-brand-blue' : 'transparent'
                }`}
                onClick={() => setIsCoinSelected(false)}
              >
                <StickyNoteIcon size={14.5} color="#fff" />
              </span>
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
              placeholder="Token or contract address"
              className="w-full max-h-8 border bg-brand-blue800 border-bkg-white200 font-poppins 
              text-xs font-normal p-4 text-brand-gray200 outline-none"
              style={{ borderRadius: '100px' }}
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
              SORT BY:
            </h3>
            <li
              data-id="network"
              className="cursor-pointer"
              onClick={(e) => setSortyByValue(e.currentTarget.dataset.id)}
            >
              <p className="text-sm">Network</p>
            </li>
            <li
              data-id="name"
              className="cursor-pointer"
              onClick={(e) => setSortyByValue(e.currentTarget.dataset.id)}
            >
              <p className="text-sm">Name</p>
            </li>
          </ul>
        </div>
      ) : null}
    </>
  );
};
