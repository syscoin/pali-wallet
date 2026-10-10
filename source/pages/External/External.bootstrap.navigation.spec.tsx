/** @jest-environment jsdom */
import {
  clearNavigationState,
  clearTransactionNavigationState,
} from 'utils/navigationState';

const mockRender = jest.fn();
const mockRemove = jest.fn();
let mockState: any;
let mockSnapshot: any;

jest.mock('react-dom/client', () => ({
  createRoot: () => ({ render: mockRender }),
}));
jest.mock('react-redux', () => ({ Provider: 'provider' }));
jest.mock('react-toastify', () => ({ ToastContainer: () => null }));
jest.mock('components/AntdProvider', () => ({ AntdProvider: 'antd-provider' }));
jest.mock('components/WalletBootstrap/WalletBootstrap', () => ({
  WalletBootstrap: 'wallet-bootstrap',
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('utils/approvalClient', () => ({ connectApprovalClient: jest.fn() }));
jest.mock('utils/requestWalletState', () => ({
  startupFeedbackDelay: () => 1800,
}));
jest.mock('utils/i18n', () => ({}));
jest.mock('assets/styles/index.css', () => ({}));
jest.mock('assets/styles/antd-overrides.css', () => ({}));
jest.mock('assets/styles/custom-checkbox.css', () => ({}));
jest.mock('assets/fonts/index.css', () => ({}));
jest.mock('./External', () => ({ __esModule: true, default: 'external-app' }));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn(() => mockRemove('pali_navigation_state')),
  clearTransactionNavigationState: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockState = { vault: {}, vaultGlobal: {} }; // External bootstrap precedes hydration.
  document.body.innerHTML = '<div id="external-root"></div>';
  mockRemove.mockImplementation(() => {
    mockSnapshot = null;
  });
  chrome.storage.local.remove = mockRemove;
});

it.each(['/settings/account/smart-account-policy', '/home?tab=assets'])(
  'does not erase the main popup %s snapshot when an approval document boots before hydration',
  (path) => {
    mockSnapshot = {
      currentPath: path,
      state: { trustedSitesSearch: 'caller' },
    };
    jest.isolateModules(() => {
      require('./index');
    });
    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(clearNavigationState).not.toHaveBeenCalled();
    expect(clearTransactionNavigationState).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockSnapshot.currentPath).toBe(path);
  }
);
