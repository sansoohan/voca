// components/AuthBootstrapper.tsx
import { useEffect } from 'react';
import { useLocation, useNavigate, generatePath } from 'react-router-dom';

import { useAuth } from '~/contexts/AuthContext';
import {
  ROUTE_SIGN_IN,
  ROUTE_SIGN_UP,
  ROUTE_USER_WORDS,
} from '~/constants/routes';

import { DEFAULT_WORDBOOK_FILENAME, getWordbookPath } from '~/utils/storage';
import { readLastWordbook, writeLastWordbook } from '~/utils/userWordbookIdb';

export function AuthBootstrapper() {
  const { user, initializing } = useAuth();
  const nav = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (initializing) return;
    if (!user) return;

    const path = location.pathname;

    // 로그인 / 회원가입 페이지에서만 개입
    if (path !== ROUTE_SIGN_IN && path !== ROUTE_SIGN_UP) {
      return;
    }

    let cancelled = false;

    const redirect = async () => {
      const uid = user.uid;

      // 1) IDB에서 마지막 단어장 조회
      const last = await readLastWordbook(uid);

      const filename = last?.filename ?? DEFAULT_WORDBOOK_FILENAME;

      // 2) IDB에 값이 없으면 default 기록
      if (!last) {
        const fullPath = getWordbookPath(uid, filename);
        await writeLastWordbook(uid, filename, fullPath);
      }

      if (cancelled) return;

      // 3) 해당 단어장으로 이동
      nav(
        generatePath(ROUTE_USER_WORDS, {
          uid,
          filename,
        }),
        { replace: true },
      );
    };

    redirect().catch(err => {
      console.error('[AuthBootstrapper] redirect failed', err);

      // 실패해도 최소한 default로는 보낸다
      nav(
        generatePath(ROUTE_USER_WORDS, {
          uid: user.uid,
          filename: DEFAULT_WORDBOOK_FILENAME,
        }),
        { replace: true },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [user, initializing, location.pathname, nav]);

  return null;
}
