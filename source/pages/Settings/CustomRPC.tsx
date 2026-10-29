/* eslint-disable react/prop-types */
import { Switch } from '@headlessui/react';
import { Form, Input, type InputProps, type InputRef } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';

import { ChainIcon } from 'components/ChainIcon';
import { Icon } from 'components/Icon';
import { Button, Tooltip } from 'components/index';
import { StatusModal } from 'components/Modal/StatusModal';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { getControllerStatus } from 'hooks/controllerStatus';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { INetworkType, INetwork } from 'types/network';
import { ICustomRpcParams } from 'types/transactions';
import { getWalletNavigationScope, navigateBack } from 'utils/navigationState';
import { networkRegistrationFingerprint } from 'utils/networkRegistration';
import { translateRpcValidationError } from 'utils/rpcValidationError';

import {
  discardCustomRpcDraft,
  readCustomRpcDraft,
  writeCustomRpcDraft,
} from './customRpcDraft';

interface IChainInfo {
  chain: INetworkType;
  chainId: number;
  chainSlug?: string;
  coinLabel?: string;
  coinShortcut?: string;
  explorers?: Array<{
    name: string;
    standard?: string;
    url: string;
  }>;
  icon?: string;
  infoURL?: string;
  name: string;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  networkId: number;
  rpc: Array<{
    isOpenSource?: boolean;
    tracking?: string;
    url: string;
  }>;
  shortName?: string;
  // Additional fields for UTXO networks
  slip44?: number;
}

const NETWORK_BADGE_CLASS =
  'text-xs px-2 py-0.5 text-white bg-brand-royalblue rounded-full font-medium shadow-sm group-hover:shadow-md group-hover:bg-brand-blue500 transform group-hover:scale-105 transition-all duration-300 flex-shrink-0';
const NETWORK_INPUT_CLASS = 'custom-input-normal relative';

// Retain the existing empty feedback slot/affix wrapper without introducing
// an icon when this styled item becomes the Name field's sole owner.
const NETWORK_NAME_FEEDBACK = {
  icons: () => ({
    error: false,
    success: false,
    validating: false,
    warning: false,
  }),
};

type NetworkNameControlProps = Omit<InputProps, 'children'> & {
  children: React.ReactNode;
  dropdownRef: React.Ref<HTMLDivElement>;
  onDropdownBlur: React.FocusEventHandler<HTMLDivElement>;
};

// Form.Item owns the real input ref and all native control/ARIA props. Keep its
// single onChange chain on Input, not on the surrounding dropdown anchor.
const NetworkNameControl = React.forwardRef<InputRef, NetworkNameControlProps>(
  function renderNetworkNameControl(
    { children, dropdownRef, onDropdownBlur, ...inputProps },
    ref
  ) {
    return (
      <div
        className="relative w-full"
        ref={dropdownRef}
        onBlur={onDropdownBlur}
      >
        <Input {...inputProps} ref={ref} />
        {children}
      </div>
    );
  }
);

const networkFormValues = (
  network: INetwork | null | undefined,
  isSyscoinRpc: boolean
) => ({
  label: network?.label ?? '',
  url: network?.url ?? '',
  chainId: network?.chainId ?? '',
  symbol: network?.currency?.toUpperCase() ?? '',
  explorer:
    !isSyscoinRpc && network?.explorerExplicitlyAbsent
      ? ''
      : network?.explorer?.trim() || network?.url || '',
  apiUrl: isSyscoinRpc ? '' : network?.apiUrl ?? '',
});

