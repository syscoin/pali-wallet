import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';
import { INetwork } from '@pollum-io/sysweb3-network';

import { LoadingSvg } from 'components/Icon/Icon';
import { Modal, PrimaryButton, SecondaryButton } from 'components/index';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import store, { RootState } from 'state/store';
import { selectActiveAccountRef } from 'state/vault';
import { setIsSwitchingAccount } from 'state/vaultGlobal';

interface ISetActiveAccountModalProps {
  selectedNetwork: INetwork;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showModal: boolean;
}

export const SetActiveAccountModal = (props: ISetActiveAccountModalProps) => {
  const { controllerEmitter } = useController();
  const { showModal, setIsOpen } = props;
  const { accounts, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = useSelector(selectActiveAccountRef);
  const { t } = useTranslation();

  const { alert } = useUtils();

  const [accountId, setAccountId] = useState<number>(activeAccount.id);
  const [accountType, setCurrentAccountType] = useState<KeyringAccountType>(
    activeAccount.type
  );

  const handleSetAccountId = (id: number, type: KeyringAccountType) => {
    setAccountId(id);
    setCurrentAccountType(type);
  };

  const handleChangeAccount = async () => {
    if (accountId === activeAccount.id && accountType === activeAccount.type) {
      alert.warning(t('header.pleaseSelect'));
      return;
    }

    await controllerEmitter(
      ['wallet', 'setAccount'],
      [accountId, accountType, true]
    );
    setIsOpen(false);
  };

  return (
    <Modal
      show={showModal}
      onClose={() => {
        setIsOpen(false);
      }}
    >
      <div className="inline-block align-middle p-6 w-full max-w-2xl text-brand-white font-poppins bg-bkg-2 border border-brand-royalblue rounded-2xl shadow-xl overflow-hidden transform transition-all">
        <div className="flex flex-col items-center justify-center w-full">
          <p className="flex flex-col items-center justify-center mb-5 text-center font-poppins text-xs">
            <span className="font-rubik text-base">
              {t('header.changeActiveAccount')}
            </span>
            <span className="font-rubik text-xs">
              {activeAccount.type === KeyringAccountType.Ledger
                ? t('header.itSeemsThatYouLedger')
                : t('header.itSeemsThatYou')}
            </span>
          </p>

          <div className="flex flex-col gap-7 items-center justify-center w-full">
            {accounts && Object.keys(accounts).length > 0 ? (
              <>
                {Object.entries(accounts).map(
                  ([keyringAccountType, account]) => {
                    if (
                      isBitcoinBased &&
                      keyringAccountType !== KeyringAccountType.HDAccount
                    ) {
                      return null;
                    }

                    if (
                      keyringAccountType === KeyringAccountType.Trezor ||
                      keyringAccountType === KeyringAccountType.Ledger ||
                      keyringAccountType === KeyringAccountType.Imported
                    ) {
                      return null;
                    }

                    const accountList = Object.values(account);

                    if (!accountList.length) return null;
                    return (
                      <div
                        key={keyringAccountType}
                        className="h-fit flex flex-col text-center"
                      >
                        <h3 className="text-sm font-semibold">
                          {keyringAccountType === KeyringAccountType.HDAccount
                            ? 'Pali Account'
                            : null}
                        </h3>
                        <ul
                          className={`scrollbar-styled flex flex-col gap-4 mt-4 px-8 w-full h-${
                            accountList.length === 1 || accountList.length === 2
                              ? 'fit'
                              : '32'
                          } overflow-auto`}
                        >
                          {accountList.map((acc) => (
                            <li
                              className={`${
                                acc.id === activeAccount.id &&
                                accountType === keyringAccountType
                                  ? 'cursor-pointer bg-opacity-50 border-brand-royalblue'
                                  : 'cursor-pointer hover:bg-bkg-4 border-brand-royalblue'
                              } border border-solid  rounded-lg px-2 py-4 text-xs bg-bkg-2 w-48 flex justify-between items-center transition-all duration-200`}
                              key={`${acc.id}-${keyringAccountType}`}
                              onClick={() => {
                                handleSetAccountId(
                                  acc.id,
                                  keyringAccountType as KeyringAccountType
                                );
                              }}
                            >
                              <p>{acc.label}</p>

                              <div className="flex gap-3 items-center justify-center">
                                <small></small>

                                <div
                                  className={`${
                                    acc.id === accountId &&
                                    accountType === keyringAccountType
                                      ? 'bg-warning-success'
                                      : 'bg-brand-graylight'
                                  } w-3 h-3 rounded-full border border-brand-royalblue`}
                                />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  }
                )}
              </>
            ) : (
              <div>
                <LoadingSvg className="w-4 text-brand-graylight animate-spin" />
              </div>
            )}

            <div className="flex items-center justify-between w-full md:max-w-2xl">
              <SecondaryButton type="button" onClick={() => setIsOpen(false)}>
                {t('buttons.cancel')}
              </SecondaryButton>

              <PrimaryButton
                type="button"
                width="40"
                onClick={() => handleChangeAccount()}
              >
                {t('buttons.change')}
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
