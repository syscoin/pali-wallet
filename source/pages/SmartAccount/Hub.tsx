import { getAddress, isAddress } from '@ethersproject/address';
import { isHexString } from '@ethersproject/bytes';
import { Form, Input } from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  AddressText,
  Button,
  CenterPanel,
  CenterTitle,
  ConfirmationModal,
  DialogPrimitive,
  Icon,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccount } from 'state/vault/selectors';
import {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from 'types/network';
import {
  encodeCompositeValidatorInitData,
  encodeInstallValidatorModuleCall,
  encodeRotateValidatorModuleCall,
  encodeUninstallValidatorModuleCall,
  getAvailablePaliModules,
  getPaliModuleAddress,
  getSmartAccountLocalOwnerContexts,
  isPaliSignableValidator,
  listCompositeChildCandidates,
  signAndSubmitSmartAccountExecutions,
} from 'utils/smartAccount';
import type { CustomValidatorPreflightResult } from 'utils/smartAccount';
import { getSmartAccountActionErrorMessage } from 'utils/smartAccountErrors';

// ---------------------------------------------------------------------------
// Smart Account hub: the 2-click home for everything smart-account.
//  - sign-in method (active validator) + manage link into the policy flows
//  - installed module list (uninstall where safe)
//  - module marketplace (builtin set-up links + bring-your-own validator)
//  - composite policy builder over installed validators
//  - recovery + infrastructure shortcuts
// Deep flows (passkey creation, guardian recovery, validator switching) stay
// on the proven SmartAccountPolicy page; the hub links into it.
// ---------------------------------------------------------------------------

const moduleDisplayName = (
  module: SmartAccountValidatorModule | { config?: any; id: string },
  t: (key: string) => string
): string => {
  switch (module.id) {
    case 'p256-webauthn':
      return t('settings.passkeyAuthenticator');
    case 'ecdsa':
      return t('settings.ecdsaAuthenticator');
    case 'composite':
      return t('settings.compositeAuthenticator');
    case 'guardian-recovery':
      return t('settings.smartAccountGuardianRecoveryTitle');
    case 'custom':
      return (module as any).config?.name || t('smartAccountHub.customModule');
    default:
      return (module as any).config?.name || module.id;
  }
};

type CustomInstallState = {
  acknowledged: boolean;
  address: string;
  initData: string;
  name: string;
  preflight: CustomValidatorPreflightResult | null;
  step: 'form' | 'review';
};

const INITIAL_CUSTOM_INSTALL: CustomInstallState = {
  acknowledged: false,
  address: '',
  initData: '0x',
  name: '',
  preflight: null,
  step: 'form',
};

const buildCustomValidatorInstallExecutions = ({
  accountAddress,
  activeValidatorAddress,
  activeValidatorData,
  customInitData,
  customValidatorAddress,
}: {
  accountAddress: string;
  activeValidatorAddress: string;
  activeValidatorData: string;
  customInitData: string;
  customValidatorAddress: string;
}) => [
  {
    data: encodeInstallValidatorModuleCall(
      customValidatorAddress,
      customInitData
    ),
    target: accountAddress,
    value: '0x0',
  },
  {
    data: encodeRotateValidatorModuleCall(
      activeValidatorAddress,
      activeValidatorData
    ),
    target: accountAddress,
    value: '0x0',
  },
];

const SmartAccountHub = () => {
  const { t } = useTranslation();
  const { alert, navigate } = useUtils();
  const { controllerEmitter } = useController();
  const account = useSelector(selectActiveAccount);
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const [metadata, setMetadata] = useState<ISmartAccountMetadata | null>(
    account?.smartAccount || null
  );
  const [busyKey, setBusyKey] = useState('');
  const [customInstall, setCustomInstall] = useState<CustomInstallState | null>(
    null
  );
  const [compositeBuilder, setCompositeBuilder] = useState<{
    children: string[];
    threshold: number;
  } | null>(null);
  const [confirmUninstall, setConfirmUninstall] =
    useState<SmartAccountValidatorModule | null>(null);

  const isSmartAccount = Boolean(account?.isSmartAccount);
  const smartAccountAddress = account?.address;

  const refreshMetadata = useCallback(async () => {
    if (!account?.isSmartAccount) return null;
    const hydrated = (await controllerEmitter(
      ['wallet', 'hydrateSmartAccount'],
      [account.id],
      300000
    )) as ISmartAccountMetadata;
    setMetadata(hydrated);
    return hydrated;
  }, [account?.id, account?.isSmartAccount, controllerEmitter]);

  useEffect(() => {
    setMetadata(account?.smartAccount || null);
    if (account?.isSmartAccount && account?.smartAccount?.isDeployed) {
      refreshMetadata().catch(() => undefined);
    }
  }, [account?.address, account?.id]);

  const installedModules = metadata?.installedModules || [];
  const installedValidators = installedModules.filter(
    (module): module is SmartAccountValidatorModule =>
      module.type === 'validator'
  );
  const activeValidatorAddress = metadata?.auth?.validator?.toLowerCase();
  const activeValidator = installedValidators.find(
    (module) => module.address.toLowerCase() === activeValidatorAddress
  );
  const compositeChildren = new Set(
    installedValidators
      .filter((module) => module.id === 'composite')
      .flatMap((module) =>
        module.id === 'composite'
          ? module.config.childValidators.map((child) => child.toLowerCase())
          : []
      )
  );

  const marketplaceModules = useMemo(
    () =>
      getAvailablePaliModules(activeNetwork.chainId).filter(
        (module) => module.supported
      ),
    [activeNetwork.chainId]
  );

  const goToPolicyPage = useCallback(() => {
    navigate('/settings/account/smart-account-policy');
  }, [navigate]);

  const getLocalOwnerContexts = useCallback(
    () =>
      getSmartAccountLocalOwnerContexts({
        accounts: accounts as any,
        controllerEmitter: controllerEmitter as any,
      }),
    [accounts, controllerEmitter]
  );

  const submitExecutions = useCallback(
    async (
      executions: Array<{ data: string; target: string; value: string }>
    ) => {
      if (!account?.isSmartAccount || !metadata) return;
      await signAndSubmitSmartAccountExecutions({
        accountId: account.id,
        authenticatorContexts: getLocalOwnerContexts(),
        controllerEmitter,
        executions,
        skipRapidPolling: true,
        smartAccount: metadata,
        useCachedMetadata: true,
        waitForConfirmation: true,
      });
      await refreshMetadata();
    },
    [
      account?.id,
      account?.isSmartAccount,
      controllerEmitter,
      getLocalOwnerContexts,
      metadata,
      refreshMetadata,
    ]
  );

  const handleUninstall = useCallback(
    async (module: SmartAccountValidatorModule) => {
      if (!account?.address) return;
      setBusyKey(`uninstall:${module.address}`);
      try {
        await submitExecutions([
          {
            data: encodeUninstallValidatorModuleCall(module.address),
            target: account.address,
            value: '0x0',
          },
        ]);
        if (module.id === 'custom') {
          await controllerEmitter(
            ['wallet', 'removeSmartAccountCustomModule'],
            [{ accountId: account.id, address: module.address }],
            30000
          );
          await refreshMetadata();
        }
        alert.success(t('smartAccountHub.moduleUninstalled'));
      } catch (error) {
        alert.error(
          getSmartAccountActionErrorMessage(
            error,
            t('send.cantCompleteTxs'),
            t('send.insufficientFundsForGas')
          )
        );
      } finally {
        setBusyKey('');
        setConfirmUninstall(null);
      }
    },
    [
      account?.address,
      account?.id,
      alert,
      controllerEmitter,
      refreshMetadata,
      submitExecutions,
      t,
    ]
  );

  const runCustomPreflight = useCallback(async () => {
    if (!customInstall || !account?.id) return;
    const address = customInstall.address.trim();
    if (!isAddress(address)) {
      alert.error(t('smartAccountHub.invalidModuleAddress'));
      return;
    }
    if (customInstall.initData && !isHexString(customInstall.initData)) {
      alert.error(t('smartAccountHub.invalidInitData'));
      return;
    }
    setBusyKey('custom:preflight');
    try {
      const preflight = (await controllerEmitter(
        ['wallet', 'preflightSmartAccountCustomValidator'],
        [{ accountId: account.id, address }],
        60000
      )) as CustomValidatorPreflightResult;
      setCustomInstall((state) =>
        state
          ? { ...state, preflight, step: preflight.ok ? 'review' : 'form' }
          : state
      );
      if (!preflight.ok) {
        const reason = preflight.failures[0];
        alert.error(
          reason === 'already-installed'
            ? t('smartAccountHub.preflightAlreadyInstalled')
            : reason === 'no-contract-code'
            ? t('smartAccountHub.preflightNoCode')
            : t('smartAccountHub.preflightNotValidator')
        );
      }
    } catch (error) {
      alert.error(
        getSmartAccountActionErrorMessage(
          error,
          t('send.cantCompleteTxs'),
          t('send.insufficientFundsForGas')
        )
      );
    } finally {
      setBusyKey('');
    }
  }, [account?.id, alert, controllerEmitter, customInstall, t]);

  const handleCustomInstall = useCallback(async () => {
    if (!customInstall || !account?.address || !customInstall.acknowledged) {
      return;
    }
    if (!activeValidator?.data) {
      alert.error(t('smartAccountHub.noActiveValidator'));
      return;
    }
    const address = getAddress(customInstall.address.trim());
    const initData = customInstall.initData || '0x';
    setBusyKey('custom:install');
    try {
      await submitExecutions(
        buildCustomValidatorInstallExecutions({
          accountAddress: account.address,
          activeValidatorAddress: activeValidator.address,
          activeValidatorData: activeValidator.data,
          customInitData: initData,
          customValidatorAddress: address,
        })
      );
      await controllerEmitter(
        ['wallet', 'addSmartAccountCustomModule'],
        [
          {
            accountId: account.id,
            record: {
              address,
              initData,
              moduleType: 1,
              name:
                customInstall.name.trim() || t('smartAccountHub.customModule'),
            },
          },
        ],
        30000
      );
      await refreshMetadata();
      alert.success(t('smartAccountHub.moduleInstalled'));
      setCustomInstall(null);
    } catch (error) {
      alert.error(
        getSmartAccountActionErrorMessage(
          error,
          t('send.cantCompleteTxs'),
          t('send.insufficientFundsForGas')
        )
      );
    } finally {
      setBusyKey('');
    }
  }, [
    account?.address,
    account?.id,
    alert,
    activeValidator,
    controllerEmitter,
    customInstall,
    refreshMetadata,
    submitExecutions,
    t,
  ]);

  const compositeCandidates = metadata
    ? listCompositeChildCandidates(metadata)
    : [];
  const installedComposite = installedValidators.find(
    (module) => module.id === 'composite'
  );

  const handleCompositeSave = useCallback(async () => {
    if (!compositeBuilder || !account?.address || !metadata) return;
    const { children, threshold } = compositeBuilder;
    if (children.length === 0 || threshold < 1 || threshold > children.length) {
      alert.error(t('smartAccountHub.compositeInvalid'));
      return;
    }
    // Lockout guard: the composite must keep at least one Pali-signable
    // child below threshold reach (i.e. signable children >= threshold).
    const signableChildren = children.filter((child) => {
      const childModule = installedValidators.find(
        (module) => module.address.toLowerCase() === child.toLowerCase()
      );
      return (
        childModule &&
        isPaliSignableValidator(childModule, metadata) &&
        childModule.id !== 'composite'
      );
    });
    if (signableChildren.length < threshold) {
      alert.error(t('smartAccountHub.compositeLockout'));
      return;
    }

    const initData = encodeCompositeValidatorInitData(children, threshold);
    const compositeAddress = marketplaceModules.find(
      (module) => module.id === 'composite'
    );
    if (!compositeAddress) {
      alert.error(t('smartAccountHub.compositeUnavailable'));
      return;
    }
    setBusyKey('composite:save');
    try {
      const moduleAddress = installedComposite?.address;
      if (moduleAddress) {
        const isActive = moduleAddress.toLowerCase() === activeValidatorAddress;
        await submitExecutions([
          {
            data: isActive
              ? encodeRotateValidatorModuleCall(moduleAddress, initData)
              : encodeUninstallValidatorModuleCall(moduleAddress),
            target: account.address,
            value: '0x0',
          },
          ...(!isActive
            ? [
                {
                  data: encodeInstallValidatorModuleCall(
                    moduleAddress,
                    initData
                  ),
                  target: account.address,
                  value: '0x0',
                },
              ]
            : []),
        ]);
      } else {
        // Fresh install: resolve the builtin composite module address.
        await submitExecutions([
          {
            data: encodeInstallValidatorModuleCall(
              getPaliModuleAddress(activeNetwork.chainId, 'composite'),
              initData
            ),
            target: account.address,
            value: '0x0',
          },
        ]);
      }
      alert.success(t('smartAccountHub.compositeSaved'));
      setCompositeBuilder(null);
    } catch (error) {
      alert.error(
        getSmartAccountActionErrorMessage(
          error,
          t('send.cantCompleteTxs'),
          t('send.insufficientFundsForGas')
        )
      );
    } finally {
      setBusyKey('');
    }
  }, [
    account?.address,
    activeNetwork.chainId,
    activeValidatorAddress,
    alert,
    compositeBuilder,
    installedComposite?.address,
    installedValidators,
    marketplaceModules,
    metadata,
    submitExecutions,
    t,
  ]);

  if (!isSmartAccount) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-brand-white">
        <Icon name="wallet" size={28} />
        <p className="text-sm text-center text-brand-gray200">
          {t('smartAccountHub.notSmartAccount')}
        </p>
        <Button
          variant="neutral"
          className="text-sm text-brand-royalblue"
          type="button"
          onClick={() => navigate('/settings/manage-accounts')}
        >
          {t('smartAccountHub.chooseAccount')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-8 text-brand-white">
      {/* Identity */}
      <div className="rounded-card bg-bkg-2 p-4 flex flex-col gap-1 text-left">
        <span className="text-xs text-brand-gray200">
          {t('smartAccountHub.accountAddress')}
        </span>
        {smartAccountAddress && (
          <AddressText value={smartAccountAddress} preset="medium" />
        )}
        {!metadata?.isDeployed && (
          <span className="text-xs text-warning-error">
            {t('smartAccountHub.notDeployed')}
          </span>
        )}
      </div>

      {/* Sign-in method */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">
            {t('smartAccountHub.signInMethod')}
          </h2>
          <button
            type="button"
            className="flex-shrink-0 whitespace-nowrap ml-3 text-xs text-brand-royalbluemedium hover:underline"
            onClick={goToPolicyPage}
          >
            {t('smartAccountHub.manage')}
          </button>
        </div>
        <div className="rounded-card bg-bkg-2 p-3 flex items-center justify-between">
          <div className="flex flex-col text-left">
            <span className="text-sm">
              {activeValidator
                ? moduleDisplayName(activeValidator, t)
                : t('smartAccountHub.noActiveValidator')}
            </span>
            {activeValidator && (
              <AddressText
                value={activeValidator.address}
                preset="short"
                copyable={false}
                className="text-xs text-brand-gray200"
              />
            )}
          </div>
          {activeValidator && (
            <span className="text-[10px] px-2 py-0.5 rounded-pill bg-brand-royalblue text-white">
              {t('smartAccountHub.active')}
            </span>
          )}
        </div>
      </section>

      {/* Installed modules */}
      <section>
        <h2 className="text-sm font-medium mb-2">
          {t('smartAccountHub.installedModules')}
        </h2>
        <ul className="flex flex-col gap-2">
          {installedModules.length === 0 && (
            <li className="text-xs text-brand-gray200">
              {t('smartAccountHub.noModules')}
            </li>
          )}
          {installedModules.map((module) => {
            const isValidator = module.type === 'validator';
            const isActive =
              isValidator &&
              module.address.toLowerCase() === activeValidatorAddress;
            const isCompositeChild = compositeChildren.has(
              module.address.toLowerCase()
            );
            const uninstallBlocked =
              !isValidator || isActive || isCompositeChild;
            return (
              <li
                key={`${module.id}:${module.address}`}
                className="rounded-card bg-bkg-2 p-3 flex items-center justify-between"
              >
                <div className="flex flex-col text-left">
                  <span className="text-sm flex items-center gap-2">
                    {moduleDisplayName(module, t)}
                    {module.id === 'custom' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-pill bg-warning-error bg-opacity-30 text-warning-error">
                        {t('smartAccountHub.customBadge')}
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[10px] px-2 py-0.5 rounded-pill bg-brand-royalblue text-white">
                        {t('smartAccountHub.active')}
                      </span>
                    )}
                  </span>
                  <AddressText
                    value={module.address}
                    preset="short"
                    copyable={false}
                    className="text-xs text-brand-gray200"
                  />
                </div>
                {module.id === 'guardian-recovery' ? (
                  <button
                    type="button"
                    className="flex-shrink-0 whitespace-nowrap ml-3 text-xs text-brand-royalbluemedium hover:underline"
                    onClick={goToPolicyPage}
                  >
                    {t('smartAccountHub.manage')}
                  </button>
                ) : (
                  module.type === 'validator' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={
                        uninstallBlocked ||
                        busyKey === `uninstall:${module.address}`
                      }
                      loading={busyKey === `uninstall:${module.address}`}
                      onClick={() =>
                        setConfirmUninstall(
                          module as SmartAccountValidatorModule
                        )
                      }
                    >
                      {t('smartAccountHub.uninstall')}
                    </Button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Marketplace */}
      <section>
        <h2 className="text-sm font-medium mb-2">
          {t('smartAccountHub.addModules')}
        </h2>
        <ul className="flex flex-col gap-2">
          {marketplaceModules
            .filter((module) => module.id !== 'composite')
            .map((module) => {
              const installed = installedModules.some(
                (candidate) => candidate.id === module.id
              );
              return (
                <li
                  key={module.id}
                  className="rounded-card bg-bkg-2 p-3 flex items-center justify-between"
                >
                  <div className="flex flex-col text-left">
                    <span className="text-sm">{module.displayName}</span>
                    <span className="text-xs text-brand-gray200">
                      {module.capability === 'p256-precompile'
                        ? t('settings.p256ModuleHint')
                        : module.id === 'guardian-recovery'
                        ? t('settings.smartAccountGuardianRecoveryDescription')
                        : t('settings.genericModuleHint')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="flex-shrink-0 whitespace-nowrap ml-3 text-xs text-brand-royalbluemedium hover:underline disabled:text-brand-gray300"
                    disabled={installed}
                    onClick={goToPolicyPage}
                  >
                    {installed
                      ? t('smartAccountHub.installed')
                      : t('smartAccountHub.setUp')}
                  </button>
                </li>
              );
            })}

          {/* Composite builder */}
          <li className="rounded-card bg-bkg-2 p-3 flex items-center justify-between">
            <div className="flex flex-col text-left">
              <span className="text-sm">
                {t('settings.compositeAuthenticator')}
              </span>
              <span className="text-xs text-brand-gray200">
                {t('smartAccountHub.compositeHint')}
              </span>
            </div>
            <button
              type="button"
              className="flex-shrink-0 whitespace-nowrap ml-3 text-xs text-brand-royalbluemedium hover:underline disabled:text-brand-gray300"
              disabled={compositeCandidates.length < 2 || !metadata?.isDeployed}
              onClick={() =>
                setCompositeBuilder({
                  children: installedComposite
                    ? installedComposite.id === 'composite'
                      ? installedComposite.config.childValidators
                      : []
                    : [],
                  threshold:
                    installedComposite?.id === 'composite'
                      ? installedComposite.config.threshold
                      : 1,
                })
              }
            >
              {installedComposite
                ? t('smartAccountHub.edit')
                : t('smartAccountHub.setUp')}
            </button>
          </li>

          {/* Bring your own validator */}
          <li className="rounded-card border border-dashed border-brand-whiteAlpaBlue p-3 flex items-center justify-between">
            <div className="flex flex-col text-left">
              <span className="text-sm">
                {t('smartAccountHub.customModule')}
              </span>
              <span className="text-xs text-brand-gray200">
                {t('smartAccountHub.customModuleHint')}
              </span>
            </div>
            <button
              type="button"
              className="flex-shrink-0 whitespace-nowrap ml-3 text-xs text-brand-royalbluemedium hover:underline disabled:text-brand-gray300"
              disabled={!metadata?.isDeployed}
              onClick={() => setCustomInstall({ ...INITIAL_CUSTOM_INSTALL })}
            >
              {t('smartAccountHub.install')}
            </button>
          </li>
        </ul>
      </section>

      {/* Shortcuts */}
      <section className="flex flex-col gap-2">
        <button
          type="button"
          className="rounded-card bg-bkg-2 p-3 flex items-center justify-between text-left"
          onClick={goToPolicyPage}
        >
          <span className="text-sm">
            {t('settings.smartAccountGuardianRecoveryTitle')}
          </span>
          <Icon name="arrowright" isSvg size={16} />
        </button>
        <button
          type="button"
          className="rounded-card bg-bkg-2 p-3 flex items-center justify-between text-left"
          onClick={() => navigate('/settings/advanced')}
        >
          <span className="text-sm">{t('smartAccountHub.infrastructure')}</span>
          <Icon name="arrowright" isSvg size={16} />
        </button>
      </section>

      {/* Uninstall confirmation */}
      <ConfirmationModal
        show={Boolean(confirmUninstall)}
        title={t('smartAccountHub.uninstallTitle')}
        description={t('smartAccountHub.uninstallDescription')}
        buttonText={t('smartAccountHub.uninstall')}
        onClick={() => confirmUninstall && handleUninstall(confirmUninstall)}
        onClose={() => setConfirmUninstall(null)}
        isButtonLoading={busyKey.startsWith('uninstall:')}
      />

      {/* BYO validator dialog */}
      {customInstall && (
        <DialogPrimitive
          show
          onClose={() => busyKey === '' && setCustomInstall(null)}
        >
          <CenterPanel>
            <CenterTitle>{t('smartAccountHub.customModule')}</CenterTitle>
            {customInstall.step === 'form' ? (
              <Form layout="vertical" className="mt-4 text-left">
                <Form.Item label={t('smartAccountHub.moduleName')}>
                  <Input
                    value={customInstall.name}
                    onChange={(event) =>
                      setCustomInstall((state) =>
                        state ? { ...state, name: event.target.value } : state
                      )
                    }
                    placeholder="My validator"
                  />
                </Form.Item>
                <Form.Item label={t('smartAccountHub.moduleAddress')}>
                  <Input
                    value={customInstall.address}
                    onChange={(event) =>
                      setCustomInstall((state) =>
                        state
                          ? { ...state, address: event.target.value.trim() }
                          : state
                      )
                    }
                    placeholder="0x..."
                  />
                </Form.Item>
                <Form.Item label={t('smartAccountHub.moduleInitData')}>
                  <Input
                    value={customInstall.initData}
                    onChange={(event) =>
                      setCustomInstall((state) =>
                        state
                          ? { ...state, initData: event.target.value.trim() }
                          : state
                      )
                    }
                    placeholder="0x"
                  />
                </Form.Item>
                <div className="flex justify-end gap-2 mt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCustomInstall(null)}
                  >
                    {t('buttons.cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busyKey === 'custom:preflight'}
                    onClick={runCustomPreflight}
                  >
                    {t('smartAccountHub.checkModule')}
                  </Button>
                </div>
              </Form>
            ) : (
              <div className="mt-4 text-left flex flex-col gap-3">
                <p className="text-xs text-brand-gray200">
                  {t('smartAccountHub.preflightPassed')}
                </p>
                <div className="rounded-card bg-warning-error bg-opacity-10 border border-warning-error p-3 text-xs text-left">
                  {t('smartAccountHub.customRisk')}
                </div>
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    className="custom-checkbox mt-0.5"
                    checked={customInstall.acknowledged}
                    onChange={(event) =>
                      setCustomInstall((state) =>
                        state
                          ? { ...state, acknowledged: event.target.checked }
                          : state
                      )
                    }
                  />
                  <span>{t('smartAccountHub.customRiskAck')}</span>
                </label>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setCustomInstall((state) =>
                        state ? { ...state, step: 'form' } : state
                      )
                    }
                  >
                    {t('buttons.cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!customInstall.acknowledged}
                    loading={busyKey === 'custom:install'}
                    onClick={handleCustomInstall}
                  >
                    {t('smartAccountHub.install')}
                  </Button>
                </div>
              </div>
            )}
          </CenterPanel>
        </DialogPrimitive>
      )}

      {/* Composite builder dialog */}
      {compositeBuilder && (
        <DialogPrimitive
          show
          onClose={() => busyKey === '' && setCompositeBuilder(null)}
        >
          <CenterPanel>
            <CenterTitle>{t('settings.compositeAuthenticator')}</CenterTitle>
            <div className="mt-4 text-left flex flex-col gap-3">
              <p className="text-xs text-brand-gray200">
                {t('smartAccountHub.compositeBuilderHint')}
              </p>
              <ul className="flex flex-col gap-2">
                {compositeCandidates.map((candidate) => {
                  const checked = compositeBuilder.children.some(
                    (child) =>
                      child.toLowerCase() === candidate.address.toLowerCase()
                  );
                  return (
                    <li key={candidate.address}>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          className="custom-checkbox"
                          checked={checked}
                          onChange={() =>
                            setCompositeBuilder((state) => {
                              if (!state) return state;
                              const children = checked
                                ? state.children.filter(
                                    (child) =>
                                      child.toLowerCase() !==
                                      candidate.address.toLowerCase()
                                  )
                                : [...state.children, candidate.address];
                              return {
                                ...state,
                                children,
                                threshold: Math.min(
                                  state.threshold,
                                  Math.max(children.length, 1)
                                ),
                              };
                            })
                          }
                        />
                        <span>{moduleDisplayName(candidate, t)}</span>
                        <AddressText
                          value={candidate.address}
                          preset="short"
                          copyable={false}
                          className="text-xs text-brand-gray200"
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
              <label className="flex items-center gap-2 text-xs">
                {t('smartAccountHub.threshold')}
                <input
                  type="number"
                  min={1}
                  max={Math.max(compositeBuilder.children.length, 1)}
                  value={compositeBuilder.threshold}
                  className="w-16 bg-bkg-1 border border-brand-whiteAlpaBlue rounded-field px-2 py-1 text-brand-white"
                  onChange={(event) =>
                    setCompositeBuilder((state) =>
                      state
                        ? {
                            ...state,
                            threshold: Math.max(
                              1,
                              Number(event.target.value) || 1
                            ),
                          }
                        : state
                    )
                  }
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCompositeBuilder(null)}
                >
                  {t('buttons.cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busyKey === 'composite:save'}
                  onClick={handleCompositeSave}
                >
                  {t('buttons.save')}
                </Button>
              </div>
            </div>
          </CenterPanel>
        </DialogPrimitive>
      )}
    </div>
  );
};

export default SmartAccountHub;