const CustomRPCView = () => {
  const location = useLocation();
  const { state }: { state: any } = location;
  const { t } = useTranslation();
  const networks = useSelector(
    (reduxState: RootState) => reduxState.vaultGlobal.networks
  );
  const draftScope = useSelector(() =>
    JSON.stringify(getWalletNavigationScope())
  );
  const currentNetwork: INetwork | undefined =
    state?.isEditing && state?.selected
      ? networks[
          state.selected.kind === INetworkType.Syscoin ? 'syscoin' : 'ethereum'
        ][state.selected.key || state.selected.chainId]
      : undefined;
  // Keep the predecessor tied to the fields, not to later Redux broadcasts.
  const editingNetworkRef = React.useRef(currentNetwork);
  const latestEditingNetworkRef = React.useRef(currentNetwork);
  latestEditingNetworkRef.current = currentNetwork;
  const [draftRegistration, setDraftRegistration] = useState(() =>
    networkRegistrationFingerprint(currentNetwork)
  );
  const draftEditorIdentity = JSON.stringify([
    Boolean(state?.isEditing),
    state?.selected?.kind,
    state?.selected?.key,
    state?.selected?.chainId,
    Boolean(state?.isDefault),
  ]);
  const draftEditor = JSON.stringify([draftEditorIdentity, draftRegistration]);
  const [draftId] = useState(() =>
    typeof state?.customRpcDraftId === 'string' &&
    /^[a-f0-9-]{36}$/.test(state.customRpcDraftId)
      ? state.customRpcDraftId
      : uuidv4()
  );
  const [restoredDraft] = useState(() =>
    readCustomRpcDraft(draftId, draftScope, draftEditor)
  );
  const isSyscoinSelected = state && state.chain && state.chain === 'syscoin';
  // When editing, determine network type from the selected network
  const [loading, setLoading] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState<string>('');
  const [isSyscoinRpc, setIsSyscoinRpc] = useState(() => {
    if (state?.isEditing && state?.selected) {
      return state.selected.kind === INetworkType.Syscoin;
    }
    return restoredDraft?.isSyscoinRpc ?? Boolean(isSyscoinSelected);
  });
  const [networkQuery, setNetworkQuery] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [testingRpcs, setTestingRpcs] = useState(false);
  const [allChains, setAllChains] = useState<IChainInfo[]>([]);
  const [currentRpcTest, setCurrentRpcTest] = useState<{
    index: number;
    total: number;
    url: string;
  } | null>(null);
  // Removed conditional save logic to keep it simple

  const { controllerEmitter } = useController();
  const { alert, navigate } = useUtils();

  const [form] = useForm();
  const draftFamilyRef = React.useRef(isSyscoinRpc);
  draftFamilyRef.current = isSyscoinRpc;
  const draftContext = JSON.stringify([draftScope, draftEditorIdentity]);
  const initialDraftContext = React.useRef<string | undefined>(draftContext);
  const currentDraftContext = React.useRef(draftContext);
  const draftDiscarded = React.useRef(false);
  const discardDraft = () => {
    draftDiscarded.current = true;
    discardCustomRpcDraft(draftId);
  };
  const mountedRef = React.useRef(true);
  const draftRevisionRef = React.useRef(0);
  const latestLocationRef = React.useRef(location);
  latestLocationRef.current = location;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      draftRevisionRef.current += 1;
    };
  }, []);
  const invalidatePendingChecks = () => {
    draftRevisionRef.current += 1;
    setTestingRpcs(false);
    setCurrentRpcTest(null);
  };
  const refreshChangedEditor = () => {
    if (
      !state?.isEditing ||
      networkRegistrationFingerprint(editingNetworkRef.current) ===
        networkRegistrationFingerprint(latestEditingNetworkRef.current)
    )
      return false;
    editingNetworkRef.current = latestEditingNetworkRef.current;
    setDraftRegistration(
      networkRegistrationFingerprint(latestEditingNetworkRef.current)
    );
    invalidatePendingChecks();
    discardCustomRpcDraft(draftId);
    form.setFieldsValue(
      networkFormValues(latestEditingNetworkRef.current, isSyscoinRpc)
    );
    setLoading(false);
    setShowModal(true);
    setErrorModalMessage(t('settings.networkChangedRetry'));
    return true;
  };
  const isCurrentRoute = (origin: typeof location) => {
    const current = latestLocationRef.current;
    const nativeKey = window.history.state?.key;
    const nativeRoute = window.location.hash.startsWith('#/')
      ? window.location.hash.slice(1)
      : undefined;
    return (
      mountedRef.current &&
      current.key === origin.key &&
      current.pathname + current.search + current.hash ===
        origin.pathname + origin.search + origin.hash &&
      (!nativeRoute ||
        nativeRoute === origin.pathname + origin.search + origin.hash) &&
      (typeof nativeKey !== 'string' ||
        typeof origin.key !== 'string' ||
        nativeKey === origin.key)
    );
  };
  const createOperationGuard = () => {
    const origin = location;
    const scope = getWalletNavigationScope();
    const draftRevision = draftRevisionRef.current;
    const expectedRegistration = networkRegistrationFingerprint(
      editingNetworkRef.current
    );
    return (allowNetworkChange = false) => {
      const status = getControllerStatus();
      const currentScope = getWalletNavigationScope();
      return (
        isCurrentRoute(origin) &&
        draftRevisionRef.current === draftRevision &&
        status.isUnlocked &&
        !status.isLoading &&
        !status.connectionUnavailable &&
        currentScope.account === scope.account &&
        (allowNetworkChange ||
          (currentScope.network === scope.network &&
            (!state?.isEditing ||
              (expectedRegistration !== undefined &&
                expectedRegistration ===
                  networkRegistrationFingerprint(
                    latestEditingNetworkRef.current
                  )))))
      );
    };
  };
  const rpcValidationAttemptRef = React.useRef(0);
  const rpcValidationFeedbackRef = React.useRef<{
    message: string;
    url: string;
  } | null>(null);
  const urlInputRef = React.useRef<any>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const suggestionsId = 'custom-rpc-network-suggestions';
  const closeSuggestions = () => {
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
  };

  const switchBallStyle = isSyscoinRpc
    ? 'translate-x-6 bg-brand-deepPink100'
    : 'translate-x-1  bg-brand-blue200';

  const validateUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);

      // Must be http or https
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return false;
      }

      // Must have a hostname
      if (!urlObj.hostname) {
        return false;
      }

      // URL parsing has already validated bracketed IPv6 literals.
      // Localhost and IP addresses do not need the DNS/TLD checks below.
      if (
        urlObj.hostname === 'localhost' ||
        /^\d+\.\d+\.\d+\.\d+$/.test(urlObj.hostname) ||
        urlObj.hostname.startsWith('[')
      ) {
        return true;
      }

      // For regular domains, must have at least one dot and valid TLD
      const parts = urlObj.hostname.split('.');
      if (parts.length < 2) {
        return false;
      }

      // Last part (TLD) must be at least 2 characters
      const tld = parts[parts.length - 1];
      if (tld.length < 2) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  };

  const urlFormatRule = () => ({
    validator(_, value) {
      if (!value || value.trim() === '') {
        return Promise.resolve();
      }
      if (validateUrl(value.trim())) {
        return Promise.resolve();
      }
      return Promise.reject(new Error(t('settings.validUrlRequired')));
    },
  });

  const testBlockExplorerApi = async (
    apiUrl: string
  ): Promise<{ error?: string; success: boolean }> => {
    try {
      // Use the controller's testExplorerApi method
      const result = await controllerEmitter(
        ['wallet', 'testExplorerApi'],
        [apiUrl]
      );

      // The controller returns { success: boolean; error?: string }
      // Make sure we properly handle the response
      if (result && typeof result === 'object' && 'success' in result) {
        return result as { error?: string; success: boolean };
      }

      // Fallback for unexpected response format
      return { success: Boolean(result), error: t('settings.apiFormatError') };
    } catch (error) {
      console.log('API test failed:', error);
      return {
        success: false,
        error: error?.message || t('settings.apiConnectionError'),
      };
    }
  };

  const closeModal = () => {
    setShowModal(false);
  };

  const validateApiUrlAndShowError = async (
    apiUrl?: string,
    canApply = createOperationGuard()
  ) => {
    if (!canApply()) return false;
    if (!apiUrl || !apiUrl.trim()) {
      // Clear any existing API URL field errors
      form.setFields([
        {
          name: 'apiUrl',
          errors: [],
        },
      ]);
      return true; // Optional field
    }

    try {
      const result = await testBlockExplorerApi(apiUrl.trim());
      if (!canApply()) return false;
      if (!result.success) {
        // Improve error message handling
        let errorMessage = result.error || t('settings.apiFormatError');

        // Check if error is a translation key (starts with 'settings.')
        if (result.error?.startsWith('settings.')) {
          errorMessage = t(result.error);
        } else if (result.error) {
          // Handle specific error types
          if (
            result.error.includes('SyntaxError') ||
            result.error.includes('Unexpected token')
          ) {
            errorMessage = t('settings.apiReturnedHtml');
          } else if (result.error.includes('404')) {
            errorMessage = t('settings.apiNotFound');
          } else if (result.error.includes('403')) {
            errorMessage = t('settings.apiForbidden');
          } else if (result.error.includes('500')) {
            errorMessage = t('settings.apiServerError');
          } else if (result.error.includes('timeout')) {
            errorMessage = t('settings.apiTimeout');
          }
        }

        // Set the form field to error state
        form.setFields([
          {
            name: 'apiUrl',
            errors: [errorMessage],
          },
        ]);

        alert.error(errorMessage, {
          autoClose: 4000,
        });
        return false;
      }

      // Clear any existing errors and set to success state
      form.setFields([
        {
          name: 'apiUrl',
          errors: [],
        },
      ]);

      return true;
    } catch (error) {
      if (!canApply()) return false;
      // Handle different types of errors
      let errorMessage = t('settings.apiConnectionError');

      if (error && typeof error === 'object' && 'message' in error) {
        const msg = (error as Error).message;
        if (msg.includes('SyntaxError') || msg.includes('Unexpected token')) {
          errorMessage = t('settings.apiReturnedHtml');
        } else if (msg.includes('NetworkError') || msg.includes('fetch')) {
          errorMessage = t('settings.apiNetworkError');
        } else if (msg.includes('timeout')) {
          errorMessage = t('settings.apiTimeout');
        } else {
          errorMessage = t('settings.apiErrorDetail', {
            message: msg,
            interpolation: { escapeValue: false },
          });
        }
      }

      // Set the form field to error state
      form.setFields([
        {
          name: 'apiUrl',
          errors: [errorMessage],
        },
      ]);

      alert.error(errorMessage, {
        autoClose: 4000,
      });
      return false;
    }
  };

  const validateRpcUrlAndShowError = async (
    rpcUrl?: string,
    formData?: ICustomRpcParams,
    canApply = createOperationGuard()
  ): Promise<INetwork | null> => {
    if (!canApply()) return null;
    const validationAttempt = ++rpcValidationAttemptRef.current;
    if (!rpcUrl || !rpcUrl.trim()) {
      // Clear any existing RPC URL field errors
      form.setFields([
        {
          name: 'url',
          errors: [],
        },
      ]);
      return null; // Required field validation will handle empty case
    }

    let ownValidationMessage: string | undefined;
    try {
      // Use getRpc from controller which handles all validation and returns the network
      const rpcParams = {
        url: rpcUrl.trim(),
        label: formData?.label || '',
        symbol: formData?.symbol || '',
        // Let user provide a public explorer for UTXO; fallback to url if empty
        explorer: (formData?.explorer || '').trim() || rpcUrl.trim(),
        apiUrl: isSyscoinRpc ? '' : formData?.apiUrl || '',
        chainId: formData?.chainId || '',
        isSyscoinRpc,
      };

      const network = (await controllerEmitter(
        ['wallet', 'getRpc'],
        [rpcParams]
      )) as INetwork;
      if (!canApply()) return null;

      if (!network) {
        ownValidationMessage = t('settings.failedValidateRpc');
        throw new Error('Failed to get network configuration from RPC');
      }

      // Auto-fill chainId from RPC validation
      if (network.chainId !== undefined && !state?.selected) {
        // For UTXO networks, always auto-fill chainId
        // For EVM networks, only auto-fill if user hasn't provided one
        const chainIdString = String(formData?.chainId || '').trim();
        const shouldAutoFillChainId = isSyscoinRpc || !chainIdString;

        if (shouldAutoFillChainId) {
          form.setFieldsValue({
            chainId: network.chainId.toString(),
          });
        }
      }

      // Auto-fill label and symbol from coin data for UTXO networks
      if (isSyscoinRpc && network.label && !formData?.label?.trim()) {
        form.setFieldsValue({
          label: network.label,
        });
      }

      // Auto-fill symbol from coin data for UTXO networks if not provided
      if (isSyscoinRpc && network.currency) {
        const currentSymbol = String(formData?.symbol || '').trim();
        if (!currentSymbol) {
          form.setFieldsValue({
            symbol: network.currency.toUpperCase(),
          });
        }
      }

      // For edit mode, verify chainId matches
      if (state?.selected && network.chainId !== state.selected.chainId) {
        throw new Error(t('settings.networkMismatch'));
      }

      // For EVM networks in create mode, validate user-provided chainId matches RPC
      if (!isSyscoinRpc && !state?.selected && formData?.chainId) {
        const chainIdString = String(formData.chainId).trim();
        if (chainIdString) {
          const userProvidedChainId = Number(chainIdString);
          if (
            !isNaN(userProvidedChainId) &&
            network.chainId !== userProvidedChainId
          ) {
            ownValidationMessage = t('settings.chainIdMismatch', {
              actual: network.chainId,
              expected: userProvidedChainId,
            });
            throw new Error(
              `Chain ID mismatch: RPC reports ${network.chainId}, but you entered ${userProvidedChainId}`
            );
          }
        }
      }

      if (!canApply()) return null;
      const previousFeedback = rpcValidationFeedbackRef.current;
      if (
        validationAttempt === rpcValidationAttemptRef.current &&
        previousFeedback?.url === rpcUrl.trim()
      ) {
        // Clear only this helper's older error, not local format feedback or
        // an error from a newer retry of the same endpoint.
        form.setFields([
          {
            name: 'url',
            errors: form
              .getFieldError('url')
              .filter((message) => message !== previousFeedback.message),
          },
        ]);
        rpcValidationFeedbackRef.current = null;
      }
      return network;
    } catch (error) {
      if (!canApply()) return null;
      // Extract the actual error message from the thrown error
      let errorMessage =
        ownValidationMessage || t('settings.failedValidateRpc');
      if (
        !ownValidationMessage &&
        error &&
        typeof error === 'object' &&
        'message' in error
      ) {
        errorMessage = (error as Error).message;
      } else if (!ownValidationMessage && typeof error === 'string') {
        errorMessage = error;
      }

      if (!ownValidationMessage)
        errorMessage = translateRpcValidationError(errorMessage, t);

      rpcValidationFeedbackRef.current = {
        message: errorMessage,
        url: rpcUrl.trim(),
      };
      form.setFields([
        {
          name: 'url',
          errors: [errorMessage],
        },
      ]);

      alert.error(errorMessage, {
        autoClose: 4000,
      });
      return null;
    }
  };

  const onSubmit = async (data: ICustomRpcParams) => {
    const origin = location;
    const expectedNetwork = editingNetworkRef.current;
    const expectedRegistration =
      networkRegistrationFingerprint(expectedNetwork);
    const stillActive = createOperationGuard();
    const canContinue = (allowNetworkChange = false) => {
      if (stillActive(allowNetworkChange)) return true;
      // A canceled request must not leave this visible form in a pending state.
      if (isCurrentRoute(origin)) {
        setLoading(false);
        refreshChangedEditor();
      }
      return false;
    };
    if (!canContinue()) return;
    setLoading(true);

    // Validate form fields before proceeding
    try {
      await form.validateFields();
      if (!canContinue()) return;
    } catch (error) {
      if (!canContinue()) return;
      console.log('Form validation failed:', error);
      setLoading(false);

      // Get specific field errors to show user
      const fieldErrors = form.getFieldsError();
      const errorFields = fieldErrors.filter(
        (field) => field.errors.length > 0
      );

      let errorMessage = t('settings.fixValidationErrors');
      if (errorFields.length > 0) {
        const firstError = errorFields[0];
        errorMessage = firstError.errors[0];
      }

      alert.error(errorMessage, {
        autoClose: 4000,
      });
      return;
    }

    // Prepare data for UTXO networks - set appropriate defaults
    if (isSyscoinRpc) {
      // Keep the symbol as provided - it's required and should be auto-filled
      // Allow user to specify a public explorer; fallback to URL if empty
      data.explorer = (data.explorer || '').trim() || data.url;
      data.apiUrl = ''; // UTXO networks don't use separate API URLs
    }
    // Convert the complete validated value, never a numeric prefix.
    if (typeof data.chainId === 'string') {
      data.chainId = Number(data.chainId);
    }

    // Validate RPC URL and get network configuration
    const validatedNetwork = await validateRpcUrlAndShowError(
      data.url,
      data,
      canContinue
    );
    if (!canContinue()) return;
    if (!validatedNetwork) {
      setLoading(false);
      return;
    }

    // Preserve blank intent separately from the SDK's compatibility fallback.
    const network =
      !isSyscoinRpc && !data.explorer?.trim()
        ? { ...validatedNetwork, explorerExplicitlyAbsent: true }
        : validatedNetwork;

    // Validate API URL and show toast error if invalid (only for EVM)
    if (!isSyscoinRpc && data.apiUrl) {
      const validApi = await validateApiUrlAndShowError(
        data.apiUrl,
        canContinue
      );
      if (!canContinue()) return;
      if (!validApi) {
        setLoading(false);
        return;
      }
    }
    if (!canContinue()) return;

    try {
      // Check if network already exists
      const existingNetworks =
        networks[
          network.kind === INetworkType.Syscoin ? 'syscoin' : 'ethereum'
        ];
      const existingNetwork = existingNetworks[network.chainId];

      // For UTXO networks, check for slip44 conflicts - keyring uses slip44 for key derivation
      // so only one network per slip44 value can exist (e.g., only one testnet at a time)
      if (network.kind === INetworkType.Syscoin && !state?.isEditing) {
        const blockchainConflict = Object.values(existingNetworks).find(
          (existingNet: INetwork) =>
            existingNet.slip44 === network.slip44 &&
            existingNet.chainId !== network.chainId
        );

        if (blockchainConflict) {
          const isTestnet = network.slip44 === 1;
          const networkType = isTestnet ? 'testnet' : 'mainnet';
          const existingNetworkName =
            blockchainConflict.label ||
            t('settings.chainNumber', { chainId: blockchainConflict.chainId });

          throw new Error(
            t('settings.utxoNetworkConflict', {
              networkType,
              existingNetworkName,
            })
          );
        }
      }

      if (state?.isEditing) {
        // In edit mode, network should exist
        if (!existingNetwork || !expectedNetwork || !expectedRegistration) {
          throw new Error(t('settings.networkNotFoundForEditing'));
        }

        // Network exists, update it
        // Preserve key if it exists
        const updatedNetwork: INetwork = {
          ...network,
          ...(expectedNetwork.key && { key: expectedNetwork.key }),
          default: expectedNetwork.default, // Preserve original default value
        };

        await controllerEmitter(
          ['wallet', 'editCustomRpc'],
          [updatedNetwork, expectedRegistration]
        );
        if (!canContinue(true)) return;
        setLoading(false);

        alert.success(t('settings.rpcSuccessfullyEdited'));

        discardDraft();
        navigateBack(navigate, location);
      } else {
        // In add mode, network shouldn't exist
        if (existingNetwork) {
          throw new Error(
            t('settings.networkAlreadyExists', { chainId: network.chainId })
          );
        }

        // New network, add it
        await controllerEmitter(['wallet', 'addCustomRpc'], [network]);
        if (!canContinue(true)) return;
        setLoading(false);

        alert.success(t('settings.rpcSuccessfullyAdded'));
        discardDraft();
        navigateBack(navigate, location);
      }
    } catch (error: any) {
      if (!canContinue(true)) return;
      refreshChangedEditor();
      setShowModal(true);
      setLoading(false);
      setErrorModalMessage(error.message);
    }
  };

  useEffect(() => {
    if (state?.isEditing && !currentNetwork) navigateBack(navigate, location);
  }, [state?.isEditing, currentNetwork, navigate, location]);

  const initialValues = {
    ...networkFormValues(currentNetwork, isSyscoinRpc),
    ...(initialDraftContext.current === draftContext
      ? restoredDraft?.values
      : {}),
  };

  // Only an opaque handle enters history. Endpoint text remains in this
  // document's scoped cache, and no validation result or pending work resumes.
  useEffect(() => {
    if (state?.customRpcDraftId === draftId) return;
    navigate(
      `${location.pathname}${location.search || ''}${location.hash || ''}`,
      {
        replace: true,
        state: { ...state, customRpcDraftId: draftId },
      }
    );
  }, [draftId, location, navigate, state]);

  React.useLayoutEffect(
    () => () => {
      if (
        draftDiscarded.current ||
        draftRegistration !==
          networkRegistrationFingerprint(editingNetworkRef.current)
      )
        return;
      writeCustomRpcDraft(draftId, draftScope, draftEditor, {
        isSyscoinRpc: draftFamilyRef.current,
        values: form.getFieldsValue(true),
      });
    },
    [draftId, draftScope, draftEditor, draftRegistration, form]
  );

  useEffect(() => {
    if (currentDraftContext.current === draftContext) return;
    // A later return to this scope cannot revive its initial restored values.
    initialDraftContext.current = undefined;
    currentDraftContext.current = draftContext;
    draftDiscarded.current = false;
    discardCustomRpcDraft(draftId);
    invalidatePendingChecks();
    editingNetworkRef.current = currentNetwork;
    setDraftRegistration(networkRegistrationFingerprint(currentNetwork));
    form.resetFields();
    form.setFieldsValue(initialValues);
    setIsSyscoinRpc(
      state?.isEditing
        ? state?.selected?.kind === INetworkType.Syscoin
        : Boolean(isSyscoinSelected)
    );
  }, [draftContext]);

  // Simplified - no conditional save logic

  const isInputDisableByEditMode = state?.isEditing ? state.isDefault : false;
  const needsLabelRepair =
    state?.isEditing &&
    currentNetwork &&
    (typeof currentNetwork.label !== 'string' || !currentNetwork.label.trim());

  // Preload chains based on network type for instant searching
  useEffect(() => {
    let active = true;
    setAllChains([]);
    const loadChains = async () => {
      try {
        const networkType = isSyscoinRpc
          ? INetworkType.Syscoin
          : INetworkType.Ethereum;
        const chains = (await controllerEmitter(
          ['wallet', 'getChainData'],
          [networkType]
        )) as IChainInfo[];
        if (!active) return;
        setAllChains(chains);
        console.log(
          `[CustomRPC] Preloaded ${chains.length} ${
            isSyscoinRpc ? 'UTXO' : 'EVM'
          } chains`
        );
      } catch (error) {
        if (!active) return;
        console.error('[CustomRPC] Failed to preload chains:', error);
        setAllChains([]);
      }
    };

    loadChains();
    return () => {
      active = false;
    };
  }, [isSyscoinRpc]); // Reload when network type changes

  // Track if we've already initialized the form to prevent overriding user changes
  const [formInitialized, setFormInitialized] = useState(
    Boolean(restoredDraft)
  );

  // Update form when Redux state changes (for editing mode) - only once on initial load
  useEffect(() => {
    if (currentNetwork && state?.isEditing && !formInitialized) {
      const formValues = networkFormValues(currentNetwork, isSyscoinRpc);
      form.setFieldsValue(formValues);
      setFormInitialized(true);
    }
  }, [currentNetwork, form, state?.isEditing, formInitialized, isSyscoinRpc]);

  // Simplified - no form change tracking needed

  // Handle clicks outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        closeSuggestions();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Filtering is local and synchronous, so a delayed search cannot reopen the
  // list after Escape, blur, or a network-type change.
  const networkSuggestions = React.useMemo(() => {
    const query = networkQuery;
    if (!query || !query.trim()) {
      return [];
    }

    // Don't search if query is too short
    if (query.trim().length < 2) {
      return [];
    }

    // Early return if no chains loaded yet
    if (allChains.length === 0) {
      return [];
    }

    const lowerQuery = query.toLowerCase().trim();
    const results: (IChainInfo & { score?: number })[] = [];

    allChains.forEach((chain) => {
      let score = 0;
      const name = chain.name.toLowerCase();
      const symbol = chain.nativeCurrency.symbol.toLowerCase();
      const chainId = chain.chainId.toString();
      const coinLabel = chain.coinLabel?.toLowerCase() || '';
      const coinShortcut = chain.coinShortcut?.toLowerCase() || '';

      // Scoring for relevance - exact matches score highest
      if (name === lowerQuery) score += 100;
      else if (name.startsWith(lowerQuery)) score += 50;
      else if (name.includes(lowerQuery)) score += 25;

      if (symbol === lowerQuery) score += 80;
      else if (symbol.startsWith(lowerQuery)) score += 40;
      else if (symbol.includes(lowerQuery)) score += 20;

      if (chainId === query) score += 90;
      else if (chainId.startsWith(query)) score += 45;

      // UTXO specific scoring
      if (coinLabel === lowerQuery) score += 100;
      else if (coinLabel.startsWith(lowerQuery)) score += 50;
      else if (coinLabel.includes(lowerQuery)) score += 25;

      if (coinShortcut === lowerQuery) score += 80;
      else if (coinShortcut.startsWith(lowerQuery)) score += 40;

      if (score > 0 && chain.rpc && chain.rpc.length > 0) {
        results.push({ ...chain, score });
      }
    });

    // Sort by score and take top 6 for better UI
    const sortedResults = results
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 6);

    return sortedResults;
  }, [networkQuery, allChains]);
  const showSuggestions =
    suggestionsOpen && networkSuggestions.length > 0 && !testingRpcs;
  const activeSuggestionId =
    showSuggestions &&
    activeSuggestion >= 0 &&
    activeSuggestion < networkSuggestions.length
      ? `${suggestionsId}-${activeSuggestion}`
      : undefined;

  useEffect(() => {
    setNetworkQuery('');
    closeSuggestions();
  }, [isSyscoinRpc]);

  useEffect(() => {
    if (activeSuggestionId) {
      document
        .getElementById(activeSuggestionId)
        ?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeSuggestionId]);

  // Handle network selection from autocomplete
  const handleNetworkSelect = async (chain: IChainInfo) => {
    invalidatePendingChecks();
    // Clear suggestions immediately to close dropdown
    closeSuggestions();
    setNetworkQuery(chain.name);

    const previous = form.getFieldsValue();
    // Fill form fields immediately for instant UX, always updating symbol like chainId
    const formValues: any = {
      label: chain.name,
      chainId: chain.chainId.toString(),
      symbol: chain.nativeCurrency.symbol.toUpperCase(),
      // A new suggestion must not inherit another chain's explorer.
      // UTXO keeps its existing fallback to the RPC that passes validation.
      explorer: isSyscoinRpc ? '' : chain.explorers?.[0]?.url || '',
      apiUrl:
        !isSyscoinRpc && Number(previous.chainId) === chain.chainId
          ? previous.apiUrl
          : '',
    };

    form.setFieldsValue(formValues);

    // Reset URL field before testing
    form.setFieldsValue({ url: '' });

    setCurrentRpcTest({
      index: 0,
      total: 0,
      url: '',
    });

    // Try RPCs/Blockbooks in order until we find one that works
    await tryBestWorkingRpc(chain);
  };

  // Try multiple RPCs/Blockbooks until we find one that works - with latency testing
  const tryBestWorkingRpc = async (chain: IChainInfo) => {
    if (!chain.rpc || chain.rpc.length === 0) return;
    const canApply = createOperationGuard();
    const draftRevision = draftRevisionRef.current;
    const origin = location;
    if (!canApply()) return;

    setTestingRpcs(true);

    // Order RPCs by preference: no tracking + open source > no tracking > open source > others
    const orderedRpcs = [...chain.rpc].sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      if (a.tracking === 'none' && a.isOpenSource) scoreA += 100;
      else if (a.tracking === 'none') scoreA += 50;
      else if (a.isOpenSource) scoreA += 25;

      if (b.tracking === 'none' && b.isOpenSource) scoreB += 100;
      else if (b.tracking === 'none') scoreB += 50;
      else if (b.isOpenSource) scoreB += 25;

      return scoreB - scoreA;
    });

    try {
      // Try each RPC until we find one that works for this same draft.
      for (let i = 0; i < orderedRpcs.length; i++) {
        if (!canApply()) return;
        const rpc = orderedRpcs[i];

        // Update progress
        setCurrentRpcTest({
          index: i + 1,
          total: orderedRpcs.length,
          url: rpc.url,
        });

        try {
          // Set this RPC in the form
          form.setFieldsValue({ url: rpc.url });

          // Add a small delay for UX
          await new Promise((resolve) => setTimeout(resolve, 300));
          if (!canApply()) return;

          // Use validateRpcBatchUniversal for both EVM and UTXO with different minimum latencies
          const result = (await controllerEmitter(
            ['wallet', 'testRpcConnection'],
            [
              rpc.url,
              isSyscoinRpc ? INetworkType.Syscoin : INetworkType.Ethereum,
              chain.chainId,
              5000,
              500,
            ]
          )) as {
            chainId?: number;
            data?: any;
            error?: string;
            latency?: number;
            requiresAuth?: boolean;
            success: boolean;
          };
          if (!canApply()) return;

          if (!result.success) {
            // Log why this RPC failed for debugging
            console.log(
              `${isSyscoinRpc ? 'Blockbook' : 'RPC'} ${rpc.url} failed:`,
              result.error
            );

            // If it requires authentication, skip to next without showing error
            if ('requiresAuth' in result && result.requiresAuth) {
              console.log(
                `${isSyscoinRpc ? 'Blockbook' : 'RPC'} ${
                  rpc.url
                } requires authentication, skipping...`
              );
              continue;
            }

            continue; // Try next RPC
          }

          // This RPC works!
          // Store the validated chainId to avoid re-validating
          if (result.chainId) {
            // Also update the form field
            form.setFieldsValue({ chainId: result.chainId.toString() });
          }
          // Symbol is already filled from chain.nativeCurrency.symbol in handleNetworkSelect

          const hostname = new URL(rpc.url).hostname;
          const latencyInfo =
            'latency' in result && result.latency
              ? ` (${result.latency}ms)`
              : '';
          const successMessage = t('settings.rpcConnectedVia', {
            network: chain.name,
            host: hostname,
            latency: latencyInfo,
            interpolation: { escapeValue: false },
          });

          alert.success(successMessage, {
            autoClose: 3000,
          });

          return;
        } catch (error) {
          if (!canApply()) return;
          console.log(
            `${isSyscoinRpc ? 'Blockbook' : 'RPC'} ${rpc.url} failed:`,
            error
          );
          continue;
        }
      }

      // If we get here, no RPC worked
      if (!canApply()) return;
      alert.error(
        t('settings.unableToConnectToNetwork', {
          networkName: chain.name,
          rpcType: isSyscoinRpc ? 'Blockbook URLs' : 'RPCs',
        }),
        {
          autoClose: 5000,
        }
      );
    } finally {
      // A stale completion must not clear the progress of a newer selection.
      if (
        draftRevisionRef.current === draftRevision &&
        isCurrentRoute(origin)
      ) {
        setTestingRpcs(false);
        setCurrentRpcTest(null);
      }
    }
  };

  // Custom icon component for autocomplete with proper caching
  const AutoCompleteIcon: React.FC<{ chain: IChainInfo; size?: number }> =
    React.memo(
      ({ chain, size = 24 }) => (
        <ChainIcon
          chainId={chain.chainId}
          size={size}
          networkKind={chain.chain || INetworkType.Ethereum}
          className="flex-shrink-0"
        />
      ),
      (prevProps, nextProps) =>
        prevProps.chain.chainId === nextProps.chain.chainId &&
        prevProps.size === nextProps.size
    );
  AutoCompleteIcon.displayName = 'AutoCompleteIcon';

  // Render keyed option elements directly: declaring a component inside this
  // view would remount the option when keyboard/pointer selection changes.
  const renderNetworkSuggestion = ({
    active,
    chain,
    id,
    onActivate,
    onSelect,
  }: {
    active: boolean;
    chain: IChainInfo;
    id: string;
    onActivate: () => void;
    onSelect: () => void;
  }) => {
    // Check if network name is long and might be truncated - more aggressive threshold
    const isLongName = chain.name.length > 18;

    return (
      <div
        key={id}
        id={id}
        role="option"
        aria-selected={active}
        className={`group relative flex items-center gap-2 py-2.5 px-4 hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 cursor-pointer transition-all duration-300 ease-in-out border-b border-dashed border-alpha-whiteAlpha300 last:border-b-0 hover:border-brand-royalblue hover:shadow-lg hover:shadow-brand-blue600/20 active:scale-[0.98] active:bg-brand-blue700 ${
          active
            ? 'bg-brand-blue500 ring-1 ring-inset ring-brand-royalblue'
            : ''
        }`}
        onMouseEnter={onActivate}
        onMouseDown={(e) => {
          e.preventDefault(); // Keep focus on the combobox input.
        }}
        onClick={onSelect}
      >
        {/* Background glow effect on hover */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>

        {/* Icon with enhanced hover styling */}
        <div className="relative flex-shrink-0 transform group-hover:scale-110 transition-transform duration-300 ease-out group-hover:brightness-125">
          <div className="relative group-hover:drop-shadow-lg">
            <AutoCompleteIcon chain={chain} size={24} />
            {/* More visible ring effect on hover */}
            <div className="absolute inset-0 rounded-full ring-2 ring-transparent group-hover:ring-brand-white/40 group-hover:ring-4 transition-all duration-300"></div>
          </div>
        </div>

        {/* Content with improved responsive layout */}
        <div className="flex-1 min-w-0 relative z-10">
          {/* Network name and chain ID - better spacing */}
          <div className="flex items-center justify-between gap-2 mb-0.5">
            {/* Network name with proper tooltip logic */}
            <Tooltip
              content={isLongName ? chain.name : null}
              childrenClassName="flex-1 min-w-0"
              placement="top"
            >
              <span className="font-medium text-brand-white group-hover:text-white group-hover:font-semibold truncate text-xs leading-tight text-left block w-full group-hover:drop-shadow-sm transition-all duration-300">
                {chain.name}
              </span>
            </Tooltip>

            {/* Chain ID badge */}
            <span className={NETWORK_BADGE_CLASS}>{chain.chainId}</span>
          </div>

          {/* Currency and RPC info - more compact */}
          <div className="flex items-center justify-start gap-1.5 text-xs text-brand-gray200 group-hover:text-brand-white/90 transition-colors duration-300">
            <span className="inline-flex items-center gap-1 font-medium text-left">
              <span className="text-content-secondary group-hover:text-white font-semibold text-xs">
                ${chain.nativeCurrency.symbol.toUpperCase()}
              </span>
              <span className="text-brand-gray200 group-hover:text-brand-white/50 text-xs">
                •
              </span>
              <span className="font-mono text-xs text-brand-gray300 group-hover:text-brand-white/80">
                {chain.rpc?.length || 0} {isSyscoinRpc ? 'Blockbook' : 'RPC'}
                {(chain.rpc?.length || 0) !== 1 ? 's' : ''}
              </span>
            </span>
          </div>
        </div>

        {/* Enhanced arrow indicator */}
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transform translate-x-1 group-hover:translate-x-0 transition-all duration-300 ease-out">
          <div className="w-2 h-2 border-r-2 border-t-2 border-brand-white/80 group-hover:border-white rotate-45 group-hover:drop-shadow-sm"></div>
        </div>
      </div>
    );
  };

  if (state?.isEditing && !currentNetwork) return null;

  return (
    <>
      <StatusModal
        status="error"
        title={t('buttons.error')}
        description={errorModalMessage}
        onClose={closeModal}
        show={showModal}
      />

      {/* RPC Testing Progress Indicator */}
      {testingRpcs && currentRpcTest && (
        <div className="mb-4 p-4 bg-alpha-whiteAlpha100 border border-alpha-whiteAlpha300 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-brand-blue100"></div>
            <div className="flex-1">
              <p className="text-sm font-medium text-white">
                {t('settings.testingRpcProgress', {
                  current: currentRpcTest.index,
                  total: currentRpcTest.total,
                })}
              </p>
              <p className="text-xs text-brand-gray200 truncate">
                {new URL(currentRpcTest.url).hostname}
              </p>
            </div>
          </div>
          <div className="w-full bg-alpha-whiteAlpha200 rounded-full h-2 mt-2">
            <div
              className="bg-brand-blue100 h-2 rounded-full transition-all duration-300"
              style={{
                width: `${
                  (currentRpcTest.index / currentRpcTest.total) * 100
                }%`,
              }}
            ></div>
          </div>
        </div>
      )}

      {state?.isEditing && currentNetwork && (
        <div className="mb-6 min-w-0 max-w-full">
          {/* Beautiful display for edit mode with animations - using fresh Redux data */}
          <div className="group custom-input-normal relative flex items-center gap-3 py-3 px-4 bg-alpha-whiteAlpha100 border border-alpha-whiteAlpha300 rounded-lg shadow-sm hover:shadow-lg transition-all duration-300 hover:border-brand-royalblue">
            <div className="relative">
              <ChainIcon
                chainId={currentNetwork.chainId || 0}
                size={32}
                networkKind={
                  currentNetwork.kind ||
                  (isSyscoinRpc ? INetworkType.Syscoin : INetworkType.Ethereum)
                }
                className="flex-shrink-0 ring-2 ring-alpha-whiteAlpha300 shadow-md rounded-full transform group-hover:scale-110 transition-transform duration-300"
              />
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse ring-2 ring-bkg-2"></div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white truncate text-xl group-hover:text-brand-royalbluemedium transition-colors duration-200">
                  {currentNetwork.label || t('settings.unknownNetwork')}
                </span>
                <span className={NETWORK_BADGE_CLASS}>
                  {currentNetwork.kind === INetworkType.Syscoin || isSyscoinRpc
                    ? currentNetwork.slip44 ?? currentNetwork.chainId
                    : currentNetwork.chainId}
                </span>
              </div>
              <div className="text-sm text-brand-gray200 mt-1 font-medium group-hover:text-white transition-colors duration-200 [overflow-wrap:anywhere]">
                {'$'}
                {(currentNetwork.currency || 'sys').toUpperCase()} •{' '}
                {t('settings.networkFamilyLabel', {
                  family:
                    currentNetwork.kind === INetworkType.Syscoin || isSyscoinRpc
                      ? 'UTXO'
                      : 'EVM',
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <Form
        form={form}
        key="custom-rpc-form"
        id="rpc"
        name="rpc"
        initialValues={initialValues}
        onFinish={onSubmit}
        onValuesChange={(_changed, values) => {
          invalidatePendingChecks();
          writeCustomRpcDraft(draftId, draftScope, draftEditor, {
            isSyscoinRpc,
            values,
          });
        }}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center text-center w-full"
      >
        {!state?.isEditing && (
          <>
            <Form.Item
              id="network-switch"
              name="network-switch"
              rules={[
                {
                  required: false,
                  message: '',
                },
              ]}
            >
              <div className="flex gap-x-2 mb-4 text-xs">
                <p className="text-brand-blue200 text-xs">EVM</p>
                <Tooltip
                  content={
                    state?.isEditing
                      ? 'Cannot change network type while editing'
                      : ''
                  }
                >
                  <Switch
                    checked={isSyscoinRpc}
                    onChange={(checked) => {
                      invalidatePendingChecks();
                      form.setFieldsValue({ apiUrl: '' });
                      setIsSyscoinRpc(checked);
                    }}
                    className="relative inline-flex items-center w-9 h-4 border border-white rounded-full"
                    disabled={state?.isEditing}
                  >
                    <span className="sr-only">
                      {t('settings.networkFamilyLabel', { family: 'Syscoin' })}
                    </span>
                    <span
                      className={`${switchBallStyle} inline-block w-2 h-2 transform rounded-full`}
                    />
                  </Switch>
                </Tooltip>

                <p className="text-brand-deepPink100 text-xs">UTXO</p>
              </div>
            </Form.Item>
            <Form.Item
              name="label"
              className="w-full"
              extra={t('settings.searchNetworksPlaceholder', {
                networkType: isSyscoinRpc ? 'UTXO' : 'EVM',
              })}
              hasFeedback={NETWORK_NAME_FEEDBACK}
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: t('settings.networkNameRequired'),
                },
              ]}
            >
              {/* Autocomplete input for both EVM and UTXO networks */}
              <NetworkNameControl
                dropdownRef={dropdownRef}
                onDropdownBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    closeSuggestions();
                }}
                role="combobox"
                aria-label={t('settings.label')}
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                aria-controls={suggestionsId}
                aria-activedescendant={activeSuggestionId}
                disabled={isInputDisableByEditMode}
                placeholder={t('settings.label')}
                className={NETWORK_INPUT_CLASS}
                onChange={(e) => {
                  invalidatePendingChecks();
                  const value = e.target.value;
                  setNetworkQuery(value);
                  setSuggestionsOpen(true);
                  setActiveSuggestion(-1);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || testingRpcs) return;
                  if (event.key === 'Escape') {
                    if (suggestionsOpen) {
                      event.preventDefault();
                      event.stopPropagation();
                      closeSuggestions();
                    }
                  } else if (
                    (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
                    networkSuggestions.length > 0
                  ) {
                    event.preventDefault();
                    setSuggestionsOpen(true);
                    const last = networkSuggestions.length - 1;
                    setActiveSuggestion((current) =>
                      event.key === 'ArrowDown'
                        ? !showSuggestions || current < 0 || current === last
                          ? 0
                          : current + 1
                        : !showSuggestions || current <= 0
                        ? last
                        : current - 1
                    );
                  } else if (event.key === 'Enter' && showSuggestions) {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleNetworkSelect(
                      networkSuggestions[
                        Math.min(
                          networkSuggestions.length - 1,
                          Math.max(0, activeSuggestion)
                        )
                      ]
                    );
                  } else if (event.key === 'Tab') {
                    closeSuggestions();
                  }
                }}
              >
                <div
                  id={suggestionsId}
                  role="listbox"
                  aria-label={t('settings.searchNetworksPlaceholder', {
                    networkType: isSyscoinRpc ? 'UTXO' : 'EVM',
                  })}
                  aria-hidden={!showSuggestions}
                  className={`absolute top-full left-0 right-0 z-50 mt-2 bg-brand-blue600 border border-brand-royalblue/30 rounded-xl shadow-2xl shadow-brand-blue600/40 max-h-80 overflow-hidden transition-all duration-300 ease-out backdrop-blur-sm ${
                    showSuggestions
                      ? 'opacity-100 visible transform scale-100'
                      : 'opacity-0 invisible pointer-events-none transform scale-95'
                  }`}
                  style={{
                    background:
                      'linear-gradient(145deg, #1E365C 0%, #162742 100%)',
                    boxShadow:
                      '0 20px 25px -5px rgba(30, 54, 92, 0.4), 0 10px 10px -5px rgba(30, 54, 92, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                  }}
                >
                  {/* Subtle top border accent */}
                  <div className="h-px bg-gradient-to-r from-transparent via-brand-royalblue to-transparent"></div>

                  <div className="overflow-y-auto max-h-80 scrollbar-styled">
                    {allChains.length === 0 ? (
                      <div className="p-6 text-center">
                        <div className="inline-flex items-center gap-3 text-brand-white/80">
                          <div className="animate-spin rounded-full h-5 w-5 border-2 border-brand-royalblue border-t-transparent"></div>
                          <span className="font-medium">
                            {t('settings.loadingNetworks', {
                              networkType: isSyscoinRpc ? 'UTXO' : 'EVM',
                            })}
                          </span>
                        </div>
                      </div>
                    ) : networkSuggestions.length === 0 ? (
                      <div className="p-4 text-center text-brand-white/60">
                        {t('settings.noMatchingNetworks')}
                      </div>
                    ) : (
                      networkSuggestions.map((chain, index) =>
                        renderNetworkSuggestion({
                          id: `${suggestionsId}-${index}`,
                          active: activeSuggestion === index,
                          chain,
                          onActivate: () => setActiveSuggestion(index),
                          onSelect: () => {
                            void handleNetworkSelect(chain);
                          },
                        })
                      )
                    )}
                  </div>

                  {/* Subtle bottom border accent */}
                  <div className="h-px bg-gradient-to-r from-transparent via-brand-royalblue/50 to-transparent"></div>
                </div>
              </NetworkNameControl>
            </Form.Item>
          </>
        )}

        {/* Existing valid names stay hidden; let users repair a blank saved name. */}
        {state?.isEditing && (
          <Form.Item
            name="label"
            className="w-full"
            style={{ display: needsLabelRepair ? undefined : 'none' }}
            rules={[
              {
                required: true,
                whitespace: true,
                message: t('settings.networkNameRequired'),
              },
            ]}
          >
            <Input
              type={needsLabelRepair ? 'text' : 'hidden'}
              placeholder={t('settings.label')}
              className={NETWORK_INPUT_CLASS}
            />
          </Form.Item>
        )}
        <Form.Item
          name="url"
          className="w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: t('settings.rpcUrlRequired'),
            },
            urlFormatRule,
          ]}
        >
          <Input
            ref={urlInputRef}
            placeholder={t(
              isSyscoinRpc
                ? 'settings.blockbookUrlPlaceholder'
                : 'settings.rpcUrlPlaceholder'
            )}
            className={NETWORK_INPUT_CLASS}
            onBlur={async (e) => {
              const url = e.target.value?.trim();
              if (url) {
                // Get current form values for validation
                const currentFormValues = form.getFieldsValue();
                // Validate RPC and auto-fill chainId
                await validateRpcUrlAndShowError(url, currentFormValues);
              }
            }}
          />
        </Form.Item>

        <Form.Item
          name="chainId"
          hasFeedback
          className="w-full"
          rules={[
            {
              required: !isSyscoinRpc && !state?.isEditing,
              message: t('settings.chainIdRequired'),
            },
            // Add validation for EVM chainId format
            ...(!isSyscoinRpc && !state?.isEditing
              ? [
                  {
                    validator: (_, value) => {
                      const text = String(value ?? '').trim();
                      if (!text) {
                        return Promise.resolve();
                      }
                      const chainId = Number(text);
                      if (
                        !/^\d+$/.test(text) ||
                        !Number.isSafeInteger(chainId) ||
                        chainId <= 0
                      ) {
                        return Promise.reject(
                          new Error(t('settings.positiveChainId'))
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]
              : []),
          ]}
        >
          <Input
            readOnly={isSyscoinRpc || state?.isEditing}
            placeholder={
              isSyscoinRpc
                ? t('settings.chainIdAutoDetectedUtxo')
                : state?.isEditing
                ? t('settings.chainIdCannotBeEdited')
                : t('settings.chainIdCustomEvm')
            }
            className={NETWORK_INPUT_CLASS}
            style={{
              cursor: isSyscoinRpc || state?.isEditing ? 'not-allowed' : 'text',
              backgroundColor:
                isSyscoinRpc || state?.isEditing
                  ? 'rgba(255,255,255,0.05)'
                  : 'transparent',
            }}
          />
        </Form.Item>
        <Form.Item
          name="symbol"
          hasFeedback
          className="w-full"
          rules={[
            {
              required: true,
              whitespace: true,
              message: t('settings.symbolRequired'),
            },
          ]}
        >
          <Input
            placeholder={t('settings.symbol')}
            className="custom-input-normal relative uppercase"
            onChange={(e) => {
              const upperValue = e.target.value.toUpperCase();
              form.setFieldsValue({ symbol: upperValue });
            }}
          />
        </Form.Item>
        <Form.Item
          hasFeedback
          className="w-full"
          name="explorer"
          rules={[
            {
              required: false,
              message: t('settings.explorerUrlRequired'),
            },
            urlFormatRule,
          ]}
        >
          <Input
            placeholder={t('settings.explorer')}
            className={NETWORK_INPUT_CLASS}
          />
        </Form.Item>
        {!isSyscoinRpc && (
          <div className="w-full">
            <div className="flex items-center gap-2 mb-2">
              <label className="text-sm text-white font-medium">
                {t('settings.blockExplorerApiUrl')}
              </label>
              <Tooltip content={t('send.apiKeyTooltip')} placement="top">
                <Icon
                  name="Info"
                  isSvg
                  size={14}
                  className="text-brand-gray200 hover:text-white cursor-default"
                />
              </Tooltip>
            </div>
            <Form.Item
              hasFeedback
              className="w-full mb-6"
              name="apiUrl"
              rules={[
                {
                  required: false,
                  message: '',
                },
                urlFormatRule,
              ]}
            >
              <Input
                placeholder="https://api.example.com/api"
                className={NETWORK_INPUT_CLASS}
              />
            </Form.Item>
          </div>
        )}
        {/* Fixed button container at bottom of viewport - inside form */}
        <ToastActionFooter className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50 min-h-[76px]">
          {state?.isEditing ? (
            <div className="flex gap-3 justify-center">
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  discardDraft();
                  navigateBack(navigate, location);
                }}
              >
                {t('buttons.cancel')}
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={loading || testingRpcs}
                loading={loading || testingRpcs}
              >
                {t('buttons.save')}
              </Button>
            </div>
          ) : (
            <div className="flex gap-3 justify-center">
              <Button
                variant="neutral"
                className="text-sm text-brand-royalblue"
                type="submit"
                disabled={loading || testingRpcs}
                loading={loading || testingRpcs}
                fullWidth
              >
                {t('buttons.save')}
              </Button>
            </div>
          )}
        </ToastActionFooter>

        {/* Add bottom padding to form content to account for fixed buttons */}
        <div className="pb-20"></div>
      </Form>
    </>
  );
};

export default CustomRPCView;
