// components/LogoutButton.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '~/constants/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { ROUTE_SIGN_IN } from '~/constants/routes';

export function LogoutButton() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      setCurrentUser(user);
    });
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate(ROUTE_SIGN_IN);
    } catch (e) {
      console.error('로그아웃 실패:', e);
    }
  };

  // 로그인 안 되어 있으면 버튼 자체를 안 보여줌
  if (!currentUser) return null;

  return (
    <button className="btn btn-outline-light" onClick={handleLogout}>
      로그아웃
    </button>
  );
}
