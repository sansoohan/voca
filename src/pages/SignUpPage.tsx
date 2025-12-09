// pages/SignUpPage.tsx
import { useState } from 'react';
import { auth, firestore, VITE_VOCA_ENV } from '~/constants/firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useNavigate, Link, generatePath } from 'react-router-dom';
import { ROUTE_SIGN_IN, ROUTE_USER_WORDS } from '~/constants/routes';
import { newUserData } from '~/constants/newUser';

export function SignUpPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSignUp = async () => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      const uid = cred.user.uid;

      await setDoc(doc(firestore, 'voca', VITE_VOCA_ENV, 'users', uid), newUserData);

      nav(generatePath(ROUTE_USER_WORDS, { uid }));
    } catch (e: any) {
      setError(e.message ?? '회원가입 실패');
    }
  };

  return (
    <div className="container py-5">
      <div className="auth-wrapper mx-auto">
        <h1 className="text-center mb-4">회원가입</h1>
        <div className="mb-3">
          <label className="form-label">이메일</label>
          <input
            type="email"
            className="form-control"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>
        <div className="mb-3">
          <label className="form-label">패스워드</label>
          <input
            type="password"
            className="form-control"
            value={pw}
            onChange={e => setPw(e.target.value)}
          />
        </div>
        {error && <div className="text-danger mb-3">{error}</div>}
        <div className="d-grid gap-2 mb-3">
          <button className="btn btn-primary" onClick={handleSignUp}>
            가입하기
          </button>
        </div>
        <div className="text-center">
          <Link to={ROUTE_SIGN_IN} className="link-light">
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
