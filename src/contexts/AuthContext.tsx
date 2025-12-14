// contexts/AuthContext.tsx
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '~/constants/firebase';
import { ensureDefaultWordbook } from '~/utils/storage';

type AuthContextValue = {
  user: User | null;
  initializing: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  // 같은 uid에 대해 기본 단어장 여러 번 만들지 않도록
  const ensuredSetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async fbUser => {
      setUser(fbUser);
      setInitializing(false);

      if (!fbUser) return;

      const uid = fbUser.uid;
      if (!ensuredSetRef.current.has(uid)) {
        try {
          await ensureDefaultWordbook(uid);
          ensuredSetRef.current.add(uid);
        } catch (e) {
          console.error('ensureDefaultWordbook failed', e);
          // 여기서는 전역 에러 상태까지는 올리지 않고, 콘솔만 찍어도 됨
        }
      }
    });

    return unsub;
  }, []);

  const value: AuthContextValue = {
    user,
    initializing,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
