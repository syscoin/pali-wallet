/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';

import { projectLocale } from '../../config/loaders/localeProjection';

import PrivateArchivedNotes from './PrivateArchivedNotes';
import PrivateVaultClearCompleted from './PrivateVaultClearCompleted';

let mockTranslate: (key: string, options?: any) => string = (key) => key;
const mockClearError = jest.fn();
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: { error: mockClearError } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
beforeEach(() => {
  mockTranslate = (key: string) => key;
});
jest.mock('antd', () => {
  const Form = ({ children }: any) => <div>{children}</div>;
  Form.useForm = () => [{ resetFields: jest.fn() }];
  return { Form };
});
jest.mock('components/Icon', () => ({
  Icon: ({ name }: any) => <span data-icon={name} />,
}));
jest.mock('hooks/useController', () => ({ useController: () => ({}) }));
jest.mock('components/Input/ValidatedPasswordInput', () => ({
  ValidatedPasswordInput: ({ onValidate, onValidationSuccess }: any) => (
    <button
      type="button"
      onClick={() => {
        void onValidate('existing-wallet-password')
          .then(onValidationSuccess)
          .catch(() => undefined);
      }}
    >
      Authorize
    </button>
  ),
}));
const notes = Array.from({ length: 41 }, (_, index) => ({
  id: `note-${index}`,
  poolId: 'eth-1',
  amount: '1',
  createdAt: 1000 + index,
  archivedAt: 2000 + index,
}));
const inventory = (values = notes) => ({
  limit: 512,
  bundleLimitBytes: 4194304,
  storedBytes: 1234,
  notes: values,
});
function fixture(initial = notes) {
  let rows = initial;
  const emit = jest.fn(async ([, method], values) => {
    if (method === 'getArchivedNotes') return inventory(rows);
    if (method === 'restoreArchivedNote') {
      rows = rows.filter((note) => note.id !== values[0]);
      return undefined;
    }
    if (method === 'clearArchive') {
      const removed = rows.length;
      rows = [];
      return { removed };
    }
    throw Error('Unexpected archive operation');
  });
  const props = {
    controllerEmitter: emit,
    revision: 0,
    onCount: jest.fn(),
    onRestored: jest.fn(),
    onReveal: jest.fn(),
    onExport: jest.fn(),
  };
  const view = render(<PrivateArchivedNotes {...props} />);
  const open = async () => {
    fireEvent.click(
      screen.getByRole('button', { name: /^privacy.archive.title/ })
    );
    await waitFor(() =>
      expect(props.onCount).toHaveBeenCalledWith(initial.length)
    );
  };
  return { emit, props, view, open };
}

it.each(['en', 'es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru'])(
  '%s translates archive amount and pagination from base plus lazy Privacy resources',
  async (language) => {
    const resource = jest.requireActual(
      `../../assets/locales/${language}.json`
    );
    const base = projectLocale(resource, 'base');
    const privacy = projectLocale(resource, 'privacy');
    const instance = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: false,
      initImmediate: false,
      resources: {
        [language]: {
          translation: {
            ...base,
            privacy: { ...base.privacy, ...privacy.privacy },
          },
        },
      },
    });
    mockTranslate = (key, options) => String(instance.t(key, options));
    const f = fixture();
    fireEvent.click(
      screen.getByRole('button', { name: resource.privacy.archive.title })
    );
    await waitFor(() => expect(f.props.onCount).toHaveBeenCalledWith(41));
    const expectedAmount =
      resource.mobile.noteFlows.inventory.poolAmount.replace('{{amount}}', '1');
    expect(
      screen.getAllByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent?.startsWith(expectedAmount) === true
      )
    ).toHaveLength(20);
    const previous = screen.getByRole('button', {
      name: resource.mobile.noteFlows.inventory.previous,
    });
    expect(previous).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: resource.buttons.next })
    );
    expect(previous).not.toBeDisabled();
    expect(f.view.container.textContent).not.toMatch(
      /(?:mobile|privacy|buttons)\./
    );
    expect(f.emit).toHaveBeenCalledTimes(1);
  }
);

