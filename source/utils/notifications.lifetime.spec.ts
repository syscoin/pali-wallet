/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const sourcePath = join(__dirname, 'notifications.ts');
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

type Listener = (id: string, index?: number) => void | Promise<void>;
function host() {
  const notices = new Map<string, Record<string, unknown>>();
  let body!: Listener, button!: Listener;
  const openPopup = jest.fn<Promise<void>, []>().mockResolvedValue();
  const createTab = jest
    .fn<Promise<unknown>, [unknown]>()
    .mockResolvedValue({});
  const clear = jest.fn((id: string, done: (cleared: boolean) => void) => {
    done(notices.delete(id));
  });
  const action: { openPopup?: typeof openPopup } = { openPopup };
  const chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://pali/${path}` },
    action,
    tabs: { create: createTab },
    notifications: {
      create(
        id: string,
        options: Record<string, unknown>,
        done: (createdId: string) => void
      ) {
        notices.set(id, options);
        done(id);
      },
      clear,
      getAll: jest.fn((done: (all: Record<string, unknown>) => void) =>
        done(Object.fromEntries([...notices.keys()].map((id) => [id, true])))
      ),
      onClicked: {
        addListener: (listener: Listener) => {
          body = listener;
        },
      },
      onButtonClicked: {
        addListener: (listener: Listener) => {
          button = listener;
        },
      },
      onClosed: { addListener: jest.fn() },
    },
  };
  let sequence = 0;
  const worker = () => {
    const exports = {} as typeof import('./notifications');
    vm.runInNewContext(
      compiled,
      {
        exports,
        chrome,
        console,
        Math: Object.assign(Object.create(Math), {
          random: () => ++sequence / 1000,
        }),
        require: (name: string) => {
          if (name === './checkPopupOpen')
            return { checkIfPopupIsOpen: async () => false };
          if (name === './notificationLocale')
            return {
              getNotificationTranslator: async () => (key: string) => key,
            };
          throw new Error(`Unexpected fixture dependency: ${name}`);
        },
      },
      { filename: sourcePath }
    );
    exports.setupNotificationListeners();
    return exports;
  };
  return {
    notices,
    openPopup,
    createTab,
    clear,
    action,
    chrome,
    worker,
    click: (id: string) => body(id),
    button: (id: string) => button(id, 0),
  };
}

it.each(['network', 'account'] as const)(
  'opens an OS-held %s notice after only the MV3 worker restarts',
  async (kind) => {
    const h = host(),
      api = h.worker();
    const id = (
      kind === 'network'
        ? await api.showNetworkChangeNotification('Public chain')
        : await api.showAccountChangeNotification(
            'public-account',
            'Public account'
          )
    )!;
    h.worker();
    expect(h.notices.has(id)).toBe(true);
    await h.click(id);
    expect(h.openPopup).toHaveBeenCalledTimes(1);
    expect(h.createTab).not.toHaveBeenCalled();
    expect(h.notices.has(id)).toBe(false);
  }
);

it('never rehydrates an unknown, closed or arbitrary custom callback notification', async () => {
  const h = host(),
    api = h.worker(),
    callback = jest.fn();
  const scoped = (await api.createNotification({
    title: 'Public',
    message: 'Public',
    clickAction: callback,
  }))!;
  const closed = (await api.showNetworkChangeNotification('Public chain'))!;
  h.notices.delete(closed);
  h.worker();
  for (const id of [
    scoped,
    closed,
    'unknown-id',
    'pali_wallet_1700000000000_abc',
  ])
    await h.click(id);
  expect(callback).not.toHaveBeenCalled();
  expect(h.openPopup).not.toHaveBeenCalled();
  expect(h.createTab).not.toHaveBeenCalled();
});

it('retains warm generic body and cold generic button routes without persisting callbacks', async () => {
  const h = host(),
    api = h.worker();
  const warm = (await api.showNetworkChangeNotification('Public chain'))!;
  await h.click(warm);
  const button = (await api.showErrorNotification('Public failure'))!;
  h.worker();
  await h.button(button);
  expect(h.openPopup).toHaveBeenCalledTimes(2);
  expect(h.createTab).not.toHaveBeenCalled();
});

it('does not grant a cold button route to a body-only generic notice', async () => {
  const h = host(),
    api = h.worker();
  const id = (await api.showNetworkChangeNotification('Public chain'))!;
  h.worker();
  await h.button(id);
  expect(h.openPopup).not.toHaveBeenCalled();
  expect(h.createTab).not.toHaveBeenCalled();
});

