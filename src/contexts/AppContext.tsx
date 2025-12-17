// contexts/AppContext.tsx
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';

type AppContextValue = {
  isMobile: boolean;
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

function detectMobile() {
  return (
    window.matchMedia('(max-width: 768px)').matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    // SSR 대비
    if (typeof window === 'undefined') return false;
    return detectMobile();
  });

  useEffect(() => {
    const onResize = () => {
      setIsMobile(detectMobile());
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const value: AppContextValue = {
    isMobile,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within <AppProvider>');
  }
  return ctx;
}