it('keeps archive separate, pages a local bounded list, and reuses reveal/export without spending or status reads', async () => {
  const f = fixture();
  await f.open();
  expect(
    screen.getAllByRole('button', { name: 'privacy.archive.restore' })
  ).toHaveLength(20);
  fireEvent.click(
    screen.getAllByRole('button', { name: 'privacy.revealNote' })[0]
  );
  expect(f.props.onReveal).toHaveBeenCalledWith('note-0');
  fireEvent.click(
    screen.getByRole('button', { name: 'privacy.bundle.exportTitle' })
  );
  expect(f.props.onExport).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
  fireEvent.click(
    screen.getAllByRole('button', { name: 'privacy.revealNote' })[0]
  );
  expect(f.props.onReveal).toHaveBeenLastCalledWith('note-20');
  expect(f.emit).toHaveBeenCalledTimes(1);
  expect(f.emit).toHaveBeenCalledWith(
    ['privateVault', 'getArchivedNotes'],
    [],
    10000,
    false
  );
});

it('waits for an archive refresh before opening restore and then accepts the refreshed row', async () => {
  const rows = notes.slice(0, 2);
  const f = fixture(rows);
  await f.open();
  let finish!: (value: ReturnType<typeof inventory>) => void;
  const pending = new Promise<ReturnType<typeof inventory>>((resolve) => {
    finish = resolve;
  });
  f.emit.mockImplementationOnce(() => pending);
  fireEvent.click(screen.getByRole('button', { name: 'privacy.refresh' }));
  const restore = () =>
    screen.getAllByRole('button', { name: 'privacy.archive.restore' });
  expect(restore()[0]).toBeDisabled();
  fireEvent.click(restore()[0]);
  expect(screen.queryByRole('button', { name: 'Authorize' })).toBeNull();
  await act(async () => {
    finish(inventory(rows.slice(1)));
    await pending;
  });
  expect(restore()).toHaveLength(1);
  fireEvent.click(restore()[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
  await waitFor(() => expect(f.props.onRestored).toHaveBeenCalledTimes(1));
  expect(f.emit).toHaveBeenCalledWith(
    ['privateVault', 'restoreArchivedNote'],
    ['note-1', 'existing-wallet-password'],
    30000,
    false
  );
});

it('keeps a revision-triggered archive read live when the confirmation is cancelled', async () => {
  const rows = notes.slice(0, 2);
  const f = fixture(rows);
  await f.open();
  fireEvent.click(
    screen.getByRole('button', { name: 'privacy.archive.clear' })
  );
  let finish!: (value: ReturnType<typeof inventory>) => void;
  f.emit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  f.view.rerender(<PrivateArchivedNotes {...f.props} revision={1} />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  await act(async () => {
    finish(inventory(rows.slice(1)));
  });
  expect(f.props.onCount).toHaveBeenLastCalledWith(1);
  expect(screen.getByRole('button', { name: 'privacy.refresh' })).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'privacy.archive.restore' })
  ).toBeEnabled();
});

it('keeps an authorized restore live when the parent requests another inventory read', async () => {
  const rows = notes.slice(0, 1);
  const f = fixture(rows);
  await f.open();
  fireEvent.click(
    screen.getByRole('button', { name: 'privacy.archive.restore' })
  );
  let finishRestore!: () => void;
  f.emit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRestore = () => resolve(undefined);
      })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
  let finishRead!: (value: ReturnType<typeof inventory>) => void;
  f.emit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      })
  );
  f.view.rerender(<PrivateArchivedNotes {...f.props} revision={1} />);
  f.emit.mockResolvedValueOnce(inventory([]));
  await act(async () => {
    finishRestore();
  });
  expect(f.props.onRestored).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishRead(inventory(rows));
  });
  expect(f.props.onCount).toHaveBeenLastCalledWith(0);
  expect(screen.getByRole('status')).toHaveTextContent(
    'privacy.archive.restored'
  );
});

it('restores only the selected archived record after existing wallet authorization and refreshes both inventories', async () => {
  const f = fixture(notes.slice(0, 2));
  await f.open();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'privacy.archive.restore' })[1]
  );
  expect(f.emit).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
  await waitFor(() => expect(f.props.onCount).toHaveBeenLastCalledWith(1));
  expect(f.emit).toHaveBeenCalledWith(
    ['privateVault', 'restoreArchivedNote'],
    ['note-1', 'existing-wallet-password'],
    30000,
    false
  );
  expect(f.props.onRestored).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent(
    'privacy.archive.restored'
  );
});

