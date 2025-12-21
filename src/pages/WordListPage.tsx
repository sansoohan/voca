// WordListPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link, generatePath } from 'react-router-dom';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { ref as rtdbRef, get, push, set as rtdbSet } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';

import { auth, VITE_VOCA_ENV, storage, database } from '~/constants/firebase';
import { ROUTE_SIGN_IN, ROUTE_USER_WORDS_EDIT } from '~/constants/routes';
import type { PageSize } from '~/types/editor';
import { computeInitialPageSize, paginate } from '~/utils/editor';
import { PaginationControls } from '~/components/PaginationControls';
import { getDefaultWordbookPath } from '~/utils/storage';
import { HamburgerMenu } from '~/components/HamburgerMenu';
import { HamburgerDivider } from '~/components/HamburgerDivider';
import { LogoutButton } from '~/components/LogoutButton';
import { readBookmarkIndexDb, updateBookmarkIndexDb, stripUndefinedDeep } from '~/utils/bookmarkIdb';
import type { Bookmark } from '~/types/bookmark';
import { useApp } from '~/contexts/AppContext';
import { DefaultWordItemHeight } from '~/constants/editor';
import { WordListFrame } from './WordListPage/components/WordListFrame';

import './WordListPage.css';

export function WordListPage() {
  const { uid } = useParams<{ uid: string }>();
  const nav = useNavigate();

  const [text, setText] = useState<string>('');
  const [currentUserUid, setCurrentUserUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const { isMobile } = useApp();
  const wordItemRatio = isMobile ? 0.75 : 0.92;
  const wordItemPaddingVertical = 3.2;
  const wordItemHeight = DefaultWordItemHeight * wordItemRatio + wordItemPaddingVertical;
  const wordItemFontSize = `${wordItemRatio}rem`;

  // 한 페이지에 최대 단어 수
  const [pageSize, setPageSize] = useState<PageSize>(computeInitialPageSize(157, wordItemHeight));
  const [pageIndex, setPageIndex] = useState(0); // 0-based

  // 🔹 북마크 상태
  const [bookmarkWordIndex, setBookmarkWordIndex] = useState<number | null>(null);
  const [bookmarkId, setBookmarkId] = useState<string | null>(null); // (RTDB only)
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const [initialPageApplied, setInitialPageApplied] = useState(false);

  // 🔹 검색/셔플 상태 (북마크에 함께 저장)
  const [searchQuery, setSearchQuery] = useState<string>(''); // '' = no filter
  const [shuffleWordIndices, setShuffleWordIndices] = useState<number[] | null>(null);

  // ✅ 로그인/로그아웃 전환 프레임에서는 저장 금지하기 위한 ref
  const prevAuthUidRef = useRef<string | null | undefined>(undefined);

  const wordbookPath = uid ? getDefaultWordbookPath(uid) : null;

  // -------------------------
  // Auth
  // -------------------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      setCurrentUserUid(user?.uid ?? null);
    });
    return () => unsub();
  }, []);

  // -------------------------
  // Storage: wordbook text load
  // -------------------------
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

  // -------------------------
  // Helpers: parse lines
  // -------------------------
  const rawLines = useMemo(() => {
    return text.split('\n').filter(l => l.trim() !== '');
  }, [text]);

  /**
   * 필터/셔플 적용 후 “보기용 순서”를 만든다.
   * - searchQuery: 포함 문자열 필터 (word + link 전체 line 기준; 원하면 word만으로 바꿔도 됨)
   * - shuffleWordIndices: “원본 인덱스 배열”
   *
   * 규칙:
   * - 배열에 있는 인덱스 중 존재하지 않는 건 skip
   * - 배열 길이까지만 셔플 적용 + 이후 추가된 단어는 자연 순서로 뒤에 붙음
   */
  const viewIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    // 1) base indices: filter
    const base: number[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (!q) {
        base.push(i);
      } else {
        if (line.toLowerCase().includes(q)) base.push(i);
      }
    }

    // 2) shuffle 적용
    if (!shuffleWordIndices || shuffleWordIndices.length === 0) {
      return base;
    }

    const baseSet = new Set(base);
    const used = new Set<number>();
    const ordered: number[] = [];

    // shuffle 배열 순서대로 “base에 존재하는 것만”
    for (const idx of shuffleWordIndices) {
      if (!baseSet.has(idx)) continue;
      if (idx < 0 || idx >= rawLines.length) continue;
      if (used.has(idx)) continue;
      ordered.push(idx);
      used.add(idx);
    }

    // 나머지는 자연 순서로 append (추가된 단어 포함)
    for (const idx of base) {
      if (used.has(idx)) continue;
      ordered.push(idx);
      used.add(idx);
    }

    return ordered;
  }, [rawLines, searchQuery, shuffleWordIndices]);

  const viewLines = useMemo(() => {
    return viewIndices.map(i => rawLines[i]);
  }, [rawLines, viewIndices]);

  const saveBookmark = useCallback(async (next: Partial<Bookmark>) => {
    if (!wordbookPath) return;

    // 반드시 값이 들어가도록(=undefined 금지)
    const wordIndex = typeof next.wordIndex === 'number' && Number.isFinite(next.wordIndex) ? next.wordIndex : 0;

    const bookmark = stripUndefinedDeep<Bookmark>({
      wordbookPath,
      wordIndex,
      updatedAt: Date.now(),
      searchQuery: next.searchQuery !== undefined ? next.searchQuery : searchQuery,
      shuffleWordIndices: next.shuffleWordIndices !== undefined
        ? next.shuffleWordIndices : shuffleWordIndices ?? undefined,
    });

    // 로그인 → RTDB
    if (currentUserUid) {
      const viewerUid = currentUserUid;
      const basePath = `voca/${VITE_VOCA_ENV}/users/${viewerUid}/bookmarks`;
      const baseRef = rtdbRef(database, basePath);

      let id = bookmarkId;
      if (!id) {
        const newRef = push(baseRef);
        id = newRef.key!;
        setBookmarkId(id);
      }

      const bookmarkRef = rtdbRef(database, `${basePath}/${id}`);

      await rtdbSet(bookmarkRef, bookmark);

      return;
    }

    // 비로그인 → IDB (guest-only)
    await updateBookmarkIndexDb(bookmark, null);
  }, [bookmarkId, currentUserUid, searchQuery, shuffleWordIndices, wordbookPath]);

  // 북마크 읽기 트리거
  useEffect(() => {
    if (!uid || !wordbookPath) return;

    let cancelled = false;

    const loadBookmarkUnified = async () => {
      // 비로그인 → IDB
      if (!currentUserUid) {
        try {
          const bookmark = await readBookmarkIndexDb(wordbookPath, null);
          if (cancelled) return;

          if (bookmark) {
            setBookmarkWordIndex(typeof bookmark.wordIndex === 'number' ? bookmark.wordIndex : 0);
            setSearchQuery(typeof bookmark.searchQuery === 'string' ? bookmark.searchQuery : '');
            setShuffleWordIndices(Array.isArray(bookmark.shuffleWordIndices) ? bookmark.shuffleWordIndices : null);
          } else {
            setBookmarkWordIndex(null);
            setSearchQuery('');
            setShuffleWordIndices(null);
          }
        } catch (e) {
          console.error('[IDB] load failed', e);
          if (!cancelled) {
            setBookmarkWordIndex(null);
            setSearchQuery('');
            setShuffleWordIndices(null);
          }
        } finally {
          if (!cancelled) setBookmarksLoaded(true);
        }
        return;
      }

      // 로그인 → RTDB
      try {
        const viewerUid = currentUserUid;
        const basePath = `voca/${VITE_VOCA_ENV}/users/${viewerUid}/bookmarks`;
        const snap = await get(rtdbRef(database, basePath));
        if (cancelled) return;

        if (!snap.exists()) {
          setBookmarkId(null);
          setBookmarkWordIndex(null);
          setSearchQuery('');
          setShuffleWordIndices(null);
          setBookmarksLoaded(true);
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

        if (!best) {
          setBookmarkId(null);
          setBookmarkWordIndex(null);
          setSearchQuery('');
          setShuffleWordIndices(null);
          setBookmarksLoaded(true);
          return;
        }

        setBookmarkId(best.key);
        setBookmarkWordIndex(best.data.wordIndex ?? 0);
        setSearchQuery(best.data.searchQuery ?? '');
        setShuffleWordIndices(Array.isArray(best.data.shuffleWordIndices) ? best.data.shuffleWordIndices : null);
        setBookmarksLoaded(true);
      } catch (e) {
        console.error('[RTDB] load failed', e);
        if (!cancelled) {
          setBookmarkId(null);
          setBookmarkWordIndex(null);
          setSearchQuery('');
          setShuffleWordIndices(null);
          setBookmarksLoaded(true);
        }
      }
    };

    setBookmarksLoaded(false);
    setInitialPageApplied(false);
    loadBookmarkUnified();

    return () => {
      cancelled = true;
    };
  }, [uid, wordbookPath, currentUserUid]);

  // -------------------------
  // 🔹 북마크(wordIndex) → 초기 pageIndex 반영 (딱 1번)
  // - “보기용(viewLines)” 기준으로 계산
  // -------------------------
  useEffect(() => {
    if (loading) return;                // text 로딩 끝난 다음에만
    if (!bookmarksLoaded) return;
    if (initialPageApplied) return;

    // viewLines는 text+검색+셔플이 반영된 “현재 보기”
    if (!viewLines) return;

    // text 로딩은 끝났는데 단어가 진짜 0개인 경우만 여기서 적용 완료 처리
    if (viewLines.length === 0) {
      setPageIndex(0);
      setInitialPageApplied(true);
      return;
    }

    // 북마크 없음 → 0페이지
    if (bookmarkWordIndex == null) {
      setPageIndex(0);
      setInitialPageApplied(true);
      return;
    }

    let idx = bookmarkWordIndex;
    if (idx < 0) idx = 0;
    if (idx >= viewLines.length) idx = viewLines.length - 1;

    const totalPages = Math.max(1, Math.ceil(viewLines.length / pageSize));
    let newPageIndex = Math.floor(idx / pageSize);
    if (newPageIndex < 0) newPageIndex = 0;
    if (newPageIndex >= totalPages) newPageIndex = totalPages - 1;

    setPageIndex(newPageIndex);
    setInitialPageApplied(true);
  }, [
    loading,
    bookmarksLoaded,
    initialPageApplied,
    bookmarkWordIndex,
    viewLines,
    pageSize,
  ]);

  // -------------------------
  // 페이지 변경 시 저장 (RTDB/IDB)
  // -------------------------
  useEffect(() => {
    if (!bookmarksLoaded || !initialPageApplied) return;
    if (!uid || !wordbookPath) return;

    // ✅ auth 전환(로그인/로그아웃) 프레임에서는 저장 금지
    // - 첫 실행(undef)도 스킵해서 "초기 로딩 직후 불필요 저장"도 줄임
    const prevUid = prevAuthUidRef.current;
    if (prevUid === undefined) {
      prevAuthUidRef.current = currentUserUid ?? null;
      return;
    }
    if (prevUid !== (currentUserUid ?? null)) {
      prevAuthUidRef.current = currentUserUid ?? null;
      return;
    }

    // viewLines 기준으로 저장
    if (viewLines.length === 0) return;

    const { safePageIndex } = paginate(viewLines, pageSize, pageIndex);
    const wordIndex = safePageIndex * pageSize;

    saveBookmark({ wordIndex }).catch(err => {
      console.error('[Bookmark] save failed', err);
    });
  }, [
    pageIndex,
    pageSize,
    uid,
    wordbookPath,
    bookmarksLoaded,
    initialPageApplied,
    currentUserUid, // ✅ auth 전환 감지용(guard)
    viewLines,
    saveBookmark,
  ]);

  // -------------------------
  // Navigation actions
  // -------------------------
  const canEdit = currentUserUid === uid;
  const isLoggedIn = !!currentUserUid;

  const {
    totalPages,
    safePageIndex,
    pageStart,
    pagedItems: pagedLines,
  } = paginate(viewLines, pageSize, pageIndex);

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

  // -------------------------
  // Search handlers (검색 시 페이지 초기화 + 즉시 북마크 저장)
  // -------------------------
  const handleSearchChange = (q: string) => {
    setSearchQuery(q);

    // 규칙: 검색 변경 시 셔플은 무조건 해제
    if (shuffleWordIndices !== null) {
      setShuffleWordIndices(null);
    }

    // 검색하면 위치 초기화 (pageIndex 기반이라도 결국 wordIndex=0 저장)
    setPageIndex(0);

    // 북마크에 즉시 기록 (undefined 절대 금지: null 명시)
    saveBookmark({
      wordIndex: 0,
      searchQuery: q,
      shuffleWordIndices: null,
    }).catch(err => console.error('[bookmark] save on search change', err));
  };

  // -------------------------
  // Shuffle handlers (파일 변경 X, 북마크 레벨에서만 셔플)
  // -------------------------
  const handleShuffle = () => {
    const q = searchQuery.trim().toLowerCase();
    const filterOnly: number[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (!q || line.toLowerCase().includes(q)) filterOnly.push(i);
    }

    // Fisher-Yates
    for (let i = filterOnly.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filterOnly[i], filterOnly[j]] = [filterOnly[j], filterOnly[i]];
    }

    setShuffleWordIndices(filterOnly);
    setPageIndex(0);

    // “셔플 누르는 순간” 북마크에 기록
    saveBookmark({ wordIndex: 0, shuffleWordIndices: filterOnly }).catch(
      err => console.error('[Bookmark] save shuffle failed', err),
    );
  };

  const handleShuffleClear = () => {
    setShuffleWordIndices(null);
    setPageIndex(0);

    saveBookmark({ wordIndex: 0, shuffleWordIndices: [] }).catch(err =>
      console.error('[Bookmark] clear shuffle failed', err),
    );
  };

  // -------------------------
  // Render states
  // -------------------------
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
      <div className="position-relative mb-3" style={{ minHeight: 40 }}>
        <div className="d-flex justify-content-center">
          <div className="wordlist-core-title">
            <span className="wordlist-core-title-main">Word Flow Core</span>
            <span className="wordlist-core-title-sub">
              한 눈에 읽고, 느낌만 파악하고, 바로 다음 단어로 넘어가기.
            </span>
          </div>
        </div>

        <div className="position-absolute" style={{ top: 0, right: 0 }}>
          <HamburgerMenu>
            <li>
              <button className="dropdown-item" type="button" onClick={handleShuffle}>
                단어 섞기
              </button>
            </li>

            {shuffleWordIndices && shuffleWordIndices.length > 0 && (
              <li>
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={handleShuffleClear}
                >
                  단어 섞기 해제
                </button>
              </li>
            )}

            {canEdit && (
              <>
                <li>
                  <button
                    className="dropdown-item"
                    type="button"
                    onClick={() => nav(generatePath(ROUTE_USER_WORDS_EDIT, { uid }))}
                  >
                    단어장 수정
                  </button>
                </li>
              </>
            )}

            <HamburgerDivider />

            {isLoggedIn ? (
              <LogoutButton />
            ):(
              <li>
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={() => nav(ROUTE_SIGN_IN)}
                >
                  로그인
                </button>
              </li>
            )}
          </HamburgerMenu>
        </div>
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

        <WordListFrame
          wordItemFontSize={wordItemFontSize}
          coreVisible={!loading && !error}
          viewLines={viewLines}
          pagedLines={pagedLines}
          pageStart={pageStart}
          pageSize={pageSize}
          safePageIndex={safePageIndex}
          totalPages={totalPages}
          rawLines={rawLines}
        />

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


      <div className="mt-auto pt-2 d-flex flex-column align-items-center">
        {/* 페이지네이션 바로 위: 검색란 */}
        <div style={{ width: '100%', maxWidth: 200 }} className='mb-2'>
          <input
            className="form-control bg-black text-light"
            placeholder="단어 검색"
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
          />
        </div>

        {/* 페이지네이션 컨트롤 */}
        <PaginationControls
          pageSize={pageSize}
          pageIndex={safePageIndex}
          totalPages={totalPages}
          onPageSizeChange={size => {
            setPageSize(size);
            setPageIndex(0);
            saveBookmark({ wordIndex: 0 }).catch(console.error);
          }}
          onPageIndexChange={setPageIndex}
        />
      </div>
    </div>
  );
}
