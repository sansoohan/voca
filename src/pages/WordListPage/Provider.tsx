// pages/WordListPage/Provider.tsx
import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref as storageRef } from 'firebase/storage';
import { ref as rtdbRef, get, push, set as rtdbSet } from 'firebase/database';

import { useApp } from '~/contexts/AppContext';
import { useAuth } from '~/contexts/AuthContext';
import { VITE_VOCA_ENV, storage, database } from '~/constants/firebase';
import type { PageSize } from '~/types/editor';
import { computeInitialPageSize } from '~/utils/editor';
import { getWordbookPath } from '~/utils/storage';
import { readBookmarkIndexDb, updateBookmarkIndexDb, stripUndefinedDeep } from '~/utils/bookmarkIdb';
import type { Bookmark } from '~/types/bookmark';
import { DefaultWordItemHeight } from '~/constants/editor';
import { loadWordbookTextCached } from '~/utils/wordbookIdb';
import { writeLastWordbook } from '~/utils/userWordbookIdb';

type WordListPageContextValue = {
  uid: string | undefined;
  resolvedFilename: string;
  nav: ReturnType<typeof useNavigate>;

  currentUserUid: string | null;

  text: string;
  error: string | null;
  loading: boolean;

  wordItemFontSize: string;

  pageSize: PageSize;
  pageIndex: number;
  setPageIndex: React.Dispatch<React.SetStateAction<number>>;
  setPageSize: React.Dispatch<React.SetStateAction<PageSize>>;

  bookmarksLoaded: boolean;
  initialPageApplied: boolean;

  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  shuffleWordIndices: number[] | null;
  setShuffleWordIndices: React.Dispatch<React.SetStateAction<number[] | null>>;

  rawLines: string[];
  viewLines: string[];

  wordbookPath: string | null;
  saveBookmark: (next: Partial<Bookmark>) => Promise<void>;

  isContentReady: boolean;

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

  const [bookmarkWordIndex, setBookmarkWordIndex] = useState<number | null>(null);
  const [bookmarkId, setBookmarkId] = useState<string | null>(null);
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const [initialPageApplied, setInitialPageApplied] = useState(false);

  // Renderer로 핸들러 빼기 위해 setter 유지
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [shuffleWordIndices, setShuffleWordIndices] = useState<number[] | null>(null);

  const [showMyWordbooks, setShowMyWordbooks] = useState(false);
  const [showRecentWordbooks, setShowRecentWordbooks] = useState(false);

  const wordbookPath = (uid && resolvedFilename) ? getWordbookPath(uid, resolvedFilename) : null;

  const isContentReady = useMemo(() => {
    // 에러면 그냥 에러를 보여주면 되므로 ready 취급
    if (error) return true;
    // loading 끝 + 북마크 로드 끝 + 초기 page 적용 끝이어야 리스트 렌더 OK
    return !loading && bookmarksLoaded && initialPageApplied;
  }, [loading, error, bookmarksLoaded, initialPageApplied]);

  useEffect(() => {
    if (!uid || !resolvedFilename) return;

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
          setError('해당 단어장을 찾을 수 없습니다.');
          setText('');
        } else {
          setError('단어장을 불러오는 중 오류가 발생했습니다.');
          setText('');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchText();
  }, [uid, resolvedFilename]);

  const rawLines = useMemo(() => text.split('\n').filter(l => l.trim() !== ''), [text]);

  const viewIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const base: number[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (!q || line.toLowerCase().includes(q)) base.push(i);
    }

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

  // Renderer가 호출할 저장함수: 북마크 정책은 여기(Provider)에 남겨도 되고, 지금처럼 “저장 경로”만 책임져도 됨.
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

    await updateBookmarkIndexDb(bookmark, null);
  }, [wordbookPath, currentUserUid, bookmarkId, searchQuery, shuffleWordIndices]);

  // load bookmark (동일)
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
    return () => { cancelled = true; };
  }, [uid, wordbookPath, currentUserUid, loading, error]);

  // bookmarkWordIndex -> initial pageIndex (once)
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

  const value: WordListPageContextValue = {
    uid,
    resolvedFilename,
    nav,

    currentUserUid,

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
  };

  return (
    <WordListPageContext.Provider value={value}>
      {children}
    </WordListPageContext.Provider>
  );
}