it('requires permanent-delete disclosure, explicit spent-or-backup acknowledgement and wallet authorization; Cancel preserves archive', async () => {
  const f = fixture(notes.slice(0, 2));
  await f.open();
  fireEvent.click(
    screen.getByRole('button', { name: 'privacy.archive.clear' })
  );
  expect(screen.getByText('privacy.archive.warning')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Authorize' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  expect(f.emit).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'privacy.archive.clear' })
  );
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'privacy.archive.confirmBackup' })
  );
  expect(f.emit).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
  await waitFor(() => expect(f.props.onCount).toHaveBeenLastCalledWith(0));
  expect(f.emit).toHaveBeenCalledWith(
    ['privateVault', 'clearArchive'],
    ['existing-wallet-password'],
    30000,
    false
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'privacy.archive.clearResult'
  );
  expect(screen.getByText('privacy.archive.empty')).toBeVisible();
});

it('reports a full active inventory without claiming a restore succeeded', async () => {
  const f = fixture(notes.slice(0, 1));
  await f.open();
  f.emit.mockImplementationOnce(async () => {
    throw Error('privacy_note_limit');
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'privacy.archive.restore' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'privacy.archive.activeFull'
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('retired archive reads cannot publish counts or a replaced inventory', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const count = jest.fn();
  const view = render(
    <PrivateArchivedNotes
      controllerEmitter={() => pending}
      revision={0}
      onCount={count}
      onRestored={jest.fn()}
      onReveal={jest.fn()}
      onExport={jest.fn()}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: /^privacy.archive.title/ })
  );
  count.mockClear();
  view.unmount();
  await act(async () => {
    finish(inventory());
    await pending;
  });
  expect(count).not.toHaveBeenCalled();
});

it('normal completed-note cleanup reports separate archive capacity instead of silently deleting or forgetting notes', async () => {
  const removed = jest.fn();
  const emit = jest.fn(async () => {
    throw Error('privacy_archive_limit');
  });
  render(
    <PrivateVaultClearCompleted
      confirming
      controllerEmitter={emit}
      noteId="id"
      onCancel={jest.fn()}
      onComplete={jest.fn()}
      onRemoved={removed}
      onSelect={jest.fn()}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'privacy.capacity.confirmClear' })
  );
  await waitFor(() =>
    expect(mockClearError).toHaveBeenCalledWith('privacy.archive.full')
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(removed).not.toHaveBeenCalled();
});

it('reconciles an ambiguous clear acknowledgement and requires a fresh disclosure instead of retaining a delete retry', async () => {
  let rows = notes.slice(0, 2);
  const emit = jest.fn(async ([, method]) => {
    if (method === 'getArchivedNotes') return inventory(rows);
    if (method === 'clearArchive') {
      rows = [];
      throw Error('lost acknowledgement');
    }
    throw Error('Unexpected archive operation');
  });
  const count = jest.fn();
  render(
    <PrivateArchivedNotes
      controllerEmitter={emit}
      revision={0}
      onCount={count}
      onRestored={jest.fn()}
      onReveal={jest.fn()}
      onExport={jest.fn()}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: /^privacy.archive.title/ })
  );
  await waitFor(() => expect(count).toHaveBeenLastCalledWith(2));
  fireEvent.click(
    screen.getByRole('button', { name: 'privacy.archive.clear' })
  );
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'privacy.archive.confirmBackup' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
  await waitFor(() => expect(count).toHaveBeenLastCalledWith(0));
  expect(screen.getByText('privacy.archive.empty')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'privacy.archive.actionError'
  );
  expect(
    screen.queryByRole('button', { name: 'Authorize' })
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(emit.mock.calls.map(([path]) => path[1])).toEqual([
    'getArchivedNotes',
    'clearArchive',
    'getArchivedNotes',
  ]);
});

it('uses full outlined touch targets and decorative action icons throughout the new archive list', async () => {
  const f = fixture(notes.slice(0, 2));
  await f.open();
  for (const button of screen.getAllByRole('button')) {
    expect(button).toHaveClass(
      'min-h-[44px]',
      'min-w-[44px]',
      'rounded-xl',
      'border'
    );
    expect(button).not.toHaveClass('underline');
  }
  for (const name of ['archive', 'reload', 'export', 'trash', 'eye', 'import'])
    expect(document.querySelector(`[data-icon="${name}"]`)).toBeInTheDocument();
  expect(
    screen.getAllByRole('button', { name: 'privacy.archive.restore' })
  ).toHaveLength(2);
});
