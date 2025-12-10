// WordListPage.tsx
import { useEffect, useState, type JSX } from 'react';
import { useParams, useNavigate, Link, generatePath } from 'react-router-dom';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { ref as rtdbRef, onValue, push, set as rtdbSet, onDisconnect } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { LogoutButton } from '~/components/LogoutButton';
import { auth, VITE_VOCA_ENV, storage, database } from '~/constants/firebase';
import { ROUTE_SIGN_IN, ROUTE_USER_WORDS_EDIT } from '~/constants/routes';
import type { PageSize } from '~/types/editor';
import { computeInitialPageSize, paginate } from '~/utils/editor';
import { PaginationControls } from '~/components/PaginationControls';
import { SEP } from '~/constants/editor';
import { getDefaultWordbookPath } from '~/utils/storage';

type Bookmark = {
  id: string;
  wordIndex: number;
  updatedAt: number;
};

export function WordListPage() {
  const { uid } = useParams<{ uid: string }>();
  const nav = useNavigate();

  const [text, setText] = useState<string>('');
  const [currentUserUid, setCurrentUserUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // 한 페이지에 최대 단어 수
  const [pageSize, setPageSize] = useState<PageSize>(computeInitialPageSize(120, 23.4));
  const [pageIndex, setPageIndex] = useState(0); // 0-based

  // 북마크 상태
  const [bookmarkWordIndex, setBookmarkWordIndex] = useState<number | null>(null);
  const [bookmarkKey, setBookmarkKey] = useState<string | null>(null);
  const [initialBookmarkApplied, setInitialBookmarkApplied] = useState(false);

  const wordbookPath = uid ? getDefaultWordbookPath(uid) : null;

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      setCurrentUserUid(user?.uid ?? null);
    });
    return () => unsub();
  }, []);

  // Storage에서 wordbook 텍스트 로드
  useEffect(() => {
    if (!uid) return;

    const fetchText = async () => {
      setLoading(true);
      try {
        const path = getDefaultWordbookPath(uid);
        const fileRef = storageRef(storage, path);
        const url = await getDownloadURL(fileRef);
        const res = await fetch(url);
        const txt = await res.text();
        setText(txt ?? '');
        setError(null);
      } catch (e: any) {
        console.error(e);
        if (e.code === 'storage/object-not-found') {
          setError('해당 단어장을 찾을 수 없습니다.');
        } else {
          setError('단어장을 불러오는 중 오류가 발생했습니다.');
        }
        setText('');
      } finally {
        setLoading(false);
      }
    };

    fetchText();
  }, [uid]);

  // RTDB 북마크 감시
  useEffect(() => {
    if (!currentUserUid || !uid) return;

    const viewerUid = currentUserUid;
    const basePath = `voca/${VITE_VOCA_ENV}/users/${viewerUid}/bookmarks`;
    const dbRef = rtdbRef(database, basePath);

    const unsub = onValue(
      dbRef,
      snap => {
        const val = snap.val() as Record<string, Bookmark> | null;
        if (!val) {
          setBookmarkWordIndex(null);
          setBookmarkKey(null);
          return;
        }

        const targetPath = getDefaultWordbookPath(uid);

        let best: { key: string; data: Bookmark } | null = null;
        for (const [key, data] of Object.entries(val)) {
          if (!data || data.id !== targetPath) continue;
          if (!best || (data.updatedAt ?? 0) > (best.data.updatedAt ?? 0)) {
            best = { key, data };
          }
        }

        if (best) {
          setBookmarkKey(best.key);
          setBookmarkWordIndex(best.data.wordIndex);
        } else {
          setBookmarkKey(null);
          setBookmarkWordIndex(null);
        }
      },
      error => {
        console.error('[RTDB] onValue error', error);
      },
    );

    return () => {
      unsub();
      setBookmarkWordIndex(null);
      setBookmarkKey(null);
      setInitialBookmarkApplied(false);
    };
  }, [currentUserUid, uid]);

  // 북마크 → 초기 pageIndex 반영
  useEffect(() => {
    if (initialBookmarkApplied) return;
    if (!text) return;
    if (bookmarkWordIndex == null) return;

    const allLines = text.split('\n').filter(l => l.trim() !== '');
    if (allLines.length === 0) return;

    let idx = bookmarkWordIndex;
    if (idx < 0) idx = 0;
    if (idx >= allLines.length) idx = allLines.length - 1;

    const newPageIndex = Math.floor(idx / pageSize);
    setPageIndex(newPageIndex);
    setInitialBookmarkApplied(true);
  }, [text, bookmarkWordIndex, pageSize, initialBookmarkApplied]);

  // 페이지 바뀔 때마다 북마크 저장
  useEffect(() => {
    if (!currentUserUid || !uid || !wordbookPath) return;
    if (!text) return;

    const allLines = text.split('\n').filter(l => l.trim() !== '');
    if (allLines.length === 0) return;

    const viewerUid = currentUserUid;
    const basePath = `voca/${VITE_VOCA_ENV}/users/${viewerUid}/bookmarks`;
    const baseRef = rtdbRef(database, basePath);

    const wordIndex = pageIndex * pageSize;

    let key = bookmarkKey;
    if (!key) {
      const newRef = push(baseRef);
      key = newRef.key!;
      setBookmarkKey(key);
    }

    const bkRef = rtdbRef(database, `${basePath}/${key}`);
    const bookmark: Bookmark = {
      id: wordbookPath,
      wordIndex,
      updatedAt: Date.now(),
    };

    rtdbSet(bkRef, bookmark).catch(err => {
      console.error('[RTDB] write error', err);
    });

    onDisconnect(bkRef)
      .set(bookmark)
      .catch(err => {
        console.error('[RTDB] onDisconnect error', err);
      });
  }, [pageIndex, pageSize, text, currentUserUid, uid, wordbookPath, bookmarkKey]);

  if (error) {
    return (
      <div className="container py-5">
        <p>{error}</p>
        <Link to={ROUTE_SIGN_IN} className="link-light">
          로그인 페이지로 이동
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container py-5">
        <p>로딩 중...</p>
      </div>
    );
  }

  const canEdit = currentUserUid === uid;
  const lines = text.split('\n').filter(l => l.trim() !== '');

  const {
    totalPages,
    safePageIndex,
    pageStart,
    pagedItems: pagedLines,
  } = paginate(lines, pageSize, pageIndex);

  const hasPages = totalPages > 0;
  const canCycle = totalPages > 1;
  const currentPage = hasPages ? safePageIndex + 1 : 0;

  const prevPageNumber = hasPages
    ? canCycle
      ? currentPage === 1
        ? totalPages
        : currentPage - 1
      : currentPage
    : 0;

  const nextPageNumber = hasPages
    ? canCycle
      ? currentPage === totalPages
        ? 1
        : currentPage + 1
      : currentPage
    : 0;

  const goPrevPage = () => {
    if (!canCycle) return;
    setPageIndex(prev => (prev > 0 ? prev - 1 : totalPages - 1));
  };

  const goNextPage = () => {
    if (!canCycle) return;
    setPageIndex(prev => (prev < totalPages - 1 ? prev + 1 : 0));
  };

  return (
    <div
      className="container"
      style={{
        maxWidth: 1080,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: '0.75rem',
        paddingBottom: '0.75rem',
      }}
    >
      {/* 최상단: 수정 버튼 중앙, 로그아웃 우상단 absolute */}
      <div
        className="position-relative mb-3"
        style={{ minHeight: 32 }}
      >
        {/* 중앙 수정 버튼 */}
        <div className="d-flex justify-content-center">
          {canEdit && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => nav(generatePath(ROUTE_USER_WORDS_EDIT, { uid }))}
            >
              수정
            </button>
          )}
        </div>

        {/* 우상단 로그아웃 (absolute) */}
        <div
          className="position-absolute"
          style={{ top: 0, right: 0 }}
        >
          <LogoutButton />
        </div>
      </div>

      {/* 중앙: 좌/우 페이지 네비 + 단어 리스트 */}
      <div className="d-flex mt-2 mb-3">
        {/* 왼쪽 여백 = 이전 페이지 */}
        <div
          onClick={goPrevPage}
          className="d-flex align-items-center justify-content-center"
          style={{
            flex: 1,
            cursor: canCycle ? 'pointer' : 'default',
            fontSize: '1.4rem',
            lineHeight: 1,
            opacity: canCycle ? 0.35 : 0.15,
            color: '#bbb',
            userSelect: 'none',
          }}
        >
          {hasPages ? prevPageNumber : ''}
        </div>

        {/* 중앙 단어 리스트 박스 (세로폭 = 실제 단어 개수만큼) */}
        <div
          className="bg-black"
          style={{
            flexShrink: 0,
            maxWidth: 720,
            minWidth: 280,
            border: '1px solid #444',
            borderRadius: 6,
            padding: 4,
          }}
        >
          <ul
            style={{
              listStyle: 'none',
              paddingLeft: 0,
              marginBottom: 0,
            }}
          >
            {(() => {
              // 단어가 전혀 없으면 안내문만 출력
              if (lines.length === 0) {
                return (
                  <li
                    style={{ padding: '4px 6px', fontSize: '0.9rem' }}
                    className="text-secondary"
                  >
                    단어가 없습니다. 에디터에서 단어를 추가해 주세요.
                  </li>
                );
              }

              const items: JSX.Element[] = [];

              const isLastPage =
                totalPages > 0 && safePageIndex === totalPages - 1;
              const realCount = pagedLines.length;
              const padCount = isLastPage
                ? Math.max(0, pageSize - realCount)
                : 0;

              // 실제 단어 라인
              pagedLines.forEach((line: string, localIdx: number) => {
                const idx = pageStart + localIdx;
                const parts = line.split(SEP);
                const word = parts[0]?.trim();
                const link = parts[1]?.trim();
                const hasLink = !!link;

                items.push(
                  <li
                    key={idx}
                    style={{
                      padding: '2px 6px',
                      borderBottom: '1px solid #333',
                      fontSize: '0.92rem',
                      lineHeight: 1.25,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {hasLink ? (
                      <a
                        href={link}
                        className="text-decoration-none"
                        style={{ color: '#f8f9fa' }}
                      >
                        <span className="fw-bold">{word}</span>
                      </a>
                    ) : (
                      <span className="fw-bold text-light">{word}</span>
                    )}
                  </li>,
                );
              });

              // 마지막 페이지면 빈 줄로 패딩해서 꽉 채우기
              for (let i = 0; i < padCount; i++) {
                items.push(
                  <li
                    key={`pad-${i}`}
                    style={{
                      padding: '2px 6px',
                      borderBottom: '1px solid #333',
                      fontSize: '0.92rem',
                      lineHeight: 1.25,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: 'transparent',
                    }}
                  >·</li>
                );
              }


              return items;
            })()}
          </ul>
        </div>

        {/* 오른쪽 여백 = 다음 페이지 */}
        <div
          onClick={goNextPage}
          className="d-flex align-items-center justify-content-center"
          style={{
            flex: 1,
            cursor: canCycle ? 'pointer' : 'default',
            fontSize: '1.4rem',
            lineHeight: 1,
            opacity: canCycle ? 0.35 : 0.15,
            color: '#bbb',
            userSelect: 'none',
          }}
        >
          {hasPages ? nextPageNumber : ''}
        </div>
      </div>

      {/* 최하단: 페이지네이션 컨트롤 중앙 배치 */}
      <div className="mt-auto pt-2 d-flex justify-content-center">
        <PaginationControls
          pageSize={pageSize}
          pageIndex={safePageIndex}
          totalPages={totalPages}
          onPageSizeChange={size => {
            setPageSize(size);
            setPageIndex(0);
          }}
          onPageIndexChange={setPageIndex}
        />
      </div>
    </div>
  );
}
