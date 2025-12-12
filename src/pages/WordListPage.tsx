// WordListPage.tsx
import { useEffect, useState, type JSX, type MouseEvent } from 'react';
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
import { HamburgerMenu } from '~/components/HamburgerMenu';
import './WordListPage.css';
import { HamburgerDivider } from '~/components/HamburgerDivider';
import { VocaEnv } from '~/enums/firebase';

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

  // 🔹 코어 영역 UI 상태
  const [coreVisible, setCoreVisible] = useState(false); // 첫 로딩 페이드인
  const [isCoreHovered, setIsCoreHovered] = useState(false);
  const [coreDevCursor, setCoreDevCursor] = useState<{ x: number; y: number } | null>(null);

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
    if (!bookmarksLoaded || !initialPageApplied) return;

    if (!currentUserUid || !uid || !wordbookPath) return;
    if (!text) return;

    const allLines = text.split('\n').filter(l => l.trim() !== '');
    if (allLines.length === 0) return;

    const { safePageIndex } = paginate(allLines, pageSize, pageIndex);
    const wordIndex = safePageIndex * pageSize;

    const viewerUid = currentUserUid;
    const basePath = `voca/${VITE_VOCA_ENV}/users/${viewerUid}/bookmarks`;
    const baseRef = rtdbRef(database, basePath);

    let id = bookmarkId;
    if (!id) {
      const newRef = push(baseRef);
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

  // 🔹 코어 영역 페이드인
  useEffect(() => {
    if (!loading && !error) {
      setCoreVisible(true);
    }
  }, [loading, error]);

  // 🔹 코어 영역 hover / 마우스 이동 핸들러 (DEV 전용 툴팁용)
  const handleCoreMouseEnter = () => {
    setIsCoreHovered(true);
  };

  const handleCoreMouseLeave = () => {
    setIsCoreHovered(false);
    setCoreDevCursor(null);
  };

  const handleCoreMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!import.meta.env.DEV) return;
    setCoreDevCursor({ x: e.clientX, y: e.clientY });
  };

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
      className="container wordlist-root"
      style={{
        maxWidth: 1080,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: '0.75rem',
        paddingBottom: '0.75rem',
      }}
    >
      {/* 최상단: 코어 타이틀 중앙 + 햄버거 메뉴 우측 상단 */}
      <div
        className="position-relative mb-3"
        style={{ minHeight: 40 }}
      >
        {/* 가운데 정렬된 코어 타이틀 */}
        <div className="d-flex justify-content-center">
          <div className="wordlist-core-title">
            <span className="wordlist-core-title-main">Word Flow Core</span>
            <span className="wordlist-core-title-sub">
              한 눈에 읽고, 느낌만 파악하고, 바로 다음 단어로 넘어가기.
            </span>
          </div>
        </div>

        {/* 햄버거 메뉴: 로그인한 본인만, 항상 우측 상단 */}
        {canEdit && (
          <div
            className="position-absolute"
            style={{ top: 0, right: 0 }}
          >
            <HamburgerMenu>
              <li>
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={() =>
                    nav(generatePath(ROUTE_USER_WORDS_EDIT, { uid }))
                  }
                >
                  단어장 수정
                </button>
              </li>

              <HamburgerDivider />

              <LogoutButton />
            </HamburgerMenu>
          </div>
        )}
      </div>

      {/* 중앙: 좌/우 페이지 네비 + 코어 단어 리스트 */}
      <div className="d-flex mt-2 mb-3 wordlist-core-row">
        {/* 왼쪽 여백 = 이전 페이지 */}
        <div
          onClick={goPrevPage}
          className="d-flex align-items-center justify-content-center wordlist-side-zone wordlist-side-zone-left"
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

        {/* 중앙 코어 영역 */}
        <div
          className={[
            'bg-black',
            'wordlist-core-zone',
            coreVisible ? 'wordlist-core-zone-visible' : '',
          ].join(' ')}
          onMouseEnter={handleCoreMouseEnter}
          onMouseLeave={handleCoreMouseLeave}
          onMouseMove={handleCoreMouseMove}
          style={{
            flexShrink: 0,
            maxWidth: 720,
            minWidth: 260,
            borderRadius: 10,
            padding: 6,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* 액자 느낌의 이너 프레임 */}
          <div className="wordlist-core-frame">
            <ul
              key={safePageIndex}
              className="wordlist-core-list"
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
                      className="wordlist-core-item"
                    >
                      {hasLink ? (
                        <a
                          href={link}
                          className="text-decoration-none wordlist-core-link"
                        >
                          <span className="fw-bold">{word}</span>
                        </a>
                      ) : (
                        <span className="fw-bold text-light wordlist-core-word">
                          {word}
                        </span>
                      )}
                    </li>,
                  );
                });

                // 마지막 페이지면 빈 줄로 패딩해서 꽉 채우기
                for (let i = 0; i < padCount; i++) {
                  items.push(
                    <li
                      key={`pad-${i}`}
                      className="wordlist-core-item wordlist-core-item-pad"
                    >
                      ·
                    </li>,
                  );
                }

                return items;
              })()}
            </ul>
          </div>
        </div>

        {/* 오른쪽 여백 = 다음 페이지 */}
        <div
          onClick={goNextPage}
          className="d-flex align-items-center justify-content-center wordlist-side-zone wordlist-side-zone-right"
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

      {/* 최하단: 페이지네이션 컨트롤 */}
      <div className="mt-auto pt-2 d-flex flex-column align-items-center">
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

      {/* 🔹 개발 모드 전용: 마우스 커서 옆에 Core Zone 툴팁 */}
      {VITE_VOCA_ENV !== VocaEnv.Prod && isCoreHovered && coreDevCursor && (
        <div
          className="wordlist-core-dev-badge"
          style={{
            position: 'fixed',
            left: coreDevCursor.x + 12,
            top: coreDevCursor.y + 12,
            zIndex: 9999,
            pointerEvents: 'none',
            width: 'fit-content',
            whiteSpace: 'nowrap',
          }}
        >
          Core Zone
        </div>
      )}
    </div>
  );
}
