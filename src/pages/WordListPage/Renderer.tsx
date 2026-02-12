// pages/WordListPage/Renderer.tsx
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

export default function WordListPageRenderer() {
  const {
    uid,
    resolvedFilename,
    nav,

    isContentReady,

    canEdit,
    isLoggedIn,

    error,
    loading,

    wordItemFontSize,

    pageSize,
    setPageSize,
    setPageIndex,

    viewLines,
    pagedLines,
    pageStart,
    totalPages,
    safePageIndex,

    hasPages,
    canCycle,
    prevPageNumber,
    nextPageNumber,

    goPrevPage,
    goNextPage,

    searchQuery,
    handleSearchChange,

    shuffleWordIndices,
    handleShuffle,
    handleShuffleClear,

    savePageBookmarkByIndex,

    showMyWordbooks,
    setShowMyWordbooks,
    showRecentWordbooks,
    setShowRecentWordbooks,
  } = useWordListPage();

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
                    onClick={() =>
                      nav(generatePath(ROUTE_USER_WORDS_EDIT, { uid, filename: resolvedFilename }))
                    }
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

            {uid && (
              <li>
                <button className="dropdown-item" type="button" onClick={() => setShowRecentWordbooks(true)}>
                  최근에 본 단어장들
                </button>
              </li>
            )}

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
          rawLines={[]} // WordListFrame이 rawLines 쓰면 Provider에서 rawLines도 넘겨서 여기서 연결해줘
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
