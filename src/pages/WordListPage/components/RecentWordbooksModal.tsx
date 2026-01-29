// pages/WordListPage/components/RecentWordbooksModal.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ref as rtdbRef, get, remove } from 'firebase/database';

import { useAuth } from '~/contexts/AuthContext';
import { VITE_VOCA_ENV, database } from '~/constants/firebase';
import { PaginationControls } from '~/components/PaginationControls';
import type { PageSize } from '~/types/editor';
import type { Bookmark } from '~/types/bookmark';
import { listAllBookmarksIndexDb, deleteBookmarkIndexDb } from '~/utils/bookmarkIdb';

type Props = {
  currentUid: string;
  currentFilename: string;
  onMove: (uid: string, filename: string) => void;
  onClose: () => void;
};

type SortMode = 'recent' | 'filename' | 'uid';

type Item = {
  wordbookPath: string;
  updatedAt: number;
  // for RTDB delete
  rtdbKeys?: string[];
  // derived
  uid: string;
  filename: string;
};

function parseWordbookPath(wordbookPath: string): { uid: string; filename: string } | null {
  // expected: voca/{env}/users/{uid}/wordbooks/{filename}
  const parts = String(wordbookPath ?? '').split('/').filter(Boolean);
  const usersIdx = parts.indexOf('users');
  const wordbooksIdx = parts.indexOf('wordbooks');

  if (usersIdx < 0 || wordbooksIdx < 0) return null;
  if (wordbooksIdx !== usersIdx + 2) {
    // users/{uid}/wordbooks 가 아닐 수도 있지만 일단 최대한 복원
    const uid = parts[usersIdx + 1];
    const filename = parts.slice(wordbooksIdx + 1).join('/') || '';
    if (!uid || !filename) return null;
    return { uid, filename };
  }

  const uid = parts[usersIdx + 1];
  const filename = parts[wordbooksIdx + 1];
  if (!uid || !filename) return null;
  return { uid, filename };
}

