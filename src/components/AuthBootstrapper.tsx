// components/AuthBootstrapper.tsx
import { useEffect } from 'react';
import { useLocation, useNavigate, generatePath } from 'react-router-dom';
import { useAuth } from '~/contexts/AuthContext';
import { ROUTE_SIGN_IN, ROUTE_SIGN_UP, ROUTE_USER_WORDS } from '~/constants/routes';

export function AuthBootstrapper() {
  const { user, initializing } = useAuth();
  const nav = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (initializing) return;

    if (!user) {
      // 로그인 안 된 상태에서는 여기서 아무것도 안 함
      return;
    }

    const path = location.pathname;

    // 로그인/회원가입에서만 자동 리다이렉트
    if (path === ROUTE_SIGN_IN || path === ROUTE_SIGN_UP) {
      nav(
        generatePath(ROUTE_USER_WORDS, { uid: user.uid }),
        { replace: true },
      );
    }
  }, [user, initializing, location.pathname, nav]);

  return null;
}
