import { Menu } from '@headlessui/react';
import { toSvg } from 'jdenticon';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  IKeyringAccountState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';

import importIcon from 'assets/images/import.png';
import ledgerLogo from 'assets/images/ledgerLogo.png';
import trezorLogo from 'assets/images/trezorLogo.png';
import logo from 'assets/images/whiteLogo.png';
import {
  IconButton,
  Icon,
  Tooltip,
  ConfirmationModal,
  DefaultModal,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { ellipsis } from 'utils/index';

type RenderAccountsListByBitcoinBasedProps = {
  setActiveAccount: (id: number, type: KeyringAccountType) => Promise<void>;
};

const RenderAccountsListByBitcoinBased = (
  props: RenderAccountsListByBitcoinBasedProps
) => {
  const { setActiveAccount } = props;

  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const { activeNetwork } = useSelector((state: RootState) => state.vault);

  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  return (
    <>
      {isBitcoinBased ? ( // If the network is Bitcoinbased only show SYS UTX0 accounts -> isImported === false
        <>
          {Object.values(accounts.HDAccount)
            .filter((acc) => acc.isImported === false) //todo we don't have account.isImported anymore
            .map((account, index) => (
              <li
                className={`py-1.5 px-5 w-max backface-visibility-hidden flex items-center text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none cursor-pointer transform
                   transition duration-300`}
                onClick={() =>
                  setActiveAccount(account.id, KeyringAccountType.HDAccount)
                }
                id={`account-${index}`}
                key={account.id}
              >
                <span
                  style={{ maxWidth: '16.25rem', textOverflow: 'ellipsis' }}
                  className="w-max gap-[2px] flex items-center justify-start whitespace-nowrap overflow-hidden"
                >
                  <img src={logo} className="mr-1 w-7"></img>
                  {account.label} ({ellipsis(account.address, 4, 4)})
                </span>
                <span className="text-xs ml-2 px-2 py-0.5 text-white bg-brand-blue500 rounded-full">
                  Pali
                </span>
                {activeAccount.id === account.id &&
                  activeAccount.type === KeyringAccountType.HDAccount && (
                    <Icon
                      name="check"
                      className="mb-1 ml-2 w-4"
                      color="#8EC100"
                    />
                  )}
              </li>
            ))}

          {Object.values(accounts.Trezor)
            .filter((acc) => acc.isImported === false) //todo we don't have account.isImported anymore
            .map((account, index) => (
              <li
                className={`py-1.5 px-5 w-max  backface-visibility-hidden flex items-center justify-start text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none ${
                    account?.originNetwork.url !== activeNetwork.url
                      ? 'hidden'
                      : 'cursor-pointer'
                  } transform
                   transition duration-300`}
                onClick={() => {
                  if (account?.originNetwork.url !== activeNetwork.url) {
                    return;
                  }
                  setActiveAccount(account.id, KeyringAccountType.Trezor);
                }}
                id={`account-${index}`}
                key={account.id}
              >
                <span
                  style={{
                    maxWidth: '16.25rem',
                    textOverflow: 'ellipsis',
                  }}
                  className="w-full flex items-center justify-start whitespace-nowrap overflow-hidden"
                >
                  <img
                    src={trezorLogo}
                    style={{
                      filter:
                        'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                    }}
                    className="mr-1 w-7"
                  ></img>
                  {account.label}{' '}
                  {!(account?.originNetwork.url !== activeNetwork.url) &&
                    `(${ellipsis(account.address, 4, 4)})`}
                </span>

                <span className="text-xs ml-2 px-2 py-0.5 text-white bg-brand-blue500 rounded-full">
                  Trezor
                </span>

                {activeAccount.id === account.id &&
                  activeAccount.type === KeyringAccountType.Trezor && (
                    <Icon
                      name="check"
                      className="mb-1 ml-2 w-4"
                      color="#8EC100"
                    />
                  )}
              </li>
            ))}

          {Object.values(accounts.Ledger)
            .filter((acc) => acc.isImported === false) //todo we don't have account.isImported anymore
            .map((account, index) => (
              <li
                className={`py-1.5 px-5 w-max  backface-visibility-hidden flex items-center justify-start text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none ${
                    account?.originNetwork.url !== activeNetwork.url
                      ? 'hidden'
                      : 'cursor-pointer'
                  } transform
                   transition duration-300`}
                onClick={() => {
                  if (account?.originNetwork.url !== activeNetwork.url) {
                    return;
                  }
                  setActiveAccount(account.id, KeyringAccountType.Ledger);
                }}
                id={`account-${index}`}
                key={account.id}
              >
                <span
                  style={{
                    maxWidth: '16.25rem',
                    textOverflow: 'ellipsis',
                  }}
                  className="w-full flex items-center justify-start whitespace-nowrap overflow-hidden"
                >
                  <img
                    src={ledgerLogo}
                    style={{
                      filter:
                        'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                    }}
                    className="mr-2 w-7"
                  ></img>
                  {account.label}{' '}
                  {!(account?.originNetwork.url !== activeNetwork.url) &&
                    `(${ellipsis(account.address, 4, 4)})`}
                </span>

                <span className="text-xs ml-2 px-2 py-0.5 text-white bg-brand-blue500 rounded-full">
                  Ledger
                </span>

                {activeAccount.id === account.id &&
                  activeAccount.type === KeyringAccountType.Ledger && (
                    <Icon
                      name="check"
                      className="mb-1 ml-2 w-4"
                      color="#8EC100"
                    />
                  )}
              </li>
            ))}
        </>
      ) : (
        Object.entries(accounts).map(
          ([keyringAccountType, accountTypeAccounts]) => (
            <div key={keyringAccountType}>
              {Object.values(accountTypeAccounts)
                .filter((account) => account.xpub !== '')
                .map((account, index) => (
                  <li
                    className={`py-1.5 px-5 w-max backface-visibility-hidden flex items-center justify-start text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none ${
                    (account.isTrezorWallet &&
                      account?.originNetwork?.isBitcoinBased) ||
                    (account.isLedgerWallet &&
                      account?.originNetwork?.isBitcoinBased)
                      ? 'hidden'
                      : 'cursor-pointer'
                  } transform
                   transition duration-300`}
                    onClick={() => {
                      if (
                        (account.isTrezorWallet &&
                          account?.originNetwork?.isBitcoinBased) ||
                        (account.isLedgerWallet &&
                          account?.originNetwork?.isBitcoinBased)
                      ) {
                        return;
                      }
                      setActiveAccount(
                        account.id,
                        keyringAccountType as KeyringAccountType
                      );
                    }}
                    id={`account-${index}`}
                    key={account.id}
                  >
                    <span
                      style={{
                        maxWidth: '16.25rem',
                        textOverflow: 'ellipsis',
                      }}
                      className="w-full flex items-center justify-start whitespace-nowrap overflow-hidden"
                    >
                      {account.isImported ? (
                        <img src={importIcon} className="mr-1 w-7"></img>
                      ) : account.isTrezorWallet ? (
                        <img
                          src={trezorLogo}
                          style={{
                            filter:
                              'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                          }}
                          className="mr-1 w-7"
                        ></img>
                      ) : account.isLedgerWallet ? (
                        <img
                          src={ledgerLogo}
                          style={{
                            filter:
                              'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                          }}
                          className="mr-1 w-7"
                        ></img>
                      ) : (
                        <img src={logo} className="mr-1 w-7"></img>
                      )}{' '}
                      {account.label}{' '}
                      {!(
                        (account.isTrezorWallet &&
                          account?.originNetwork?.isBitcoinBased) ||
                        (account.isLedgerWallet &&
                          account?.originNetwork?.isBitcoinBased)
                      ) && `(${ellipsis(account.address, 4, 4)})`}
                    </span>

                    {activeAccount.id === account.id &&
                      activeAccount.type === keyringAccountType && (
                        <Icon
                          name="check"
                          className="mb-1 ml-2 w-4"
                          wrapperClassname="relative right-0.5"
                          color="#8EC100"
                        />
                      )}
                  </li>
                ))}
            </div>
          )
        )
      )}
    </>
  );
};

export const AccountMenu: React.FC = () => {
  const { navigate } = useUtils();
  const { controllerEmitter } = useController();
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const url = chrome.runtime.getURL('app.html');
  const { t } = useTranslation();
  const setActiveAccount = async (id: number, type: KeyringAccountType) => {
    if (!isBitcoinBased) {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const host = new URL(tabs[0].url).hostname;

      controllerEmitter(['dapp', 'getAccount'], [host]).then(async (res) => {
        controllerEmitter(
          ['wallet', 'setAccount'],
          [Number(id), type, host, res]
        );
      });

      return;
    }

    controllerEmitter(['wallet', 'setAccount'], [Number(id), type]);
  };

  const cursorType = isBitcoinBased ? 'cursor-not-allowed' : 'cursor-pointer';

  return (
    <div className="flex flex-col justify-start items-start">
      <span className="disabled text-xs flex justify-start px-5 mt-5 mb-1">
        {t('accountMenu.accounts')}
      </span>

      <Menu.Item>
        <>
          <RenderAccountsListByBitcoinBased
            setActiveAccount={setActiveAccount}
          />
        </>
      </Menu.Item>

      <span className="disabled text-xs flex justify-start px-5 my-3">
        {t('accountMenu.accountsSettings')}
      </span>

      <Menu.Item>
        <li
          onClick={() => navigate('/settings/account/new')}
          className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
        >
          <Icon name="AddUser" isSvg className="mb-1 text-brand-white" />

          <span>{t('accountMenu.createNewAccount')}</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <li
          onClick={() => navigate('/settings/manage-accounts')}
          className="py-1.5 cursor-pointer pl-5 pr-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
        >
          <Icon name="ManageUser" isSvg className="mb-2 text-brand-white" />

          <span>{t('accountMenu.manageAccounts')}</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <li
          onClick={() => window.open(url)}
          className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
        >
          <Icon
            name="HardWallet"
            isSvg
            className="mb-2 text-brand-white"
            id="hardware-wallet-btn"
          />

          <span>{t('accountMenu.connectTrezor')}</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <div className="flex flex-col gap-2">
          <li
            onClick={() => {
              isBitcoinBased ? null : navigate('/settings/account/import');
            }}
            className={`py-1.5 ${cursorType} px-6 w-full backface-visibility-hidden flex items-center justify-start gap-3 text-white text-sm font-medium active:bg-opacity-40 focus:outline-none`}
          >
            <Icon
              name="ImportUser"
              isSvg
              className="mb-1 text-brand-white"
              opacity={isBitcoinBased ? 0.6 : 1}
            />

            <span className={isBitcoinBased ? 'disabled' : ''}>
              {t('accountMenu.importAccount')}
            </span>
          </li>
          {isBitcoinBased && (
            <span className="disabled text-xs px-5 text-left">
              {t('accountMenu.importAccMessage')}
            </span>
          )}
        </div>
      </Menu.Item>
    </div>
  );
};

export const AccountHeader: React.FC = () => {
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { accounts, isBitcoinBased, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const { useCopyClipboard, alert, navigate } = useUtils();
  const { t } = useTranslation();
  const [copied, copy] = useCopyClipboard();
  const [isLoading, setIsLoading] = useState(false);
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [isReconectModalOpen, setIsReconectModalOpen] = useState(false);
  const { controllerEmitter } = useController();
  const isLedger = activeAccount.type === KeyringAccountType.Ledger;
  const url = chrome.runtime.getURL('app.html');

  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');
    if (!placeholder) return;

    placeholder.innerHTML = toSvg(
      accounts[activeAccount.type][activeAccount.id]?.xpub,
      50,
      {
        backColor: '#07152B',
        padding: 1,
      }
    );
  }, [accounts[activeAccount.type][activeAccount.id]?.address]);

  const editAccount = (account: IKeyringAccountState) => {
    navigate('/settings/edit-account', {
      state: account,
    });
  };

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success(t('home.addressCopied'));
  }, [copied]);

  const handleVerifyAddress = async () => {
    try {
      setIsLoading(true);

      await controllerEmitter(
        ['wallet', 'ledgerSigner', 'utxo', 'verifyUtxoAddress'],
        [activeAccount.id]
      );

      setIsLoading(false);

      setIsOpenModal(false);

      alert.success(t('home.addressVerified'));
    } catch (error) {
      const isNecessaryReconnect = error.message.includes(
        'read properties of undefined'
      );

      if (isNecessaryReconnect) {
        setIsReconectModalOpen(true);
        return;
      }

      const wasDeniedByUser = error?.message?.includes('denied by the user');

      if (wasDeniedByUser) {
        alert.error(t('home.verificationDeniedByUser'));
      }

      setIsOpenModal(false);

      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between p-1 bg-bkg-3">
      <ConfirmationModal
        title={t('home.verifySysAddress')}
        description={t('home.verifySysAddressDescription')}
        buttonText={t('buttons.verify')}
        onClick={handleVerifyAddress}
        onClose={() => setIsOpenModal(false)}
        show={isOpenModal}
        isButtonLoading={isLoading}
      />
      <DefaultModal
        show={isReconectModalOpen}
        title={t('settings.ledgerReconnection')}
        buttonText={t('buttons.reconnect')}
        description={t('settings.ledgerReconnectionMessage')}
        onClose={() => {
          setIsReconectModalOpen(false);
          window.open(`${url}?isReconnect=true`, '_blank');
        }}
      />
      <div className="flex ml-[15px] items-center w-full text-brand-white">
        <div className="add-identicon ml-1 mr-2 my-2" />

        <div className="items-center justify-center px-1 text-brand-white">
          <p
            className="mb-1 text-base font-medium"
            id="active-account-label items-center"
          >
            {accounts[activeAccount.type][activeAccount.id]?.label}

            <IconButton
              onClick={() =>
                editAccount(accounts[activeAccount.type][activeAccount.id])
              }
              type="primary"
              shape="circle"
            >
              <Icon
                name="edit"
                className="hover:text-brand-royalblue text-xs ml-1 flex justify-center w-4 h-4"
              />
            </IconButton>
          </p>
          <Tooltip
            content={
              isLedger && isBitcoinBased && activeNetwork.chainId === 57
                ? t('home.clickToVerify')
                : ''
            }
          >
            <p
              className={`text-xs ${
                isLedger && isBitcoinBased && activeNetwork.chainId === 57
                  ? 'cursor-pointer'
                  : ''
              }`}
              onClick={() => {
                if (isLedger && isBitcoinBased && activeNetwork.chainId === 57)
                  setIsOpenModal(true);
              }}
            >
              {ellipsis(
                accounts[activeAccount.type][activeAccount.id]?.address,
                6,
                14
              )}
            </p>
          </Tooltip>
        </div>

        <IconButton
          onClick={() =>
            copy(accounts[activeAccount.type][activeAccount.id]?.address ?? '')
          }
          type="primary"
          shape="circle"
          className="mt-3"
        >
          <Icon name="copy" className="text-xs" id="copy-address-btn" />
        </IconButton>
      </div>
    </div>
  );
};
