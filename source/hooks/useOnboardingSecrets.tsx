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

const importPasswordPath = '/create-password-import';
const importPaths = ['/import', '/external/import'];
const retainedSecretPaths = ['/phrase', '/external/phrase', importPasswordPath];
const draftPaths = importPaths.concat('/create-password', retainedSecretPaths);

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
  const pathname = location.pathname;
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
      pathname !== '/' &&
      pathname !== '/external.html' &&
      !draftPaths.includes(pathname)
    )
      continuation.current = undefined;
    if (importPaths.includes(pathname)) {
      setSecrets((current) =>
        current.recoveryTicket
          ? { kind: 'import', recoveryTicket: current.recoveryTicket }
          : {}
      );
      return;
    }
    if (pathname !== importPasswordPath) {
      setSecrets((current) => (current.recoveryTicket ? {} : current));
    }
    if (!retainedSecretPaths.includes(pathname)) {
      clear();
    }
  }, [pathname, clear]);

  useEffect(() => {
    // Discard a current history entry left by an older release. This cannot
    // erase historical copies that the browser has already written to disk.
    const state = location.state;
    if (
      state &&
      typeof state === 'object' &&
      ['password', 'phrase', 'createdSeed'].some((key) => key in state)
    ) {
      navigate(pathname + location.search + location.hash, {
        replace: true,
        state: null,
      });
    }
  }, [location, navigate, pathname]);

  useEffect(() => {
    const discard = () => {
      clear();
      if (draftPaths.includes(pathname)) {
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
  }, [clear, navigate, pathname]);

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
