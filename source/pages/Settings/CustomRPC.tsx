/* eslint-disable react/prop-types */
import { Switch } from '@headlessui/react';
import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import { debounce } from 'lodash';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { validateEthRpc, validateSysRpc } from '@pollum-io/sysweb3-network';

import { ChainIcon } from 'components/ChainIcon';
import { Button, Layout, Tooltip, Icon } from 'components/index';
import { StatusModal } from 'components/Modal/StatusModal';
import { RPCSuccessfullyAdded } from 'components/Modal/WarningBaseModal';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import ChainListService, {
  type ChainInfo,
} from 'scripts/Background/controllers/chainlist';
import { ICustomRpcParams } from 'types/transactions';

const CustomRPCView = () => {
  const { state }: { state: any } = useLocation();
  const { t } = useTranslation();
  const isSyscoinSelected = state && state.chain && state.chain === 'syscoin';
  const [loading, setLoading] = useState(false);
  const [isUrlValid, setIsUrlValid] = useState(false);
  const [addedRpc, setAddedRpc] = useState<boolean>(false);
  const [showModal, setShowModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState<string>('');
  const [isSyscoinRpc, setIsSyscoinRpc] = useState(Boolean(isSyscoinSelected));
  const [networkSuggestions, setNetworkSuggestions] = useState<ChainInfo[]>([]);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [testingRpcs, setTestingRpcs] = useState(false);
  const [allChains, setAllChains] = useState<ChainInfo[]>([]);
  const [currentRpcTest, setCurrentRpcTest] = useState<{
    index: number;
    total: number;
    url: string;
  } | null>(null);

  const { controllerEmitter } = useController();
  const { alert, navigate } = useUtils();

  const [form] = useForm();
  const urlInputRef = React.useRef<any>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const switchBallStyle = isSyscoinRpc
    ? 'translate-x-6 bg-brand-deepPink100'
    : 'translate-x-1  bg-brand-blue200';

  const inputHiddenOrNotStyle = isSyscoinRpc ? 'hidden' : 'relative';

  const modalMessageOnSuccessful = state
    ? t('settings.rpcSuccessfullyEdited')
    : t('settings.rpcSuccessfullyAdded');

  const populateForm = (field: string, value: number | string) => {
    if (!form.getFieldValue(field)) form.setFieldsValue({ [field]: value });
  };

  const validateUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const testBlockExplorerApi = async (apiUrl: string): Promise<boolean> => {
    try {
      // Test with a simple eth_blockNumber request
      const testUrl = new URL(apiUrl);
      testUrl.searchParams.set('module', 'proxy');
      testUrl.searchParams.set('action', 'eth_blockNumber');

      const response = await fetch(testUrl.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();

      // Check for Etherscan-style response
      if (data.status === '1' && data.result) {
        return true;
      }

      // Check for Blockscout-style response (sometimes different format)
      if (data.result || data.jsonrpc) {
        return true;
      }

      return false;
    } catch (error) {
      console.log('API test failed:', error);
      return false;
    }
  };

  const closeModal = () => {
    setShowModal(false);
  };

  const onSubmit = async (data: ICustomRpcParams) => {
    setLoading(true);

    const customRpc = {
      ...data,
      isSyscoinRpc,
    };

    try {
      if (!state) {
        await controllerEmitter(['wallet', 'addCustomRpc'], [customRpc]);
        setLoading(false);
        setAddedRpc(true);
        return;
      }

      await controllerEmitter(
        ['wallet', 'editCustomRpc'],
        [customRpc, state.selected]
      );
      setLoading(false);
      setAddedRpc(true);
    } catch (error: any) {
      alert.removeAll();
      setAddedRpc(false);
      setShowModal(true);
      setLoading(false);
      setErrorModalMessage(error.message);
    }
  };

  const initialValues = {
    label: (state && state.selected && state.selected.label) ?? '',
    url: (state && state.selected && state.selected.url) ?? '',
    chainId: (state && state.selected && state.selected.chainId) ?? '',
    symbol:
      (state && state.selected && state.selected.currency
        ? state.selected.currency.toUpperCase()
        : '') ?? '',
    explorer: (state && state.selected && state.selected.explorer) ?? '',
    apiUrl: (state && state.selected && state.selected.apiUrl) ?? '',
  };

  const isInputDisableByEditMode = state ? state.isDefault : false;

  const isInputDisabled = Boolean(
    !form.getFieldValue('url') ||
      isUrlValid ||
      (state && state.selected && state.selected.chainId)
  );

  // Load and cache chain data once on component mount
  useEffect(() => {
    // Multi-level caching strategy:
    // 1. ChainListService singleton (initialized by MainController on startup)
    //    - Browser storage cache (24h persistence)
    //    - In-memory cache with request deduplication
    //    - Background fetching for stale cache
    // 2. Component-level caching (this state)
    //    - Eliminates async call overhead during search
    //    - Pure JavaScript filtering for instant results
    const loadChainData = async () => {
      try {
        const chainListService = ChainListService.getInstance();
        // Since MainController already initializes this service, the data should be readily available
        const chains = await chainListService.getChainData();
        setAllChains(chains);
        console.log(
          `[CustomRPC] Loaded ${chains.length} chains from ChainListService`
        );
      } catch (error) {
        console.error('[CustomRPC] Failed to load chain data:', error);
        // Still allow the component to work even if chain data fails
        setAllChains([]);
      }
    };

    loadChainData();
  }, []);

  // Handle clicks outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setNetworkSuggestions([]);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleConnect = async (data: ICustomRpcParams) => {
    controllerEmitter(['wallet', 'setActiveNetwork'], [data]).then(() => {
      navigate('/home');
    });
  };

  // Smart network search with auto-completion - now uses cached data
  const searchNetworks = debounce(async (query: string) => {
    if (!query || !query.trim() || isSyscoinRpc) {
      setNetworkSuggestions([]);
      return;
    }

    // Don't search if query is too short
    if (query.trim().length < 2) {
      setNetworkSuggestions([]);
      return;
    }

    // Early return if no chains loaded yet
    if (allChains.length === 0) {
      setNetworkLoading(true);
      return;
    }

    setNetworkLoading(true);

    try {
      const lowerQuery = query.toLowerCase().trim();
      const results: (ChainInfo & { score?: number })[] = [];

      allChains.forEach((chain) => {
        let score = 0;
        const name = chain.name.toLowerCase();
        const symbol = chain.nativeCurrency.symbol.toLowerCase();
        const chainId = chain.chainId.toString();

        // Scoring for relevance
        if (name === lowerQuery) score += 100;
        else if (name.startsWith(lowerQuery)) score += 50;
        else if (name.includes(lowerQuery)) score += 25;

        if (symbol === lowerQuery) score += 80;
        else if (symbol.startsWith(lowerQuery)) score += 40;

        if (chainId === lowerQuery) score += 90;
        else if (chainId.startsWith(lowerQuery)) score += 45;

        // Filter out testnets
        const isTestnet =
          name.includes('test') ||
          name.includes('goerli') ||
          name.includes('sepolia') ||
          name.includes('tanenbaum') ||
          name.includes('rinkeby') ||
          name.includes('ropsten') ||
          name.includes('kovan');
        if (isTestnet) score = 0;

        if (score > 0 && chain.rpc && chain.rpc.length > 0) {
          results.push({ ...chain, score });
        }
      });

      // Sort by score and take top 6 for better UI
      const sortedResults = results
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 6);

      setNetworkSuggestions(sortedResults);
    } catch (error) {
      console.error('Network search failed:', error);
      setNetworkSuggestions([]);
    } finally {
      setNetworkLoading(false);
    }
  }, 10);

  // Handle network selection from autocomplete
  const handleNetworkSelect = async (value: string, option: any) => {
    const selectedChain = option.chain;
    if (!selectedChain) return;

    // Clear suggestions immediately to close dropdown
    setNetworkSuggestions([]);

    // Fill form fields immediately for instant UX with uppercase symbol
    form.setFieldsValue({
      label: selectedChain.name,
      chainId: selectedChain.chainId.toString(),
      symbol: selectedChain.nativeCurrency.symbol.toUpperCase(),
      explorer:
        selectedChain.explorers && selectedChain.explorers.length > 0
          ? selectedChain.explorers[0].url
          : '',
    });

    // Reset URL field before testing
    form.setFieldsValue({ url: '' });

    setCurrentRpcTest({
      index: 0,
      total: 0,
      url: '',
    });

    // Try RPCs in order until we find one that works
    await tryBestWorkingRpc(selectedChain);
  };

  // Try multiple RPCs until we find one that works
  const tryBestWorkingRpc = async (chain: ChainInfo) => {
    if (!chain.rpc || chain.rpc.length === 0) return;

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

    // Try each RPC until we find one that works
    for (let i = 0; i < orderedRpcs.length; i++) {
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

        // Validate the RPC with timeout
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('RPC timeout')), 5000)
        );

        const validationPromise = validateEthRpc(rpc.url, false);
        const { valid } = (await Promise.race([
          validationPromise,
          timeoutPromise,
        ])) as any;

        if (valid) {
          // Found a working RPC, set it and break
          setTestingRpcs(false);
          setCurrentRpcTest(null);

          // Clear any existing toasts first to prevent conflicts
          alert.removeAll();

          // Create stable success message
          const hostname = rpc.url ? new URL(rpc.url).hostname : 'RPC server';
          const successMessage = `Connected to ${chain.name} via ${hostname}`;

          // Success feedback with stable message
          alert.success(successMessage);

          return;
        }
      } catch (error) {
        // This RPC failed, continue to next one
        console.log(`RPC ${rpc.url} failed:`, error);
        continue;
      }
    }

    // If we get here, no RPC worked
    setTestingRpcs(false);
    setCurrentRpcTest(null);
    alert.error(
      `Unable to connect to ${chain.name}. Please try a custom RPC URL.`
    );
  };

  // Custom icon component for autocomplete with proper caching
  const AutoCompleteIcon: React.FC<{ chain: ChainInfo; size?: number }> =
    React.memo(
      ({ chain, size = 24 }) => (
        <ChainIcon
          chainId={chain.chainId}
          size={size}
          networkKind="evm"
          iconName={chain.icon || chain.chainSlug}
          className="flex-shrink-0"
        />
      ),
      (prevProps, nextProps) =>
        prevProps.chain.chainId === nextProps.chain.chainId &&
        prevProps.size === nextProps.size
    );
  AutoCompleteIcon.displayName = 'AutoCompleteIcon';

  // Memoize the suggestion item to prevent unnecessary re-renders
  const NetworkSuggestionItem = React.memo<{
    chain: ChainInfo;
    onSelect: () => void;
  }>(
    ({ chain, onSelect }) => (
      <div
        className="flex items-center gap-3 py-3 px-4 hover:bg-gray-700 cursor-pointer transition-colors duration-150 border-b border-gray-700 last:border-b-0"
        onMouseDown={(e) => {
          e.preventDefault(); // Prevent blur from firing first
          onSelect();
        }}
      >
        <div className="flex-shrink-0">
          <AutoCompleteIcon chain={chain} size={28} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-white truncate text-sm">
              {chain.name}
            </span>
            <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full font-mono font-medium">
              {chain.chainId}
            </span>
          </div>
          <div className="text-xs text-gray-300">
            ${chain.nativeCurrency.symbol.toUpperCase()} •{' '}
            {chain.rpc?.length || 0} RPC
            {(chain.rpc?.length || 0) !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    ),
    (prevProps, nextProps) =>
      prevProps.chain.chainId === nextProps.chain.chainId
  );
  NetworkSuggestionItem.displayName = 'NetworkSuggestionItem';

  return (
    <Layout
      title={
        state?.isEditing ? `${t('buttons.edit')} RPC` : t('settings.customRpc')
      }
    >
      <RPCSuccessfullyAdded
        show={addedRpc}
        title={t('titles.congratulations')}
        phraseOne={modalMessageOnSuccessful}
        onClose={() => navigate('/settings/networks/edit')}
      />
      <StatusModal
        status="error"
        title="Erro"
        description={errorModalMessage}
        onClose={closeModal}
        show={showModal}
      />

      {/* RPC Testing Progress Indicator */}
      {testingRpcs && currentRpcTest && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900">
                Testing RPC {currentRpcTest.index} of {currentRpcTest.total}
              </p>
              <p className="text-xs text-blue-700 truncate">
                {new URL(currentRpcTest.url).hostname}
              </p>
            </div>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2 mt-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{
                width: `${
                  (currentRpcTest.index / currentRpcTest.total) * 100
                }%`,
              }}
            ></div>
          </div>
        </div>
      )}

      {state?.isEditing && (
        <div className="mb-6">
          {/* Beautiful display for edit mode with animations */}
          <div className="group custom-input-normal relative flex items-center gap-3 py-3 px-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg shadow-sm hover:shadow-lg transition-all duration-300 hover:border-blue-300">
            <div className="relative">
              <ChainIcon
                chainId={state?.selected?.chainId || 0}
                size={32}
                networkKind={
                  state?.selected?.kind || (isSyscoinRpc ? 'utxo' : 'evm')
                }
                className="flex-shrink-0 ring-2 ring-white shadow-md rounded-full transform group-hover:scale-110 transition-transform duration-300"
              />
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse ring-2 ring-white"></div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 truncate text-xl group-hover:text-blue-600 transition-colors duration-200">
                  {state?.selected?.label || 'Unknown Network'}
                </span>
                <span className="text-sm bg-blue-500 text-white px-3 py-1 rounded-full font-mono font-semibold shadow-sm transform group-hover:scale-105 group-hover:bg-blue-600 transition-all duration-200">
                  {state?.selected?.kind === 'utxo' || isSyscoinRpc
                    ? state?.selected?.slip44 || state?.selected?.chainId
                    : state?.selected?.chainId}
                </span>
              </div>
              <div className="text-sm text-gray-700 mt-1 font-medium group-hover:text-gray-900 transition-colors duration-200">
                $
                {(
                  state?.selected?.currency || (isSyscoinRpc ? 'SYS' : 'ETH')
                ).toUpperCase()}{' '}
                •{' '}
                {state?.selected?.kind === 'utxo' || isSyscoinRpc
                  ? 'UTXO Network'
                  : 'EVM Network'}
              </div>
            </div>
          </div>
        </div>
      )}

      <Form
        form={form}
        key="custom-rpc-form"
        validateMessages={{ default: '' }}
        id="rpc"
        name="rpc"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={initialValues}
        onFinish={state?.isEditing ? handleConnect : onSubmit}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center text-center"
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
                    state?.selected
                      ? 'Cant change type of network while editing'
                      : ''
                  }
                >
                  <Switch
                    checked={isSyscoinRpc}
                    onChange={(checked) => setIsSyscoinRpc(checked)}
                    className="relative inline-flex items-center w-9 h-4 border border-white rounded-full"
                    disabled={!!state?.selected}
                  >
                    <span className="sr-only">Syscoin Network</span>
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
              className="md:w-full"
              hasFeedback
              rules={[
                {
                  required: !isSyscoinRpc,
                  message: '',
                },
              ]}
            >
              {/* Always render both inputs, hide with CSS to prevent hook order changes */}
              <div className={!isSyscoinRpc ? 'block' : 'hidden'}>
                <div className="relative w-full" ref={dropdownRef}>
                  <Input
                    type="text"
                    disabled={isInputDisableByEditMode}
                    placeholder={`${t(
                      'settings.label'
                    )} - Start typing to search networks`}
                    className="custom-input-normal relative"
                    onChange={(e) => {
                      const value = e.target.value;
                      form.setFieldsValue({ label: value });
                      searchNetworks(value);
                    }}
                    value={form.getFieldValue('label')}
                  />
                  <div
                    className={`absolute top-full left-0 right-0 z-50 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl max-h-80 overflow-y-auto transition-all duration-200 ${
                      networkSuggestions.length > 0 && !testingRpcs
                        ? 'opacity-100 visible'
                        : 'opacity-0 invisible pointer-events-none'
                    }`}
                  >
                    {networkLoading ? (
                      <div className="p-4 text-center text-gray-400">
                        Searching networks...
                      </div>
                    ) : (
                      networkSuggestions.map((chain) => (
                        <NetworkSuggestionItem
                          key={`network-${chain.chainId}`}
                          chain={chain}
                          onSelect={() => {
                            setNetworkSuggestions([]); // Close immediately
                            handleNetworkSelect(chain.name, { chain });
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className={isSyscoinRpc ? 'block' : 'hidden'}>
                <Input
                  type="text"
                  disabled={isInputDisableByEditMode}
                  placeholder={`${t('settings.label')}`}
                  className="custom-input-normal relative"
                />
              </div>
            </Form.Item>
          </>
        )}
        <Form.Item
          name="url"
          className="md:w-full"
          hasFeedback
          validateTrigger="onBlur"
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              async validator(_, value) {
                // Don't validate empty values - let required rule handle that
                if (!value) {
                  return Promise.resolve();
                }

                // If we're editing and the value hasn't changed from the initial value, skip validation
                if (state?.selected && value === state?.selected?.url) {
                  return Promise.resolve();
                }

                if (isSyscoinRpc) {
                  const trezorIoRegExp = /trezor\.io/;
                  if (trezorIoRegExp.test(value)) {
                    alert.warning(t('settings.trezorSiteWarning'));
                    return Promise.reject();
                  }
                  const { valid, coin } = await validateSysRpc(value);

                  if (valid) {
                    populateForm('label', String(coin));
                    return Promise.resolve();
                  }

                  console.log('UTXO validation failed');
                  return Promise.reject();
                }

                try {
                  const { valid, details, hexChainId } = await validateEthRpc(
                    value,
                    false
                  );

                  setIsUrlValid(valid);

                  // If validation failed, reject
                  if (!valid) {
                    return Promise.reject(
                      new Error('Invalid RPC URL - cannot connect')
                    );
                  }

                  // Additional check: try to make a test request to ensure RPC is actually working
                  try {
                    const testResponse = await fetch(value, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'eth_blockNumber',
                        params: [],
                        id: 1,
                      }),
                      signal: AbortSignal.timeout(5000), // 5 second timeout
                    });

                    if (!testResponse.ok) {
                      throw new Error(`HTTP ${testResponse.status}`);
                    }

                    const testData = await testResponse.json();
                    if (testData.error) {
                      throw new Error(`RPC Error: ${testData.error.message}`);
                    }

                    // If we get here, RPC is working
                  } catch (rpcTestError) {
                    console.warn(
                      'RPC functionality test failed:',
                      rpcTestError
                    );
                    return Promise.reject(
                      new Error(
                        'RPC URL responds but may not be fully functional'
                      )
                    );
                  }

                  // In edit mode, verify the chainId matches
                  if (state?.selected) {
                    const stateChainId = state.selected.chainId;
                    const rpcChainId =
                      details?.chainId ||
                      Number(String(parseInt(hexChainId, 16)));

                    if (stateChainId === rpcChainId) {
                      return Promise.resolve();
                    } else {
                      return Promise.reject(
                        new Error('Network mismatch - chainId does not match')
                      );
                    }
                  }

                  // In add mode, populate fields if we got details
                  if (details) {
                    populateForm('label', String(details.name));
                    populateForm('chainId', String(details.chainId));
                  } else if (hexChainId) {
                    const chainIdConverted = String(parseInt(hexChainId, 16));
                    populateForm('chainId', chainIdConverted);
                  }

                  return Promise.resolve();
                } catch (error) {
                  setIsUrlValid(false);
                  return Promise.reject(
                    new Error(error?.message || 'Failed to validate RPC URL')
                  );
                }
              },
            }),
          ]}
        >
          <Input
            ref={urlInputRef}
            type="text"
            placeholder={`${isSyscoinRpc ? 'Explorer' : 'RPC URL'}`}
            className="custom-input-normal relative"
          />
        </Form.Item>

        <Form.Item
          name="chainId"
          hasFeedback
          className="md:w-full"
          rules={[
            {
              required: !isSyscoinRpc,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            disabled={isInputDisabled}
            placeholder="Chain ID"
            className={`${inputHiddenOrNotStyle} custom-input-normal `}
          />
        </Form.Item>
        <Form.Item
          name="symbol"
          hasFeedback
          className="md:w-full"
          rules={[
            {
              required: !isSyscoinRpc,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            placeholder={t('settings.symbol')}
            className={`${inputHiddenOrNotStyle} custom-input-normal relative uppercase`}
          />
        </Form.Item>
        <Form.Item
          hasFeedback
          className="md:w-full"
          name="explorer"
          rules={[
            {
              required: false,
              message: '',
            },
            () => ({
              validator(_, value) {
                if (!value || value.trim() === '') {
                  return Promise.resolve();
                }
                if (validateUrl(value.trim())) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('Please enter a valid URL'));
              },
            }),
          ]}
        >
          <Input
            type="text"
            placeholder={t('settings.explorer')}
            className={`${inputHiddenOrNotStyle} custom-input-normal `}
          />
        </Form.Item>
        <div className="md:w-full">
          <div className="flex items-center gap-2 mb-2">
            <label className="text-sm text-white font-medium">
              Block Explorer API URL (optional)
            </label>
            <Tooltip
              content="Include your API key in the URL if needed (e.g., https://api.etherscan.io/api?apikey=YOUR_KEY). This enables enhanced transaction details and history."
              placement="top"
            >
              <Icon
                name="Info"
                isSvg
                size={14}
                className="text-brand-gray200 hover:text-white cursor-pointer"
              />
            </Tooltip>
          </div>
          <Form.Item
            hasFeedback
            className="md:w-full mb-0"
            name="apiUrl"
            rules={[
              {
                required: false,
                message: '',
              },
              () => ({
                async validator(_, value) {
                  if (!value || value.trim() === '') {
                    return Promise.resolve();
                  }

                  const trimmedValue = value.trim();

                  // First check if it's a valid URL
                  if (!validateUrl(trimmedValue)) {
                    return Promise.reject(
                      new Error('Please enter a valid URL')
                    );
                  }

                  // Then test if it's a working Etherscan/Blockscout API
                  try {
                    const isValidApi = await testBlockExplorerApi(trimmedValue);
                    if (!isValidApi) {
                      return Promise.reject(
                        new Error(
                          'API does not respond correctly. Please check the URL and ensure it supports Etherscan/Blockscout API format.'
                        )
                      );
                    }
                    return Promise.resolve();
                  } catch (error) {
                    return Promise.reject(
                      new Error(
                        'Unable to validate API. Please check your connection and try again.'
                      )
                    );
                  }
                },
              }),
            ]}
          >
            <Input
              type="text"
              placeholder="https://api.example.com/api"
              className="custom-input-normal relative"
            />
          </Form.Item>
        </div>
        <div className="absolute bottom-10 left-0 right-0 px-4 md:static md:px-0">
          {state?.isEditing ? (
            <div className="flex gap-6 justify-center">
              <Button
                type="button"
                className="bg-transparent rounded-[100px] w-[10.25rem] h-[40px] text-white text-base font-medium border border-white"
                onClick={() => navigate('/chain-fail-to-connect')}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-white rounded-[100px] w-[10.25rem] h-[40px] text-brand-blue400 text-base font-medium"
              >
                Connect
              </Button>
            </div>
          ) : (
            <Button
              className="xl:p-18 h-[40px] w-[352px] flex items-center justify-center text-brand-blue400 text-base bg-white hover:opacity-60 rounded-[100px] transition-all duration-300 xl:flex-none"
              type="submit"
              loading={loading}
            >
              {t('buttons.save')}
            </Button>
          )}
        </div>
      </Form>
    </Layout>
  );
};

export default CustomRPCView;
