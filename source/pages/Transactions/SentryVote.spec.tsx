/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import english from 'assets/locales/en.json';

import SentryVote from './SentryVote';

const mockEmitter = jest.fn();
const mockDispatch = jest.fn();
const mockQuery = {
  sentryApprovalId: 'vote-one',
  host: 'https://sysnode.test',
  eventName: 'sentryVoteSigned',
};
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) =>
      String(
        key.split('.').reduce((value: any, part) => value?.[part], english) ||
          key
      ).replace('{{count}}', options?.count ?? ''),
  }),
}));
jest.mock('hooks/index', () => ({ useQueryData: () => mockQuery }));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: true,
    connectionUnavailable: false,
  }),
}));
jest.mock('utils/browser', () => ({
  dispatchBackgroundEvent: (...args: unknown[]) => mockDispatch(...args),
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  PageActionFooter: ({ children, error }: any) => (
    <div>
      {error && <p role="alert">{error}</p>}
      {children}
    </div>
  ),
  Button: ({ children, loading, ...props }: any) => (
    <button {...props} aria-busy={loading}>
      {children}
    </button>
  ),
}));

const chain = { genesisHash: '11'.repeat(32), era: 'legacy-v3' };
const request = {
  version: 1,
  chain,
  proposalHash: '22'.repeat(32),
  signal: 'funding',
  outcome: 'no',
  timestamp: 1792252800,
  nodes: [
    {
      proTxHash: '33'.repeat(32),
      collateralOutpoint: { txid: '44'.repeat(32), vout: 1 },
    },
  ],
};
const approval = {
  id: 'vote-one',
  request,
  origin: 'https://sysnode.test',
  network: 'testnet',
  serviceUrl: 'https://trusted.test',
  proposal: { name: 'Roadmap proposal', url: 'https://proposal.test' },
  nodes: [
    { ...request.nodes[0], keyId: 'voting-key', keyLabel: 'My voting key' },
  ],
};
const response = {
  version: 1,
  ...request,
  votes: [{ ...request.nodes[0], voteSig: 'c2lnbmF0dXJl' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.sentryApprovalId = 'vote-one';
  mockEmitter.mockImplementation(async (methods) =>
    methods[1] === 'getSentryVoteApproval' ? approval : response
  );
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});

it('shows the exact funding decision and keeps advanced fields available', async () => {
  render(<SentryVote />);
  await screen.findByText('Roadmap proposal');
  expect(screen.getByText('No · Funding vote')).toBeVisible();
  expect(screen.getByText('testnet · Nodes selected: 1')).toBeVisible();
  const details = screen
    .getByText('Review nodes and vote details')
    .closest('details')!;
  expect(details.open).toBe(false);
  fireEvent.click(screen.getByText('Review nodes and vote details'));
  expect(screen.getByText(request.proposalHash)).toBeInTheDocument();
  expect(screen.getByText('My voting key')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign votes' })).toBeDisabled();
});

it('emits only a matching authorized vote result after password approval', async () => {
  render(<SentryVote />);
  await screen.findByText('Roadmap proposal');
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'test-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign votes' }));
  await waitFor(() =>
    expect(mockDispatch).toHaveBeenCalledWith(
      'sentryVoteSigned.https://sysnode.test',
      response
    )
  );
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'signSentryVoteApproval'],
    [{ id: 'vote-one', password: 'test-password' }],
    180000,
    false
  );
  expect(window.close).toHaveBeenCalled();
});

it.each([
  { success: false, error: '' },
  { ...response, outcome: 'yes' },
  { ...response, chain: { ...chain, genesisHash: 'ff'.repeat(32) } },
  { ...response, votes: [] },
])(
  'does not report malformed or mismatched background results as successful',
  async (invalid) => {
    mockEmitter.mockImplementation(async (methods) =>
      methods[1] === 'getSentryVoteApproval' ? approval : invalid
    );
    render(<SentryVote />);
    await screen.findByText('Roadmap proposal');
    fireEvent.change(screen.getByLabelText('Wallet password'), {
      target: { value: 'test-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign votes' }));
    await screen.findByRole('alert');
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Wallet password')).toHaveValue('');
  }
);

it('cancels without signing', async () => {
  render(<SentryVote />);
  await screen.findByText('Roadmap proposal');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'cancelSentryVoteApproval'],
      ['vote-one']
    )
  );
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(
    mockEmitter.mock.calls.some(
      ([methods]) => methods[1] === 'signSentryVoteApproval'
    )
  ).toBe(false);
});

it('does not emit a late signature after the approval page changes', async () => {
  let finish!: (value: unknown) => void;
  mockEmitter.mockImplementation(async (methods) =>
    methods[1] === 'getSentryVoteApproval'
      ? approval
      : new Promise((resolve) => {
          finish = resolve;
        })
  );
  const view = render(<SentryVote />);
  await screen.findByText('Roadmap proposal');
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'test-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign votes' }));
  await waitFor(() => expect(finish).toBeDefined());
  view.unmount();
  finish(response);
  await Promise.resolve();
  expect(mockDispatch).not.toHaveBeenCalled();
});