it('refuses cold routing if the browser cannot confirm its OS inventory', async () => {
  const h = host(),
    api = h.worker();
  const id = (await api.showNetworkChangeNotification('Public chain'))!;
  h.worker();
  h.chrome.notifications.getAll.mockImplementation(() => {
    throw new Error('Inventory unavailable');
  });
  await h.click(id);
  expect(h.openPopup).not.toHaveBeenCalled();
  expect(h.createTab).not.toHaveBeenCalled();
});

it.each(['body', 'button'] as const)(
  'refuses a stale scoped %s action, even when its callback does not guard itself',
  async (kind) => {
    const h = host(),
      api = h.worker(),
      callback = jest.fn();
    let current = true;
    const id = (await api.createNotification({
      title: 'Public',
      message: 'Public',
      isCurrent: () => current,
      clickAction: callback,
      buttons: [{ title: 'Open' }],
    }))!;
    current = false;
    await (kind === 'body' ? h.click(id) : h.button(id));
    expect(callback).not.toHaveBeenCalled();
    expect(h.openPopup).not.toHaveBeenCalled();
    expect(h.createTab).not.toHaveBeenCalled();
  }
);

it('does not turn a scoped action into a generic route after restart', async () => {
  const h = host(),
    api = h.worker();
  const id = (await api.createNotification({
    title: 'Public',
    message: 'Public',
    isCurrent: () => true,
  }))!;
  h.worker();
  await h.click(id);
  expect(h.openPopup).not.toHaveBeenCalled();
  expect(h.createTab).not.toHaveBeenCalled();
});

it.each(['missing', 'rejected', 'throwing'] as const)(
  'uses the fixed wallet tab when openPopup is %s',
  async (mode) => {
    const h = host(),
      api = h.worker();
    if (mode === 'missing') delete h.action.openPopup;
    if (mode === 'rejected')
      h.openPopup.mockRejectedValue(new Error('Unsupported installation'));
    if (mode === 'throwing')
      h.openPopup.mockImplementation(() => {
        throw new Error('Unsupported API');
      });
    const id = (await api.showNetworkChangeNotification('Public chain'))!;
    await h.click(id);
    expect(h.createTab).toHaveBeenCalledWith({
      url: 'chrome-extension://pali/app.html',
    });
    expect(h.notices.has(id)).toBe(false);
  }
);

it('can use the supported fallback after a generic notice wakes a cold worker', async () => {
  const h = host(),
    api = h.worker();
  const id = (await api.showAccountChangeNotification('Public account'))!;
  h.worker();
  delete h.action.openPopup;
  await h.click(id);
  expect(h.createTab).toHaveBeenCalledWith({
    url: 'chrome-extension://pali/app.html',
  });
});

it('preserves the existing default, zero and critical priority behavior', async () => {
  const h = host(),
    api = h.worker();
  for (const [priority, expected] of [
    [undefined, 1],
    [0, 1],
    [2, 2],
  ] as const) {
    const id = (await api.createNotification({
      title: 'Public',
      message: 'Public',
      priority,
    }))!;
    expect(h.notices.get(id)?.priority).toBe(expected);
  }
});

it('does not open a fallback tab if the account scope retires while openPopup rejects', async () => {
  const h = host(),
    api = h.worker();
  let current = true,
    reject!: (error: Error) => void;
  h.openPopup.mockImplementation(
    () =>
      new Promise((_resolve, no) => {
        reject = no;
      })
  );
  const id = (await api.createNotification({
    title: 'Public',
    message: 'Public',
    isCurrent: () => current,
  }))!;
  const clicked = h.click(id);
  current = false;
  reject(new Error('Policy-installed extensions only'));
  await clicked;
  expect(h.createTab).not.toHaveBeenCalled();
});

it('handles an unavailable fallback without an unhandled rejection', async () => {
  const h = host(),
    api = h.worker();
  delete h.action.openPopup;
  h.createTab.mockRejectedValue(new Error('Tab unavailable'));
  const id = (await api.showNetworkChangeNotification('Public chain'))!;
  await expect(Promise.resolve(h.click(id))).resolves.toBeUndefined();
  expect(h.createTab).toHaveBeenCalledTimes(1);
});
