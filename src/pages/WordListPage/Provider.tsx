// pages/WordListPage/Provider.tsx
import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref as storageRef } from 'firebase/storage';
import { ref as rtdbRef, get, push, set as rtdbSet } from 'firebase/database';

import { useApp } from '~/contexts/AppContext';
import { useAuth } from '~/contexts/AuthContext';
import { VITE_VOCA_ENV, storage, database } from '~/constants/firebase';
import type { PageSize } from '~/types/editor';
import { computeInitialPageSize, paginate } from '~/utils/editor';
import { getWordbookPath } from '~/utils/storage';
import { readBookmarkIndexDb, updateBookmarkIndexDb, stripUndefinedDeep } from '~/utils/bookmarkIdb';
import type { Bookmark } from '~/types/bookmark';
import { DefaultWordItemHeight } from '~/constants/editor';
import { loadWordbookTextCached } from '~/utils/wordbookIdb';
import { writeLastWordbook } from '~/utils/userWordbookIdb';

type WordListPageContextValue = {
  // route & navigation
  uid: string | undefined;
  resolvedFilename: string;
  nav: ReturnType<typeof useNavigate>;

  // rendering readiness
  isContentReady: boolean;

  // auth
  currentUserUid: string | null;
  canEdit: boolean;
  isLoggedIn: boolean;

  // load states
  text: string;
  error: string | null;
  loading: boolean;

  // ui sizing
  wordItemFontSize: string;

  // pagination
  pageSize: PageSize;
  pageIndex: number;
  setPageIndex: React.Dispatch<React.SetStateAction<number>>;
  setPageSize: React.Dispatch<React.SetStateAction<PageSize>>;

  // bookmark states
  bookmarksLoaded: boolean;
  initialPageApplied: boolean;

  // search/shuffle
  searchQuery: string;
  shuffleWordIndices: number[] | null;

  // derived lines
  rawLines: string[];
  viewLines: string[];
  pageStart: number;
  pagedLines: string[];
  totalPages: number;
  safePageIndex: number;

  // page nav labels
  hasPages: boolean;
  canCycle: boolean;
  prevPageNumber: number;
  nextPageNumber: number;

  // handlers
  goPrevPage: () => void;
  goNextPage: () => void;
  handleSearchChange: (q: string) => void;
  handleShuffle: () => void;
  handleShuffleClear: () => void;

  // bookmark helper used by renderer for pagination changes
  savePageBookmarkByIndex: (pageIndexToSave: number, pageSizeToSave: PageSize) => Promise<void>;

  // modal controls
  showMyWordbooks: boolean;
  setShowMyWordbooks: React.Dispatch<React.SetStateAction<boolean>>;
  showRecentWordbooks: boolean;
  setShowRecentWordbooks: React.Dispatch<React.SetStateAction<boolean>>;
};

const WordListPageContext = createContext<WordListPageContextValue | null>(null);

export function useWordListPage() {
  const ctx = useContext(WordListPageContext);
  if (!ctx) throw new Error('useWordListPage must be used within WordListPageProvider');
  return ctx;
}

