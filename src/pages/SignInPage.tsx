// pages/SignInPage.tsx
import { useState } from 'react';
import { signInWithEmailAndPassword, signInWithPopup} from 'firebase/auth';
import { useNavigate, Link, generatePath } from 'react-router-dom';
import { auth, googleProvider } from '~/constants/firebase';
import { ROUTE_USER_WORDS } from '~/constants/routes';

export function SignInPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleEmailSignIn = async () => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pw);
      const uid = cred.user.uid;
      // 이메일 가입은 SignUpPage에서 기본 wordbook을 이미 만들어줬다고 가정
      nav(generatePath(ROUTE_USER_WORDS, { uid }));
    } catch (e: any) {
      setError(e.message ?? '로그인 실패');
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setError('구글 로그인 실패');
    }
  };

  return (
    <div className="container py-5">
      <div className="auth-wrapper mx-auto">
        <h1 className="text-center mb-4">로그인</h1>

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
          <button className="btn btn-primary" onClick={handleEmailSignIn}>
            이메일 로그인
          </button>
          <button className="btn btn-outline-light" onClick={handleGoogleSignIn}>
            구글 계정으로 로그인
          </button>
        </div>
        <div className="text-center">
          <Link to="/sign/up" className="link-light">
            회원가입
          </Link>
        </div>
      </div>
    </div>
  );
}
