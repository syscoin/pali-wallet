import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  onboardingContinuationPath,
  readOnboardingContinuation,
} from 'utils/onboardingContinuation';

type OnboardingSecrets = {
  kind?: 'create' | 'import';
  password?: string;
  phrase?: string;
  recoveryTicket?: string;
};

const OnboardingContext = createContext<{
  beginCreate: (password: string) => void;
  beginImport: (phrase: string, recoveryTicket?: string) => void;
  beginRecovery: (recoveryTicket: string) => void;
  clear: () => void;
  consumeContinuation: () => string | undefined;
  secrets: OnboardingSecrets;
  setCreatedPhrase: (phrase: string) => void;
} | null>(null);

// Deliberately scoped to the live document and cleared outside onboarding.
// Browser history and persisted stores can be written to disk, even when named
// "session" storage.
export const OnboardingSecretsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [secrets, setSecrets] = useState<OnboardingSecrets>({});
  const location = useLocation();
  const navigate = useNavigate();
  const [initialContinuation] = useState(() =>
    readOnboardingContinuation(window.location.href)
  );
  const continuation = useRef(initialContinuation);
  const consumeContinuation = useCallback(() => {
    const pending = continuation.current;
    continuation.current = undefined;
    return pending ? onboardingContinuationPath(pending) : undefined;
  }, []);
  const clear = useCallback(() => setSecrets({}), []);
  const beginCreate = useCallback(
    (password: string) => setSecrets({ kind: 'create', password }),
    []
  );
  const beginImport = useCallback(
    (phrase: string, recoveryTicket?: string) =>
      setSecrets({
        kind: 'import',
        phrase,
        ...(recoveryTicket ? { recoveryTicket } : {}),
      }),
    []
  );
  const beginRecovery = useCallback((recoveryTicket: string) => {
    setSecrets({ kind: 'import', recoveryTicket });
  }, []);
  const setCreatedPhrase = useCallback((phrase: string) => {
    setSecrets((current) =>
      current.kind === 'create' ? { ...current, phrase } : current
    );
  }, []);

  useEffect(() => {
    if (
      ![
        '/',
        '/external.html',
        '/import',
        '/external/import',
        '/create-password',
        '/create-password-import',
        '/phrase',
        '/external/phrase',
      ].includes(location.pathname)
    )
      continuation.current = undefined;
    if (['/import', '/external/import'].includes(location.pathname)) {
      setSecrets((current) =>
        current.recoveryTicket
          ? { kind: 'import', recoveryTicket: current.recoveryTicket }
          : {}
      );
      return;
    }
    if (location.pathname !== '/create-password-import') {
      setSecrets((current) => (current.recoveryTicket ? {} : current));
    }
    if (
      !['/phrase', '/external/phrase', '/create-password-import'].includes(
        location.pathname
      )
    ) {
      clear();
    }
  }, [location.pathname, clear]);

  useEffect(() => {
    // Discard a current history entry left by an older release. This cannot
    // erase historical copies that the browser has already written to disk.
    const state = location.state;
    if (
      state &&
      typeof state === 'object' &&
      ['password', 'phrase', 'createdSeed'].some((key) => key in state)
    ) {
      navigate(location.pathname + location.search + location.hash, {
        replace: true,
        state: null,
      });
    }
  }, [location, navigate]);

  useEffect(() => {
    const discard = () => {
      clear();
      if (
        [
          '/import',
          '/external/import',
          '/create-password',
          '/create-password-import',
          '/phrase',
          '/external/phrase',
        ].includes(location.pathname)
      ) {
        navigate(
          continuation.current
            ? onboardingContinuationPath(continuation.current, true)
            : '/',
          { replace: true }
        );
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') discard();
    };
    window.addEventListener('pagehide', discard);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', discard);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [clear, navigate, location.pathname]);

  return (
    <OnboardingContext.Provider
      value={{
        secrets,
        beginCreate,
        beginImport,
        beginRecovery,
        setCreatedPhrase,
        clear,
        consumeContinuation,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboardingSecrets = () => {
  const context = useContext(OnboardingContext);
  if (!context) throw new Error('Onboarding context unavailable');
  return context;
};
