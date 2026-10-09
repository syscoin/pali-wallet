import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';

type ControllerStatus = {
  connectionUnavailable: boolean;
  isLoading: boolean;
  isUnlocked: boolean;
};

let snapshot: ControllerStatus = {
  connectionUnavailable: false,
  isLoading: true,
  isUnlocked: false,
};
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let pendingCheck: Promise<boolean> | undefined;
let generation = 0;
let pendingActivity: Promise<unknown> | undefined;
let lastRouteActivity = '';
let lastRouteActivityTime = 0;

const publish = (next: ControllerStatus) => {
  if (
    snapshot.connectionUnavailable === next.connectionUnavailable &&
    snapshot.isLoading === next.isLoading &&
    snapshot.isUnlocked === next.isUnlocked
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
};

const schedulePoll = () => {
  clearTimeout(pollTimer);
  if (listeners.size > 0) {
    // Schedule after completion so a slow service worker cannot accumulate polls.
    pollTimer = setTimeout(
      () => void checkControllerStatus(),
      snapshot.isUnlocked && !snapshot.connectionUnavailable ? 30000 : 2000
    );
  }
};

export const checkControllerStatus = (): Promise<boolean> => {
  if (pendingCheck) return pendingCheck;
  const requestGeneration = generation;
  const request = controllerEmitter(['wallet', 'isUnlocked'], [], 1800)
    .then((unlocked) => {
      if (typeof unlocked !== 'boolean') {
        throw new Error('Invalid wallet lock status response');
      }
      // A logout/forget event or a disposed subscription invalidates older replies.
      if (requestGeneration === generation) {
        publish({
          connectionUnavailable: false,
          isLoading: false,
          isUnlocked: !!unlocked,
        });
      }
      return snapshot.isUnlocked;
    })
    .catch(() => {
      // Keep known lock state during service-worker restarts; initial callers
      // still leave the loading screen and can display the normal locked UI.
      if (requestGeneration === generation) {
        publish({ ...snapshot, connectionUnavailable: true, isLoading: false });
      }
      return snapshot.isUnlocked;
    })
    .finally(() => {
      if (pendingCheck === request) pendingCheck = undefined;
      if (requestGeneration === generation) schedulePoll();
    });
  pendingCheck = request;
  return request;
};

// Authentication changes must not reuse a read started before the change. Await
// an authoritative new result before entering protected routes or completing an
// external authentication request; a cached unlocked value is not confirmation.
export const refreshControllerStatus = async (): Promise<boolean> => {
  generation += 1;
  const refreshGeneration = generation;
  pendingCheck = undefined;
  clearTimeout(pollTimer);
  publish({ ...snapshot, isLoading: true });
  const unlocked = await checkControllerStatus();
  return (
    refreshGeneration === generation &&
    !snapshot.connectionUnavailable &&
    unlocked
  );
};

const handleMessage = (message: { type?: string }) => {
  if (message.type === 'CONTROLLER_STATE_CHANGE') {
    void checkControllerStatus();
  } else if (message.type === 'logout' || message.type === 'wallet_forgotten') {
    generation += 1;
    pendingCheck = undefined;
    publish({
      connectionUnavailable: false,
      isLoading: false,
      isUnlocked: false,
    });
    schedulePoll();
  }
};

export const subscribeControllerStatus = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    generation += 1;
    publish({ ...snapshot, isLoading: true });
    chrome.runtime.onMessage.addListener(handleMessage);
    void checkControllerStatus();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      generation += 1;
      clearTimeout(pollTimer);
      pendingCheck = undefined;
      chrome.runtime.onMessage.removeListener(handleMessage);
    }
  };
};

export const getControllerStatus = () => snapshot;

export const resetControllerAutoLock = (): Promise<unknown> => {
  if (!pendingActivity) {
    pendingActivity = controllerEmitter(['wallet', 'resetAutoLockTimer'], [])
      .catch(() => undefined)
      .finally(() => {
        pendingActivity = undefined;
      });
  }
  return pendingActivity;
};

export const resetControllerAutoLockForRoute = (route: string) => {
  const now = Date.now();
  if (route === lastRouteActivity && now - lastRouteActivityTime < 500) return;
  lastRouteActivity = route;
  lastRouteActivityTime = now;
  void resetControllerAutoLock();
};