export function RecentWordbooksModal({
  currentUid,
  currentFilename,
  onMove,
  onClose,
}: Props) {
  const { user } = useAuth();
  const currentUserUid = user?.uid ?? null;

  const [items, setItems] = useState<Item[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null); // wordbookPath
  const [loading, setLoading] = useState(false);

  const [sortMode, setSortMode] = useState<SortMode>('recent');

  const [pageSize, setPageSize] = useState<PageSize>(15 as PageSize);
  const [pageIndex, setPageIndex] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // -------------------------
      // Guest -> IndexedDB
      // -------------------------
      if (!currentUserUid) {
        const all = await listAllBookmarksIndexDb(null);

        const dedup = new Map<string, Item>();
        for (const bm of all) {
          const wordbookPath = bm.wordbookPath;
          const updatedAt = bm.updatedAt ?? 0;
          const parsed = parseWordbookPath(wordbookPath);
          if (!parsed) continue;

          const prev = dedup.get(wordbookPath);
          if (!prev || updatedAt > prev.updatedAt) {
            dedup.set(wordbookPath, {
              wordbookPath,
              updatedAt,
              uid: parsed.uid,
              filename: parsed.filename,
            });
          }
        }

        const next = Array.from(dedup.values());
        setItems(next);
        setSelectedKey(prev => (prev && next.some(x => x.wordbookPath === prev) ? prev : null));
        setPageIndex(0);
        return;
      }

      // -------------------------
      // Logged in -> RTDB
      // -------------------------
      const basePath = `voca/${VITE_VOCA_ENV}/users/${currentUserUid}/bookmarks`;
      const snap = await get(rtdbRef(database, basePath));

      if (!snap.exists()) {
        setItems([]);
        setSelectedKey(null);
        setPageIndex(0);
        return;
      }

      const val = snap.val() as Record<string, Bookmark>;

      // wordbookPath 기준으로 dedupe + 삭제용 key(복수) 보관
      const dedup = new Map<string, Item>();

      for (const [key, bm] of Object.entries(val)) {
        if (!bm?.wordbookPath) continue;

        const wordbookPath = bm.wordbookPath;
        const updatedAt = bm.updatedAt ?? 0;

        const parsed = parseWordbookPath(wordbookPath);
        if (!parsed) continue;

        const prev = dedup.get(wordbookPath);
        if (!prev) {
          dedup.set(wordbookPath, {
            wordbookPath,
            updatedAt,
            rtdbKeys: [key],
            uid: parsed.uid,
            filename: parsed.filename,
          });
        } else {
          // 같은 wordbookPath가 여러 개면: updatedAt max + 키 누적(삭제 안전)
          prev.rtdbKeys = Array.from(new Set([...(prev.rtdbKeys ?? []), key]));
          if (updatedAt > prev.updatedAt) prev.updatedAt = updatedAt;
        }
      }

      const next = Array.from(dedup.values());
      setItems(next);
      setSelectedKey(prev => (prev && next.some(x => x.wordbookPath === prev) ? prev : null));
      setPageIndex(0);
    } finally {
      setLoading(false);
    }
  }, [currentUserUid]);

  useEffect(() => {
    reload();
  }, [reload]);

  const sortedItems = useMemo(() => {
    const copy = [...items];

    if (sortMode === 'recent') {
      copy.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      return copy;
    }

    if (sortMode === 'filename') {
      copy.sort((a, b) => b.filename.localeCompare(a.filename)); // ✅ filename 내림차순
      return copy;
    }

    // uid
    copy.sort((a, b) => a.uid.localeCompare(b.uid));
    return copy;
  }, [items, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);

  const pagedItems = useMemo(() => {
    const start = safePageIndex * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, safePageIndex, pageSize]);

  const selected = useMemo(
    () => (selectedKey ? items.find(x => x.wordbookPath === selectedKey) ?? null : null),
    [items, selectedKey],
  );

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    if (!confirm(`"${selected.filename}" 북마크를 삭제할까요?`)) return;

    try {
      // Guest
      if (!currentUserUid) {
        await deleteBookmarkIndexDb(selected.wordbookPath, null);
        await reload();
        return;
      }

      // Logged in
      const basePath = `voca/${VITE_VOCA_ENV}/users/${currentUserUid}/bookmarks`;
      const keys = selected.rtdbKeys ?? [];
      await Promise.all(keys.map(k => remove(rtdbRef(database, `${basePath}/${k}`))));
      await reload();
    } catch (e) {
      console.error(e);
      alert('삭제 실패');
    }
  }, [selected, currentUserUid, reload]);

  return (
    <div
      className="position-fixed top-0 start-0 w-100 h-100 d-flex justify-content-center align-items-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1050 }}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card bg-dark text-light shadow-lg" style={{ width: 'min(720px, 92vw)', maxHeight: '86vh' }}>
        {/* Header */}
        <div className="card-header d-flex justify-content-between align-items-center">
          <div className="fw-semibold">최근에 본 단어장들</div>
          <div className="d-flex gap-2">
            <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="card-body p-2" style={{ overflow: 'auto' }}>
          <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
            <PaginationControls
              className="flex-grow-1 justify-content-between"
              pageSize={pageSize}
              pageIndex={safePageIndex}
              totalPages={totalPages}
              fixedPageSize={true}
              onPageSizeChange={size => {
                setPageSize(size);
                setPageIndex(0);
              }}
              onPageIndexChange={setPageIndex}
            />

            <select
              className="form-select form-select-sm"
              style={{ width: 170 }}
              value={sortMode}
              onChange={e => {
                setSortMode(e.target.value as SortMode);
                setPageIndex(0);
              }}
              aria-label="정렬"
            >
              <option value="recent">최근에 본 순</option>
              <option value="filename">파일이름 순</option>
              <option value="uid">유저아이디 순</option>
            </select>
          </div>

          {loading ? (
            <div className="text-center text-secondary py-4">
              <span className="spinner-border spinner-border-sm me-2" />
              불러오는 중...
            </div>
          ) : (
            <div className="list-group list-group-flush">
              {pagedItems.map(it => {
                const isSelected = it.wordbookPath === selectedKey;
                const isCurrent =
                  !!currentUid &&
                  !!currentFilename &&
                  it.uid === currentUid &&
                  it.filename === currentFilename;

                const isMyAccount = it.uid === currentUserUid;

                return (
                  <button
                    key={it.wordbookPath}
                    type="button"
                    className={[
                      'list-group-item list-group-item-action d-flex justify-content-between align-items-center',
                      'bg-dark text-light border-secondary',
                      isSelected ? 'active' : '',
                    ].join(' ')}
                    onClick={() => setSelectedKey(it.wordbookPath)}
                  >
                    <div className="d-flex align-items-center gap-2 w-100">
                      <span
                        className={`badge rounded-pill ${isSelected ? 'text-bg-primary' : 'text-bg-secondary'}`}
                        style={{ width: 28, textAlign: 'center' }}
                      >
                        {isSelected ? '✓' : ''}
                      </span>

                      <div className="d-flex flex-column flex-grow-1 min-w-0">
                        <div className="d-flex align-items-center gap-2 min-w-0">
                          <div className="fw-semibold text-truncate">{it.filename}</div>
                          {isCurrent && (
                            <span className="badge text-bg-info flex-shrink-0">현재</span>
                          )}
                        </div>

                        <div className="d-flex align-items-center gap-2 small text-secondary text-truncate">
                          <span className="text-truncate">{it.uid}</span>
                          {isMyAccount && (
                            <span className="badge text-bg-success flex-shrink-0">내 계정</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}

              {pagedItems.length === 0 && <div className="text-center text-secondary py-4">북마크가 없습니다.</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="card-footer d-flex justify-content-end gap-2">
          <button
            className="btn btn-sm btn-primary"
            disabled={!selected}
            onClick={() => selected && onMove(selected.uid, selected.filename)}
          >
            이동
          </button>

          <button className="btn btn-sm btn-outline-danger" disabled={!selected} onClick={handleDelete}>
            삭제
          </button>

          <button className="btn btn-sm btn-outline-light" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
