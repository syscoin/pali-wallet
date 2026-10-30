import { Input, Form } from 'antd';
import { useForm } from 'antd/es/form/Form';
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Button, PageActionFooter } from 'components/index';
import { ImportedWalletSuccessfully } from 'components/Modal/WarningBaseModal';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { extractErrorMessage } from 'utils/index';
import { navigateBack } from 'utils/navigationState';
import { validatePrivateKeyValue } from 'utils/validatePrivateKey';
import { WATCH_ONLY_VALIDATION_TIMEOUT } from 'utils/watchOnlyImport';

const ImportAccountView = () => {
  const { controllerEmitter, handleWalletLockedError } = useController();
  const { navigate, alert } = useUtils();
  const { t } = useTranslation();
  const [form] = useForm();
  const [validPrivateKey, setValidPrivateKey] = useState(false);
  const location = useLocation();

  //* States
  const [isAccountImported, setIsAccountImported] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<{
    message: string;
    scope: string;
  } | null>(null);
  const [watchOnly, setWatchOnly] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [publicDraft, setPublicDraft] = useState(false);
  const [validIdentifier, setValidIdentifier] = useState(false);
  const [selectedUtxoAddressType, setSelectedUtxoAddressType] = useState<
    'p2wpkh' | 'p2pkh' | 'p2tr'
  >('p2wpkh');
  const validationRevision = useRef(0);
  const importInFlight = useRef(false);
  const importErrorRef = useRef<HTMLSpanElement>(null);
  const mounted = useRef(true);

  const {
    accounts,
    activeAccount: activeAccountMeta,
    isBitcoinBased,
    activeNetwork,
  } = useSelector((state: RootState) => state.vault);

  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const inputScope = JSON.stringify({
    watchOnly,
    isBitcoinBased,
    kind: activeNetwork.kind,
    chainId: activeNetwork.chainId,
    url: activeNetwork.url,
  });
  const inputScopeRef = useRef(inputScope);
  inputScopeRef.current = inputScope;
  const visibleImportError =
    importError?.scope === inputScope ? importError.message : undefined;

  useLayoutEffect(() => {
    if (!visibleImportError) return;
    const footer = importErrorRef.current?.closest<HTMLElement>(
      '[data-page-action-footer]'
    );
    const layout = footer?.closest<HTMLElement>(
      '[data-navigation-scroll="wallet-layout"]'
    );
    const identifier = layout?.querySelector<HTMLElement>(
      '#import-account-identifier'
    );
    if (!footer || !layout || !identifier) return;
    const overlap =
      identifier.getBoundingClientRect().bottom -
      footer.getBoundingClientRect().top +
      8;
    if (overlap > 0) layout.scrollTop += overlap;
  }, [visibleImportError]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      validationRevision.current += 1;
    };
  }, []);

  useEffect(() => {
    setImportError(null);
    validationRevision.current += 1;
    setValidPrivateKey(false);
    setValidIdentifier(false);
    if (form.getFieldValue('privKey'))
      void form.validateFields(['privKey']).catch(() => undefined);
  }, [form, inputScope]);

  useEffect(() => {
    setShowPrivateKey(false);
  }, [
    inputScope,
    activeAccountMeta.id,
    activeAccountMeta.type,
    activeAccount?.address,
  ]);

  if (!activeAccount) throw new Error('No account');

  const handleImportAccount = async () => {
    if (importInFlight.current) return;
    const inputValue = form.getFieldValue('privKey');
    if (typeof inputValue !== 'string' || !inputValue.trim()) return;
    const isCurrent = () =>
      mounted.current && inputScopeRef.current === inputScope;
    importInFlight.current = true;
    setImportError(null);
    setIsImporting(true);
    try {
      const values = await form.validateFields(['privKey']);
      if (!isCurrent() || values.privKey !== inputValue) return;
      const label: string | undefined = form.getFieldValue('label');
      const optionalLabel = label?.trim() ? label : undefined;
      const account = await controllerEmitter(
        watchOnly
          ? ['wallet', 'importWatchOnlyFromController']
          : ['wallet', 'importAccountFromPrivateKey'],
        watchOnly
          ? [inputValue, optionalLabel]
          : [
              inputValue,
              optionalLabel,
              isBitcoinBased
                ? { utxoAddressType: selectedUtxoAddressType }
                : undefined,
            ]
      );

      if (isCurrent() && account) setIsAccountImported(true);
    } catch (error) {
      if (!isCurrent() || Array.isArray(error?.errorFields)) return;
      // Check if this is a wallet locked error and handle redirect
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        // If not a wallet locked error, show the original error message
        const message = extractErrorMessage(
          error,
          t('settings.accountImportFailed')
        );
        const visibleMessage =
          message === WATCH_ONLY_VALIDATION_TIMEOUT
            ? t('settings.watchOnlyValidationTimedOut')
            : message;
        if (watchOnly)
          setImportError({ scope: inputScope, message: visibleMessage });
        else alert.error(visibleMessage);
      }
    } finally {
      importInFlight.current = false;
      if (mounted.current) setIsImporting(false);
    }
  };

  // Simple WIF heuristic for showing the address-type selector: only on UTXO networks, not watch-only, not extended keys
  const showAddressTypeSelector = useMemo(() => {
    if (watchOnly || !isBitcoinBased) return false;
    const value: string = form.getFieldValue('privKey') || '';
    if (!value) return false;
    const prefix = value.substring(0, 4);
    const looksLikeExtended = ['zprv', 'vprv', 'xprv', 'tprv'].includes(prefix);
    const looksLikeHex =
      value.startsWith('0x') || /^[0-9a-fA-F]{64}$/.test(value);
    if (looksLikeExtended || looksLikeHex) return false;
    // If basic validation passed, treat as WIF and show selector
    return validPrivateKey;
  }, [watchOnly, isBitcoinBased, form, validPrivateKey]);

  return (
    <>
      <ImportedWalletSuccessfully
        show={isAccountImported}
        onClose={() => navigateBack(navigate, location)}
        title={t('settings.accountImported')}
      />

      <p className="mb-8 text-left text-white text-sm">
        {t('settings.importAccountsWont')}
      </p>

      <div className="flex flex-col items-center justify-center w-full">
        <Form
          validateMessages={{ default: '' }}
          className="flex flex-col gap-2 text-center w-full"
          name="newaccount"
          autoComplete="off"
          form={form}
          disabled={isImporting}
          onFinish={handleImportAccount}
          onValuesChange={(changed) => {
            setImportError(null);
            if (Object.prototype.hasOwnProperty.call(changed, 'privKey')) {
              // A draft entered as a secret remains masked on switching modes
              // until it is cleared, or the user explicitly reveals it.
              if (!watchOnly || !changed.privKey) setPublicDraft(watchOnly);
              validationRevision.current += 1;
              setValidPrivateKey(false);
              setValidIdentifier(false);
            }
          }}
        >
          <Form.Item
            name="label"
            className="w-full"
            hasFeedback
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
          >
            <Input
              type="text"
              className="custom-input-normal relative"
              placeholder={`${t('settings.label')} (${t('settings.optional')})`}
              aria-label={`${t('settings.label')} (${t('settings.optional')})`}
              id="account-name-input"
            />
          </Form.Item>
          {showAddressTypeSelector && (
            <div className="mb-2 text-left">
              <label className="block text-white text-sm mb-2">
                {t('settings.addressType')}
              </label>
              <div className="flex gap-3">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="utxoAddressType"
                    disabled={isImporting}
                    checked={selectedUtxoAddressType === 'p2wpkh'}
                    onChange={() => setSelectedUtxoAddressType('p2wpkh')}
                  />
                  <span className="text-white text-sm">SegWit (P2WPKH)</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="utxoAddressType"
                    disabled={isImporting}
                    checked={selectedUtxoAddressType === 'p2pkh'}
                    onChange={() => setSelectedUtxoAddressType('p2pkh')}
                  />
                  <span className="text-white text-sm">
                    {t('settings.legacyAddressType')}
                  </span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="utxoAddressType"
                    disabled={isImporting}
                    checked={selectedUtxoAddressType === 'p2tr'}
                    onChange={() => setSelectedUtxoAddressType('p2tr')}
                  />
                  <span className="text-white text-sm">Taproot (P2TR)</span>
                </label>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between mb-2">
            <label
              className="text-white text-sm"
              htmlFor="import-account-watch-only"
            >
              {t('settings.watchOnly')}
            </label>
            <input
              id="import-account-watch-only"
              type="checkbox"
              checked={watchOnly}
              disabled={isImporting}
              onChange={(e) => {
                setPublicDraft(
                  e.target.checked && !form.getFieldValue('privKey')
                );
                setShowPrivateKey(false);
                setWatchOnly(e.target.checked);
              }}
              className="toggle-checkbox"
            />
          </div>
          <Form.Item
            name="privKey"
            className="w-full"
            hasFeedback
            rules={[
              { required: true, message: '' },
              () => ({
                async validator(_, value) {
                  const revision = ++validationRevision.current;
                  const isCurrent = () =>
                    mounted.current &&
                    inputScopeRef.current === inputScope &&
                    validationRevision.current === revision &&
                    form.getFieldValue('privKey') === value;
                  if (typeof value !== 'string' || !value.trim()) {
                    if (isCurrent()) {
                      setValidPrivateKey(false);
                      setValidIdentifier(false);
                    }
                    return Promise.reject(
                      new Error(t('settings.invalidPrivateKeyFormat'))
                    );
                  }
                  if (!watchOnly) {
                    const isValid = await validatePrivateKeyValue(
                      typeof value === 'string' ? value : '',
                      isBitcoinBased,
                      activeNetwork
                    );
                    if (!isCurrent())
                      return Promise.reject(
                        new Error(t('settings.invalidPrivateKeyFormat'))
                      );
                    if (isValid) {
                      setValidPrivateKey(true);
                      setValidIdentifier(false);
                      return Promise.resolve();
                    }
                    setValidPrivateKey(false);
                    // Check if it's a network type mismatch
                    const zprvPrefixes = ['zprv', 'vprv', 'xprv', 'tprv'];
                    const inputValue = typeof value === 'string' ? value : '';
                    const prefix = inputValue.substring(0, 4);
                    const looksLikeZprv = zprvPrefixes.includes(prefix);
                    const looksLikeEvm =
                      inputValue.startsWith('0x') ||
                      /^[0-9a-fA-F]{64}$/.test(inputValue);
                    if (!isBitcoinBased && looksLikeZprv) {
                      return Promise.reject(
                        new Error(t('settings.utxoKeyOnEvmError'))
                      );
                    }
                    if (isBitcoinBased && looksLikeEvm) {
                      return Promise.reject(
                        new Error(t('settings.evmKeyOnUtxoError'))
                      );
                    }
                    return Promise.reject(
                      new Error(t('settings.invalidPrivateKeyFormat'))
                    );
                  } else {
                    // Secret-bearing identifiers must never reach Blockbook.
                    const isPublic =
                      (await controllerEmitter(
                        ['wallet', 'validateWatchOnlyIdentifier'],
                        [value]
                      )) === true;
                    if (!isCurrent())
                      return Promise.reject(
                        new Error(t('settings.invalidWatchOnlyIdentifier'))
                      );
                    setValidIdentifier(isPublic);
                    setValidPrivateKey(false);
                    return isPublic
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error(t('settings.invalidWatchOnlyIdentifier'))
                        );
                  }
                },
              }),
            ]}
          >
            <Input
              type={
                (watchOnly && publicDraft) || showPrivateKey
                  ? 'text'
                  : 'password'
              }
              className="custom-input-normal relative"
              autoComplete="off"
              suffix={
                !(watchOnly && publicDraft) && (
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded focus-visible:outline focus-visible:outline-2"
                    aria-label={t(
                      showPrivateKey
                        ? 'sentry.hidePrivateKeys'
                        : 'sentry.showPrivateKeys'
                    )}
                    aria-pressed={showPrivateKey}
                    disabled={isImporting}
                    onClick={() => setShowPrivateKey((current) => !current)}
                  >
                    <img
                      className="h-5 w-5"
                      alt=""
                      src={
                        showPrivateKey
                          ? '/assets/all_assets/notVisibleEye.svg'
                          : '/assets/all_assets/visibleEye.svg'
                      }
                    />
                  </button>
                )
              }
              placeholder={
                watchOnly
                  ? t('settings.publicIdentifierInput')
                  : t('settings.yourPrivateKey')
              }
              aria-label={
                watchOnly
                  ? t('settings.publicIdentifierInput')
                  : t('settings.yourPrivateKey')
              }
              id="import-account-identifier"
            />
          </Form.Item>
          <PageActionFooter
            error={
              visibleImportError ? (
                <span ref={importErrorRef}>{visibleImportError}</span>
              ) : undefined
            }
          >
            <Button
              variant="neutral"
              className="text-sm text-brand-royalblue"
              type="submit"
              loading={isImporting}
              fullWidth={true}
              disabled={watchOnly ? !validIdentifier : !validPrivateKey}
            >
              {t('buttons.import')}
            </Button>
          </PageActionFooter>
        </Form>
      </div>
    </>
  );
};

export default ImportAccountView;
