// pages/WordListPage/Renderer.tsx
import { useCallback, useRef } from 'react';
import { Link, generatePath } from 'react-router-dom';

import { ROUTE_SIGN_IN, ROUTE_USER_WORDS_EDIT } from '~/constants/routes';
import { PaginationControls } from '~/components/PaginationControls';
import { HamburgerMenu } from '~/components/HamburgerMenu';
import { HamburgerDivider } from '~/components/HamburgerDivider';
import { LogoutButton } from '~/components/LogoutButton';

import { WordListFrame } from './components/WordListFrame';
import { MyWordbooksModal } from './components/MyWordbooksModal';
import { RecentWordbooksModal } from './components/RecentWordbooksModal';

import { useWordListPage } from './Provider';
import { paginate } from '~/utils/editor';
import type { PageSize } from '~/types/editor';
import { useAuth } from '~/contexts/AuthContext';

export default function WordListPageRenderer() {
  const prevAuthUidRef = useRef<string | null | undefined>(undefined);

  const {
    uid,
    resolvedFilename,
    nav,

    error,
    loading,

    wordItemFontSize,

    pageSize,
    pageIndex,
    setPageIndex,
    setPageSize,

    bookmarksLoaded,
    initialPageApplied,

    searchQuery,
    setSearchQuery,

    shuffleWordIndices,
    setShuffleWordIndices,

    rawLines,
    viewLines,

    wordbookPath,
    saveBookmark,

    isContentReady,

    showMyWordbooks,
    setShowMyWordbooks,
    showRecentWordbooks,
    setShowRecentWordbooks,
  } = useWordListPage();

  const { currentUserUid } = useAuth();

  const {
    totalPages,
    safePageIndex,
    pageStart,
    pagedItems: pagedLines,
  } = paginate(viewLines, pageSize, pageIndex);

  const canEdit = currentUserUid === uid;
  const isLoggedIn = !!currentUserUid;

  const hasPages = totalPages > 0;
  const canCycle = totalPages > 1;
  const currentPage = hasPages ? safePageIndex + 1 : 0;

  const prevPageNumber = hasPages
    ? (canCycle ? (currentPage === 1 ? totalPages : currentPage - 1) : currentPage)
    : 0;

  const nextPageNumber = hasPages
    ? (canCycle ? (currentPage === totalPages ? 1 : currentPage + 1) : currentPage)
    : 0;


  // Renderer로 이동: 검색 변경
  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);

    // 규칙: 검색 변경 시 셔플 초기화
    if (shuffleWordIndices !== null) {
      setShuffleWordIndices(null);
    }

    // 규칙: 검색하면 페이지 0
    setPageIndex(0);

    // 규칙: 검색 순간 북마크 저장 (undefined 금지 → Provider의 stripUndefinedDeep가 처리)
    saveBookmark({
      wordIndex: 0,
      searchQuery: q,
      shuffleWordIndices: null,
    }).catch(err => console.error('[bookmark] save on search change', err));
  }, [setSearchQuery, shuffleWordIndices, setShuffleWordIndices, setPageIndex, saveBookmark]);

  // Renderer로 이동: 셔플 생성/저장
  const handleShuffle = useCallback(() => {
    const q = searchQuery.trim().toLowerCase();

    // “필터만” 반영된 base 만들기 (원본 rawLines 기준)
    const filterOnly: number[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (!q || line.toLowerCase().includes(q)) filterOnly.push(i);
    }

    // Fisher–Yates shuffle
    for (let i = filterOnly.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filterOnly[i], filterOnly[j]] = [filterOnly[j], filterOnly[i]];
    }

    setShuffleWordIndices(filterOnly);
    setPageIndex(0);

    saveBookmark({ wordIndex: 0, shuffleWordIndices: filterOnly }).catch(err =>
      console.error('[Bookmark] save shuffle failed', err),
    );
  }, [searchQuery, rawLines, setShuffleWordIndices, setPageIndex, saveBookmark]);

  // Renderer로 이동: 셔플 해제/저장
  const handleShuffleClear = useCallback(() => {
    setShuffleWordIndices(null);
    setPageIndex(0);

    // 여기서 []를 저장하는 정책 유지 (서버에 “명시적 해제” 기록)
    saveBookmark({ wordIndex: 0, shuffleWordIndices: [] }).catch(err =>
      console.error('[Bookmark] clear shuffle failed', err),
    );
  }, [setShuffleWordIndices, setPageIndex, saveBookmark]);

  const savePageBookmarkByIndex = useCallback(
    async (pageIndexToSave: number, pageSizeToSave: PageSize) => {
      if (!bookmarksLoaded || !initialPageApplied) return;
      if (!uid || !wordbookPath) return;
      if (viewLines.length === 0) return;

      // ✅ auth 전환 순간(로그인/로그아웃 직후)에는 저장하지 않음
      const prevUid = prevAuthUidRef.current;
      if (prevUid === undefined) {
        prevAuthUidRef.current = currentUserUid ?? null;
        return;
      }
      if (prevUid !== (currentUserUid ?? null)) {
        prevAuthUidRef.current = currentUserUid ?? null;
        return;
      }

      const { safePageIndex } = paginate(viewLines, pageSizeToSave, pageIndexToSave);
      const wordIndex = safePageIndex * pageSizeToSave;

      await saveBookmark({ wordIndex });
    },
    [
      bookmarksLoaded,
      initialPageApplied,
      uid,
      wordbookPath,
      viewLines,
      currentUserUid,
      saveBookmark,
    ],
  );

  const goPrevPage = useCallback(() => {
    if (!canCycle) return;
    const next = pageIndex > 0 ? pageIndex - 1 : totalPages - 1;
    setPageIndex(next);
    savePageBookmarkByIndex(next, pageSize).catch(err => console.error('[Bookmark] save failed', err));
  }, [canCycle, pageIndex, totalPages, setPageIndex, savePageBookmarkByIndex, pageSize]);

  const goNextPage = useCallback(() => {
    if (!canCycle) return;
    const next = pageIndex < totalPages - 1 ? pageIndex + 1 : 0;
    setPageIndex(next);
    savePageBookmarkByIndex(next, pageSize).catch(err => console.error('[Bookmark] save failed', err));
  }, [canCycle, pageIndex, totalPages, setPageIndex, savePageBookmarkByIndex, pageSize]);

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

  if (loading || !isContentReady) {
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
                <button className="dropdown-item" type="button" onClick={handleShuffleClear}>
                  단어 섞기 해제
                </button>
              </li>
            )}

            {canEdit && uid && (
              <>
                <li>
                  <button
                    className="dropdown-item"
                    type="button"
                    onClick={() => nav(generatePath(ROUTE_USER_WORDS_EDIT, { uid, filename: resolvedFilename }))}
                  >
                    단어장 수정
                  </button>
                </li>

                <li>
                  <button className="dropdown-item" type="button" onClick={() => setShowMyWordbooks(true)}>
                    내 단어장들
                  </button>
                </li>
              </>
            )}

            <li>
              <button className="dropdown-item" type="button" onClick={() => setShowRecentWordbooks(true)}>
                최근에 본 단어장들
              </button>
            </li>

            <HamburgerDivider />

            {isLoggedIn ? (
              <LogoutButton />
            ) : (
              <li>
                <button className="dropdown-item" type="button" onClick={() => nav(ROUTE_SIGN_IN)}>
                  로그인
                </button>
              </li>
            )}
          </HamburgerMenu>
        </div>
      </div>

      <div className="d-flex mt-2 mb-3 wordlist-core-row">
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
          coreVisible={true}
          viewLines={viewLines}
          pagedLines={pagedLines}
          pageStart={pageStart}
          pageSize={pageSize}
          safePageIndex={safePageIndex}
          totalPages={totalPages}
          rawLines={rawLines}
        />

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
        <div style={{ width: '100%', maxWidth: 200 }} className="mb-2">
          <input
            className="form-control bg-black text-light"
            placeholder="단어 검색"
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
          />
        </div>

        <PaginationControls
          pageSize={pageSize}
          pageIndex={safePageIndex}
          totalPages={totalPages}
          onPageSizeChange={size => {
            setPageSize(size);
            setPageIndex(0);
            savePageBookmarkByIndex(0, size).catch(err => console.error('[Bookmark] save failed', err));
          }}
          onPageIndexChange={next => {
            setPageIndex(next);
            savePageBookmarkByIndex(next, pageSize).catch(err => console.error('[Bookmark] save failed', err));
          }}
        />
      </div>

      {showMyWordbooks && uid && (
        <MyWordbooksModal
          uid={uid}
          currentFilename={resolvedFilename}
          onClose={() => setShowMyWordbooks(false)}
          onMove={(nextFilename) => {
            setShowMyWordbooks(false);
            nav(generatePath('/user/:uid/word/:filename', { uid, filename: nextFilename }));
          }}
        />
      )}

      {showRecentWordbooks && uid && (
        <RecentWordbooksModal
          currentUid={uid}
          currentFilename={resolvedFilename}
          onClose={() => setShowRecentWordbooks(false)}
          onMove={(targetUid, targetFilename) => {
            setShowRecentWordbooks(false);
            nav(generatePath('/user/:uid/word/:filename', { uid: targetUid, filename: targetFilename }));
          }}
        />
      )}
    </div>
  );
}
