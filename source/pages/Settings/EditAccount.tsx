import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { LockIconSvg } from 'components/Icon/Icon';
import { Button, Icon, PageActionFooter } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import type { AccountLabelEditContext } from 'scripts/Background/controllers/MainController';
import { HardWallets } from 'scripts/Background/controllers/message-handler/types';
import { RootState } from 'state/store';
import { KeyringAccountType } from 'types/network';
import { ellipsis } from 'utils/format';
import {
  createBrowsingNavigationContext,
  getWalletNavigationScope,
  navigateBack,
  navigateWithContext,
} from 'utils/navigationState';

const EditAccountView = () => {
  const location = useLocation();
  const routeState = location.state || {};
  const accountType: KeyringAccountType =
    routeState.accountType ||
    (routeState.isImported
      ? KeyringAccountType.Imported
      : routeState.isTrezorWallet
      ? KeyringAccountType.Trezor
      : routeState.isLedgerWallet
      ? KeyringAccountType.Ledger
      : routeState.isSmartAccount
      ? KeyringAccountType.SmartAccount
      : KeyringAccountType.HDAccount);
  const account = useSelector(
    (reduxState: RootState) =>
      reduxState.vault.accounts[accountType]?.[routeState.id]
  );
  const state = { ...account, accountType };
  const { t } = useTranslation();
  const walletScope = useSelector(() =>
    JSON.stringify(getWalletNavigationScope())
  );
  const entryKey = JSON.stringify([
    location.key,
    location.pathname,
    location.search,
    location.hash,
    accountType,
    routeState.id,
    account?.address,
    account?.xpub,
    walletScope,
  ]);
  const entry = useRef({ key: entryKey });
  if (entry.current.key !== entryKey) entry.current = { key: entryKey };
  const currentEntry = entry.current;
  const mounted = useRef(true);
  const saveRequest = useRef<{ entry: typeof entry.current } | null>(null);
  const [pendingSave, setPendingSave] =
    useState<typeof saveRequest.current>(null);
  const loading = pendingSave?.entry === currentEntry;

  const { alert, navigate, useCopyClipboard } = useUtils();
  const [copied, copyText] = useCopyClipboard(1000, entryKey);

  const { controllerEmitter } = useController();

  const [form] = useForm();
  const slip44 = useSelector(
    (reduxState: RootState) => reduxState.vaultGlobal?.activeSlip44
  );
  const draftScope = JSON.stringify([
    slip44,
    accountType,
    routeState.id,
    account?.xpub || account?.address,
    accountType === KeyringAccountType.SmartAccount && account?.address,
  ]);
  const previousDraftScope = useRef(draftScope);

  useEffect(() => {
    if (previousDraftScope.current === draftScope) return;
    previousDraftScope.current = draftScope;
    // Preserve drafts through receiving-address updates, not vault/identity reuse.
    form.setFieldsValue({ label: account?.label || '' });
  }, [draftScope, account?.label, form]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      saveRequest.current = null;
    };
  }, []);

  useEffect(() => {
    if (!account) navigateBack(navigate, location);
  }, [account, location, navigate]);

  const isSmartAccount =
    state.accountType === KeyringAccountType.SmartAccount ||
    state.isSmartAccount;

  const getWalletType = useMemo(() => {
    if (isSmartAccount) {
      return 'Smart Account';
    } else if (state.isTrezorWallet) {
      return HardWallets.TREZOR;
    } else if (state.isLedgerWallet) {
      return HardWallets.LEDGER;
    } else if (state.isImported) {
      return 'Imported';
    }
    return 'Pali';
  }, [isSmartAccount, state]);

  const walletTypeBadgeClassName = isSmartAccount
    ? 'bg-purple-500 text-white'
    : 'bg-brand-blue500 text-brand-blue100';

  const initialValues = {
    label: state && state.label ? state.label : '',
  };

  const onSubmit = async (data: { label: string }) => {
    if (
      !mounted.current ||
      !account ||
      entry.current !== currentEntry ||
      saveRequest.current?.entry === currentEntry ||
      JSON.stringify(getWalletNavigationScope()) !== walletScope
    )
      return;
    const request = { entry: currentEntry };
    saveRequest.current = request;
    setPendingSave(request);
    const isCurrent = () =>
      mounted.current &&
      entry.current === request.entry &&
      saveRequest.current === request &&
      JSON.stringify(getWalletNavigationScope()) === walletScope;

    try {
      const accountId = state.id;
      const expectedContext: AccountLabelEditContext = {
        account: { address: account.address, xpub: account.xpub },
        walletScope: JSON.parse(walletScope),
      };

      await controllerEmitter(
        ['wallet', 'editAccountLabel'],
        [data.label, accountId, accountType, expectedContext]
      );

      if (isCurrent()) {
        alert.success(t('settings.accountLabelEditedSuccessfully'));
        navigateBack(navigate, location);
      }
    } catch (error) {
      if (isCurrent()) alert.error(error.message);
    } finally {
      if (isCurrent()) {
        saveRequest.current = null;
        setPendingSave(null);
      }
    }
  };

  const handleCopyToClipboard = () => {
    void copyText(state.address);
  };

  const openSmartAccountPolicy = () => {
    navigateWithContext(
      navigate,
      '/settings/account/smart-account-policy',
      { id: state.id, accountType },
      createBrowsingNavigationContext(location, { id: state.id, accountType })
    );
  };

  if (!account) return null;

  return (
    <>
      <Form
        form={form}
        validateMessages={{ default: '' }}
        id="edit-account"
        name="edit-account"
        initialValues={initialValues}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center text-center w-full"
      >
        <QRCodeSVG
          value={state.address}
          bgColor="#fff"
          fgColor="#000"
          style={{
            height: '186px',
            width: '186px',
            padding: '6px',
            backgroundColor: '#fff',
            borderRadius: '10px',
          }}
        />
        <div className="flex w-full items-center mb-3 mt-2 justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className={`shrink-0 text-xs ml-2 px-2 py-0.5 rounded-full ${walletTypeBadgeClassName}`}
            >
              {getWalletType}
            </div>
            <p className="truncate text-xs" title={state.address}>
              ({ellipsis(state.address, 12, 14)})
            </p>
          </div>
          <button
            type="button"
            aria-label={t('buttons.copy')}
            onClick={handleCopyToClipboard}
            className="flex min-h-[44px] shrink-0 items-center gap-1 rounded px-2 text-sm text-white transition-colors hover:bg-alpha-whiteAlpha100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue500"
          >
            <Icon isSvg className="w-4" name={copied ? 'greenCheck' : 'Copy'} />
            <span aria-live="polite">
              {copied ? t('components.copied') : t('buttons.copy')}
            </span>
          </button>
        </div>
        <Form.Item
          name="label"
          className="w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              async validator(_, value) {
                if (value && value.trim().length > 0 && value !== state.label) {
                  return Promise.resolve();
                }

                return Promise.reject(new Error(t('settings.newLabel')));
              },
            }),
          ]}
        >
          <Input
            placeholder={t('settings.accountLabel')}
            className="custom-edit-input relative"
            disabled={loading}
          />
        </Form.Item>

        {isSmartAccount && (
          <button
            type="button"
            className="mb-4 flex w-full cursor-pointer items-center justify-between rounded-lg bg-alpha-whiteAlpha100 px-4 py-4 text-left text-sm hover:bg-brand-blue500 hover:bg-opacity-20"
            onClick={openSmartAccountPolicy}
          >
            <span className="flex min-w-0 items-center gap-3">
              <LockIconSvg className="shrink-0 w-6 h-6 text-white opacity-90" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-white">
                  {t('settings.smartAccountAccountPolicy')}
                </span>
                <span className="mt-1 block text-xs text-brand-graylight">
                  {t('settings.smartAccountAccountPolicySummary')}
                </span>
              </span>
            </span>
            <Icon name="arrowright" isSvg size={24} className="shrink-0" />
          </button>
        )}

        <PageActionFooter>
          <Button
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="submit"
            fullWidth
            loading={loading}
          >
            {t('buttons.save')}
          </Button>
        </PageActionFooter>
      </Form>
    </>
  );
};

export default EditAccountView;
