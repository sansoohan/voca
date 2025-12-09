// pages/WordEditPage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate, generatePath } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, firestore, VITE_VOCA_ENV } from '~/constants/firebase';
import { parseTextToWordLines, wordLinesToText, shuffleLines } from '~/utils/words';
import { LogoutButton } from '~/components/LogoutButton';
import type { UserDoc } from '~/types/user';
import { ROUTE_USER_WORDS } from '~/constants/routes';

export function WordEditPage() {
  const { uid } = useParams<{ uid: string }>();
  const nav = useNavigate();

  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserUid, setCurrentUserUid] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;

    setLoading(true);
    const unsub = onAuthStateChanged(auth, async user => {
      try {
        if (!user) {
          setCurrentUserUid(null);
          setError('로그인이 필요합니다.');
          setLoading(false);
          return;
        }

        setCurrentUserUid(user.uid);

        if (user.uid !== uid) {
          setError('본인 계정만 수정할 수 있습니다.');
          setLoading(false);
          return;
        }

        const snap = await getDoc(doc(firestore, 'voca', VITE_VOCA_ENV, 'users', uid));
        if (!snap.exists()) {
          setError('유저 데이터를 찾을 수 없습니다.');
          setLoading(false);
          return;
        }

        const data = snap.data() as UserDoc;
        setText(data.words ?? '');
        setError(null);
      } catch (e) {
        console.error(e);
        setError('데이터를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [uid]);

  const handleBack = () => {
    if (!uid) return;
    nav(generatePath(ROUTE_USER_WORDS, { uid }));
  };

  const handleRandom = () => {
    setText(prev => shuffleLines(prev));
  };

  const handleSave = async () => {
    if (!uid || !currentUserUid || currentUserUid !== uid) {
      setError('저장 권한이 없습니다.');
      return;
    }

    try {
      const lines = parseTextToWordLines(text);
      const newText = wordLinesToText(lines);

      await updateDoc(doc(firestore, 'voca', VITE_VOCA_ENV, 'users', uid), {
        words: newText,
      });

      nav(generatePath(ROUTE_USER_WORDS, { uid }));
    } catch (e) {
      console.error(e);
      setError('저장 중 오류가 발생했습니다.');
    }
  };

  if (loading) {
    return (
      <div className="container py-5">
        <p>로딩 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container py-5">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <button className="btn btn-outline-light" onClick={handleBack}>뒤로</button>
        <button className="btn btn-success" onClick={handleSave}>변경</button>
        <button className="btn btn-secondary" onClick={handleRandom}>랜덤배치</button>
        
        {/* 오른쪽에 로그아웃 버튼 (로그인 상태에서만 보임) */}
        <LogoutButton />
      </div>

      <textarea
        className="form-control"
        rows={20}
        value={text}
        onChange={e => setText(e.target.value)}
      />
    </div>
  );
}
