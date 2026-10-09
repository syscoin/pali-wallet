import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type OnboardingSecrets = {
  kind?: 'create' | 'import';
  password?: string;
  phrase?: string;
};

const OnboardingContext = createContext<{
  beginCreate: (password: string) => void;
  beginImport: (phrase: string) => void;
  clear: () => void;
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
  const clear = useCallback(() => setSecrets({}), []);
  const beginCreate = useCallback(
    (password: string) => setSecrets({ kind: 'create', password }),
    []
  );
  const beginImport = useCallback(
    (phrase: string) => setSecrets({ kind: 'import', phrase }),
    []
  );
  const setCreatedPhrase = useCallback((phrase: string) => {
    setSecrets((current) =>
      current.kind === 'create' ? { ...current, phrase } : current
    );
  }, []);

  useEffect(() => {
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
        navigate('/', { replace: true });
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
      value={{ secrets, beginCreate, beginImport, setCreatedPhrase, clear }}
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