export function WordListPageProvider({ children }: { children: React.ReactNode }) {
  const { uid, filename } = useParams<{ uid: string; filename?: string }>();
  const resolvedFilename: string = filename ?? 'default.txt';
  const nav = useNavigate();

  const { user } = useAuth();
  const currentUserUid = user?.uid ?? null;

  const [text, setText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const { isMobile } = useApp();
  const wordItemRatio = isMobile ? 0.75 : 0.92;
  const wordItemPaddingVertical = 3.2;
  const wordItemHeight = DefaultWordItemHeight * wordItemRatio + wordItemPaddingVertical;
  const wordItemFontSize = `${wordItemRatio}rem`;

  const [pageSize, setPageSize] = useState<PageSize>(computeInitialPageSize(157, wordItemHeight));
  const [pageIndex, setPageIndex] = useState(0);

  // bookmark states
  const [bookmarkWordIndex, setBookmarkWordIndex] = useState<number | null>(null);
  const [bookmarkId, setBookmarkId] = useState<string | null>(null); // (RTDB only)
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const [initialPageApplied, setInitialPageApplied] = useState(false);

  // search/shuffle states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [shuffleWordIndices, setShuffleWordIndices] = useState<number[] | null>(null);

  const prevAuthUidRef = useRef<string | null | undefined>(undefined);

  const [showMyWordbooks, setShowMyWordbooks] = useState(false);
  const [showRecentWordbooks, setShowRecentWordbooks] = useState(false);

  const wordbookPath = (uid && resolvedFilename) ? getWordbookPath(uid, resolvedFilename) : null;

  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    // useAuth()가 한 번이라도 값(로그인/비로그인)을 내놓으면 true
    // (user가 null이어도 “비로그인 확정”이므로 ready)
    setAuthReady(true);
  }, [user]);

  const isContentReady = useMemo(() => {
    // 에러면 그냥 에러를 보여주면 되므로 ready 취급
    if (error) return true;
    // loading 끝 + 북마크 로드 끝 + 초기 page 적용 끝이어야 리스트 렌더 OK
    return !loading && bookmarksLoaded && initialPageApplied;
  }, [loading, error, bookmarksLoaded, initialPageApplied]);

  // -------------------------
  // Storage: wordbook text load (cached)
  // -------------------------
  useEffect(() => {
    if (!uid || !resolvedFilename) return;
    if (!authReady) return; // ✅ auth 확정 전엔 fetch 하지 않음

    const fetchText = async () => {
      setLoading(true);
      try {
        const path = getWordbookPath(uid, resolvedFilename);
        const fileRef = storageRef(storage, path);

        const { text: txt } = await loadWordbookTextCached(fileRef);
        setText(txt ?? '');
        setError(null);
      } catch (e: any) {
        console.error(e);

        if (e.code === 'storage/object-not-found') {
          // ✅ 본인 단어장이면 “없는 게 정상”일 수 있음 → 빈 단어장으로 시작
          if (currentUserUid && currentUserUid === uid) {
            setText('');
            setError(null);
          } else {
            setError('해당 단어장을 찾을 수 없습니다.');
            setText('');
          }
        } else {
          setError('단어장을 불러오는 중 오류가 발생했습니다.');
          setText('');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchText();
  }, [uid, resolvedFilename, authReady, currentUserUid]);

  // -------------------------
  // Helpers: parse lines
  // -------------------------
  const rawLines = useMemo(() => text.split('\n').filter(l => l.trim() !== ''), [text]);

  const viewIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    // 1) base indices: filter
    const base: number[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (!q || line.toLowerCase().includes(q)) base.push(i);
    }

    // 2) shuffle 적용
    if (!shuffleWordIndices || shuffleWordIndices.length === 0) return base;

    const baseSet = new Set(base);
    const used = new Set<number>();
    const ordered: number[] = [];

    for (const idx of shuffleWordIndices) {
      if (!baseSet.has(idx)) continue;
      if (idx < 0 || idx >= rawLines.length) continue;
      if (used.has(idx)) continue;
      ordered.push(idx);
      used.add(idx);
    }

    for (const idx of base) {
      if (used.has(idx)) continue;
      ordered.push(idx);
      used.add(idx);
    }

    return ordered;
  }, [rawLines, searchQuery, shuffleWordIndices]);

  const viewLines = useMemo(() => viewIndices.map(i => rawLines[i]), [rawLines, viewIndices]);

  // -------------------------
  // saveBookmark (RTDB / IDB)
  // -------------------------
  const saveBookmark = useCallback(async (next: Partial<Bookmark>) => {
    if (!wordbookPath) return;

    const wordIndex =
      typeof next.wordIndex === 'number' && Number.isFinite(next.wordIndex) ? next.wordIndex : 0;

    const bookmark = stripUndefinedDeep<Bookmark>({
      wordbookPath,
      wordIndex,
      updatedAt: Date.now(),
      searchQuery: next.searchQuery !== undefined ? next.searchQuery : searchQuery,
      shuffleWordIndices:
        next.shuffleWordIndices !== undefined
          ? (next.shuffleWordIndices ?? undefined)
          : (shuffleWordIndices ?? undefined),
    });

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

    // guest-only
    await updateBookmarkIndexDb(bookmark, null);
  }, [wordbookPath, currentUserUid, bookmarkId, searchQuery, shuffleWordIndices]);

  // -------------------------
  // load bookmark (RTDB / IDB)
  // -------------------------
  useEffect(() => {
    if (!uid || !wordbookPath) return;
    if (loading) return;

    if (error) {
      setBookmarksLoaded(true);
      setInitialPageApplied(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setBookmarksLoaded(false);
      setInitialPageApplied(false);

      // guest -> IDB
      if (!currentUserUid) {
        try {
          const bookmark = await readBookmarkIndexDb(wordbookPath, null);
          if (cancelled) return;

          if (bookmark) {
            setBookmarkWordIndex(typeof bookmark.wordIndex === 'number' ? bookmark.wordIndex : 0);
            setSearchQuery(typeof bookmark.searchQuery === 'string' ? bookmark.searchQuery : '');
            setShuffleWordIndices(Array.isArray(bookmark.shuffleWordIndices) ? bookmark.shuffleWordIndices : null);
          } else {
            const created: Bookmark = stripUndefinedDeep<Bookmark>({
              wordbookPath,
              wordIndex: 0,
              updatedAt: Date.now(),
              searchQuery: '',
              shuffleWordIndices: undefined,
            });

            await updateBookmarkIndexDb(created, null);
            if (cancelled) return;

            setBookmarkWordIndex(0);
            setSearchQuery('');
            setShuffleWordIndices(null);
          }
        } catch (e) {
          console.error('[IDB] load failed', e);
          if (!cancelled) {
            setBookmarkWordIndex(0);
            setSearchQuery('');
            setShuffleWordIndices(null);
          }
        } finally {
          if (!cancelled) setBookmarksLoaded(true);
        }
        return;
      }

      // login -> RTDB
      try {
        const viewerUid = currentUserUid;
        const basePath = `voca/${VITE_VOCA_ENV}/users/${viewerUid}/bookmarks`;
        const baseRef = rtdbRef(database, basePath);

        const snap = await get(baseRef);
        if (cancelled) return;

        if (!snap.exists()) {
          const created: Bookmark = stripUndefinedDeep<Bookmark>({
            wordbookPath,
            wordIndex: 0,
            updatedAt: Date.now(),
            searchQuery: '',
            shuffleWordIndices: undefined,
          });

          const newRef = push(baseRef);
          const newKey = newRef.key!;
          await rtdbSet(rtdbRef(database, `${basePath}/${newKey}`), created);

          if (cancelled) return;

          setBookmarkId(newKey);
          setBookmarkWordIndex(0);
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
          const created: Bookmark = stripUndefinedDeep<Bookmark>({
            wordbookPath,
            wordIndex: 0,
            updatedAt: Date.now(),
            searchQuery: '',
            shuffleWordIndices: undefined,
          });

          const newRef = push(baseRef);
          const newKey = newRef.key!;
          await rtdbSet(rtdbRef(database, `${basePath}/${newKey}`), created);

          if (cancelled) return;

          setBookmarkId(newKey);
          setBookmarkWordIndex(0);
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
          setBookmarkWordIndex(0);
          setSearchQuery('');
          setShuffleWordIndices(null);
          setBookmarksLoaded(true);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [uid, wordbookPath, currentUserUid, loading, error]);

  // -------------------------
  // bookmarkWordIndex -> initial pageIndex (once)
  // -------------------------
  useEffect(() => {
    if (loading) return;
    if (!bookmarksLoaded) return;
    if (initialPageApplied) return;

    if (viewLines.length === 0) {
      setPageIndex(0);
      setInitialPageApplied(true);
      return;
    }

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
  }, [loading, bookmarksLoaded, initialPageApplied, bookmarkWordIndex, viewLines, pageSize]);

  // -------------------------
  // save page bookmark (guarded)
  // -------------------------
  const savePageBookmarkByIndex = useCallback(async (pageIndexToSave: number, pageSizeToSave: PageSize) => {
    if (!bookmarksLoaded || !initialPageApplied) return;
    if (!uid || !wordbookPath) return;

    const prevUid = prevAuthUidRef.current;
    if (prevUid === undefined) {
      prevAuthUidRef.current = currentUserUid ?? null;
      return;
    }
    if (prevUid !== (currentUserUid ?? null)) {
      prevAuthUidRef.current = currentUserUid ?? null;
      return;
    }

    if (viewLines.length === 0) return;

    const { safePageIndex } = paginate(viewLines, pageSizeToSave, pageIndexToSave);
    const wordIndex = safePageIndex * pageSizeToSave;

    await saveBookmark({ wordIndex });
  }, [bookmarksLoaded, initialPageApplied, uid, wordbookPath, currentUserUid, viewLines, saveBookmark]);

  // -------------------------
  // write last opened wordbook (owner only)
  // -------------------------
  useEffect(() => {
    if (!uid) return;
    if (!currentUserUid) return;
    if (currentUserUid !== uid) return;

    const filenameToWrite = resolvedFilename;
    const fullPath = getWordbookPath(uid, filenameToWrite);

    writeLastWordbook(uid, filenameToWrite, fullPath).catch((e) => {
      console.error('[WordListPage] writeLastWordbook failed', e);
    });
  }, [uid, resolvedFilename, currentUserUid]);

  const canEdit = currentUserUid === uid;
  const isLoggedIn = !!currentUserUid;

  const { totalPages, safePageIndex, pageStart, pagedItems: pagedLines } = paginate(viewLines, pageSize, pageIndex);

  const hasPages = totalPages > 0;
  const canCycle = totalPages > 1;
  const currentPage = hasPages ? safePageIndex + 1 : 0;

  const prevPageNumber = hasPages
    ? canCycle
      ? currentPage === 1 ? totalPages : currentPage - 1
      : currentPage
    : 0;

  const nextPageNumber = hasPages
    ? canCycle
      ? currentPage === totalPages ? 1 : currentPage + 1
      : currentPage
    : 0;

  const goPrevPage = useCallback(() => {
    if (!canCycle) return;
    const next = pageIndex > 0 ? pageIndex - 1 : totalPages - 1;
    setPageIndex(next);
    savePageBookmarkByIndex(next, pageSize).catch(err => console.error('[Bookmark] save failed', err));
  }, [canCycle, pageIndex, totalPages, pageSize, savePageBookmarkByIndex]);

  const goNextPage = useCallback(() => {
    if (!canCycle) return;
    const next = pageIndex < totalPages - 1 ? pageIndex + 1 : 0;
    setPageIndex(next);
    savePageBookmarkByIndex(next, pageSize).catch(err => console.error('[Bookmark] save failed', err));
  }, [canCycle, pageIndex, totalPages, pageSize, savePageBookmarkByIndex]);

  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);

    if (shuffleWordIndices !== null) setShuffleWordIndices(null);

    setPageIndex(0);
    saveBookmark({
      wordIndex: 0,
      searchQuery: q,
      shuffleWordIndices: null,
    }).catch(err => console.error('[bookmark] save on search change', err));
  }, [shuffleWordIndices, saveBookmark]);

  const handleShuffle = useCallback(() => {
    const q = searchQuery.trim().toLowerCase();
    const filterOnly: number[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (!q || line.toLowerCase().includes(q)) filterOnly.push(i);
    }

    for (let i = filterOnly.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filterOnly[i], filterOnly[j]] = [filterOnly[j], filterOnly[i]];
    }

    setShuffleWordIndices(filterOnly);
    setPageIndex(0);
    saveBookmark({ wordIndex: 0, shuffleWordIndices: filterOnly }).catch(err =>
      console.error('[Bookmark] save shuffle failed', err),
    );
  }, [searchQuery, rawLines, saveBookmark]);

  const handleShuffleClear = useCallback(() => {
    setShuffleWordIndices(null);
    setPageIndex(0);
    saveBookmark({ wordIndex: 0, shuffleWordIndices: [] }).catch(err =>
      console.error('[Bookmark] clear shuffle failed', err),
    );
  }, [saveBookmark]);

  const value: WordListPageContextValue = {
    uid,
    resolvedFilename,
    nav,

    isContentReady,

    currentUserUid,
    canEdit,
    isLoggedIn,

    text,
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
    shuffleWordIndices,

    rawLines,
    viewLines,
    pageStart,
    pagedLines,
    totalPages,
    safePageIndex,

    hasPages,
    canCycle,
    prevPageNumber,
    nextPageNumber,

    goPrevPage,
    goNextPage,
    handleSearchChange,
    handleShuffle,
    handleShuffleClear,

    savePageBookmarkByIndex,

    showMyWordbooks,
    setShowMyWordbooks,
    showRecentWordbooks,
    setShowRecentWordbooks,
  };

  return (
    <WordListPageContext.Provider value={value}>
      {children}
    </WordListPageContext.Provider>
  );
}
