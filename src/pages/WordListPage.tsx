// WordListPage.tsx
import { useEffect, useState, type JSX } from 'react';
import { useParams, useNavigate, Link, generatePath } from 'react-router-dom';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { ref as rtdbRef, get, push, set as rtdbSet, onDisconnect } from 'firebase/database';
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
  wordbookPath: string;
  wordIndex: number;   // ✅ 페이지 인덱스가 아니라 "단어 인덱스"
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

  // 🔹 북마크 상태 (단어 인덱스 기반)
  const [bookmarkWordIndex, setBookmarkWordIndex] = useState<number | null>(null);
  const [bookmarkId, setBookmarkId] = useState<string | null>(null); // 랜덤 ID
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);     // RTDB 읽기 완료?
  const [initialPageApplied, setInitialPageApplied] = useState(false); // 북마크 반영 완료?

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

  // 🔹 RTDB 북마크 1회 읽기 (랜덤 bookmarkId 기반, wordIndex 사용)
  useEffect(() => {
    if (!currentUserUid || !uid || !wordbookPath) return;

    let cancelled = false;

    const fetchBookmark = async () => {
      try {
        const viewerUid = currentUserUid;
        const basePath = `voca/${VITE_VOCA_ENV}/users/${viewerUid}/bookmarks`;
        const dbRef = rtdbRef(database, basePath);

        const snap = await get(dbRef);

        if (!snap.exists()) {
          if (!cancelled) {
            setBookmarkId(null);
            setBookmarkWordIndex(null);
            setBookmarksLoaded(true);
          }
          return;
        }

        const val = snap.val() as Record<string, Bookmark>;
        let best: { key: string; data: Bookmark } | null = null;

        for (const [key, data] of Object.entries(val)) {
          if (!data || data.wordbookPath !== wordbookPath) continue;
          if (!best || (data.updatedAt ?? 0) > (best.data.updatedAt ?? 0)) {
            best = { key, data };
          }
        }

        if (!cancelled) {
          if (best) {
            setBookmarkId(best.key);
            setBookmarkWordIndex(best.data.wordIndex ?? 0);
          } else {
            setBookmarkId(null);
            setBookmarkWordIndex(null);
          }
          setBookmarksLoaded(true);
        }
      } catch (e) {
        console.error('[RTDB] get bookmark error', e);
        if (!cancelled) {
          setBookmarkId(null);
          setBookmarkWordIndex(null);
          setBookmarksLoaded(true);
        }
      }
    };

    fetchBookmark();

    return () => {
      cancelled = true;
      setBookmarkId(null);
      setBookmarkWordIndex(null);
      setBookmarksLoaded(false);
      setInitialPageApplied(false);
    };
  }, [currentUserUid, uid, wordbookPath]);

  // 🔹 북마크(wordIndex) → 초기 pageIndex 반영 (딱 1번)
  useEffect(() => {
    if (!bookmarksLoaded) return;
    if (initialPageApplied) return;
    if (!text) return;

    const allLines = text.split('\n').filter(l => l.trim() !== '');
    if (allLines.length === 0) {
      setInitialPageApplied(true);
      return;
    }

    // 북마크 없음 → 기본 0페이지 유지
    if (bookmarkWordIndex == null) {
      setInitialPageApplied(true);
      return;
    }

    // 북마크 있는 경우: wordIndex → pageIndex 환산
    let idx = bookmarkWordIndex;
    if (idx < 0) idx = 0;
    if (idx >= allLines.length) idx = allLines.length - 1;

    const totalPages = Math.max(1, Math.ceil(allLines.length / pageSize));
    let newPageIndex = Math.floor(idx / pageSize);
    if (newPageIndex < 0) newPageIndex = 0;
    if (newPageIndex >= totalPages) newPageIndex = totalPages - 1;

    setPageIndex(newPageIndex);
    setInitialPageApplied(true);
  }, [bookmarksLoaded, initialPageApplied, text, bookmarkWordIndex, pageSize]);

  // 🔹 페이지 바뀔 때마다 북마크 저장 (초기 로딩이 끝난 뒤부터)
  useEffect(() => {
    // 아직 북마크/텍스트 초기화가 안 끝났으면 쓰지 않음
    if (!bookmarksLoaded || !initialPageApplied) return;

    if (!currentUserUid || !uid || !wordbookPath) return;
    if (!text) return;

    const allLines = text.split('\n').filter(l => l.trim() !== '');
    if (allLines.length === 0) return;

    // 안전한 pageIndex 계산 (텍스트 길이와 pageSize 기준으로 보정)
    const { safePageIndex } = paginate(allLines, pageSize, pageIndex);
    const wordIndex = safePageIndex * pageSize; // ✅ 이 페이지의 첫 단어 인덱스

    const viewerUid = currentUserUid;
    const basePath = `voca/${VITE_VOCA_ENV}/users/${viewerUid}/bookmarks`;
    const baseRef = rtdbRef(database, basePath);

    let id = bookmarkId;
    if (!id) {
      const newRef = push(baseRef); // 랜덤 bookmarkId 생성
      id = newRef.key!;
      setBookmarkId(id);
    }

    const bkRef = rtdbRef(database, `${basePath}/${id}`);
    const bookmark: Bookmark = {
      wordbookPath,
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
  }, [
    pageIndex,
    pageSize,
    text,
    currentUserUid,
    uid,
    wordbookPath,
    bookmarkId,
    bookmarksLoaded,
    initialPageApplied,
  ]);

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
      <div className="position-relative mb-3" style={{ minHeight: 32 }}>
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

        <div className="position-absolute" style={{ top: 0, right: 0 }}>
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

        {/* 중앙 단어 리스트 박스 */}
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
                  >
                    ·
                  </li>,
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
