// pages/WordListPage/components/MyWordbooksModal.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';

import { listUserWordbooks, createWordbook, deleteWordbook, type UserWordbookFile, DEFAULT_WORDBOOK_FILENAME } from '~/utils/storage';
import { PaginationControls } from '~/components/PaginationControls';
import type { PageSize } from '~/types/editor';

type Props = {
  uid: string;
  currentFilename: string;
  onMove: (filename: string) => void;
  onClose: () => void;
};

function isValidFilename(name: string, existing: string[]) {
  if (!name) return '파일명을 입력하세요.';
  if (name.length > 50) return '파일명은 50자 이하만 가능합니다.';
  if (existing.includes(name)) return '이미 존재하는 파일명입니다.';
  if (/[\\/]/.test(name)) return '슬래시(/, \\)는 사용할 수 없습니다.';
  if (/[?#]/.test(name)) return 'URL 예약문자는 사용할 수 없습니다.';
  return null;
}

export function MyWordbooksModal({ uid, currentFilename, onMove, onClose }: Props) {
  const [items, setItems] = useState<UserWordbookFile[]>([]);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [pageSize, setPageSize] = useState<PageSize>(15 as PageSize);
  const [pageIndex, setPageIndex] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res: UserWordbookFile[] = await listUserWordbooks(uid);
      setItems(res);

      // 선택 유지(존재할 때만)
      setSelectedFilename(prev => (prev && res.some(x => x.filename === prev) ? prev : null));

      setPageIndex(0);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 이름순 오름차순(A -> Z) 고정
  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => a.filename.localeCompare(b.filename));
    return copy;
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);

  const pagedItems = useMemo(() => {
    const start = safePageIndex * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, pageSize, safePageIndex]);

  // -------------------------
  // Create wordbook (modal)
  // -------------------------
  const openCreateModal = useCallback(() => {
    setNewName('');
    setCreateError(null);
    setCreateOpen(true);
  }, []);

  const handleCreateConfirm = useCallback(async () => {
    const trimmed = newName.trim();

    const userWordbooks: UserWordbookFile[] = await listUserWordbooks(uid);
    const allFilenames = userWordbooks.map((userWordbook) => userWordbook.filename);
    const err = isValidFilename(trimmed, allFilenames);
    if (err) {
      setCreateError(err);
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      await createWordbook(uid, trimmed);
      await reload();
      setCreateOpen(false);
    } catch (e) {
      console.error(e);
      // 실패해도 모달 닫지 않음
      setCreateError('생성에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setCreating(false);
    }
  }, [newName, reload, uid]);

  const handleDelete = useCallback(async () => {
    if (!selectedFilename) return;
    if (selectedFilename === DEFAULT_WORDBOOK_FILENAME) return; // default는 삭제 금지
    if (!confirm(`"${selectedFilename}" 단어장을 삭제할까요?`)) return;

    try {
      await deleteWordbook(uid, selectedFilename);
      await reload();
      setSelectedFilename(null);
    } catch (e) {
      console.error(e);
      alert('삭제 실패');
    }
  }, [reload, selectedFilename, uid]);

  const deleteDisabled = !selectedFilename || selectedFilename === DEFAULT_WORDBOOK_FILENAME;

  return (
    <>
      {/* ===============================
           메인: 내 단어장들 모달
         =============================== */}
      <div
        className="position-fixed top-0 start-0 w-100 h-100 d-flex justify-content-center align-items-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1050 }}
        onMouseDown={e => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="card bg-dark text-light shadow-lg"
          style={{ width: 'min(720px, 92vw)', maxHeight: '86vh' }}
        >
          {/* Header */}
          <div className="card-header d-flex justify-content-between align-items-center">
            <div className="fw-semibold">내 단어장들</div>
            <div className="d-flex gap-2">
              <button className="btn btn-sm btn-outline-light" onClick={openCreateModal}>
                새 단어장
              </button>
              <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>
                ✕
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="card-body p-2" style={{ overflow: 'auto' }}>
            {/* 페이지네이션만 (정렬 드롭박스 제거) */}
            <PaginationControls
              className="w-100 justify-content-between mb-2"
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

            {loading ? (
              <div className="text-center text-secondary py-4">
                <span className="spinner-border spinner-border-sm me-2" />
                불러오는 중...
              </div>
            ) : (
              <div className="list-group list-group-flush">
                {pagedItems.map(it => {
                  const isSelected = it.filename=== selectedFilename;
                  const isCurrent = it.filename === currentFilename;

                  return (
                    <button
                      key={it.filename}
                      type="button"
                      className={[
                        'list-group-item list-group-item-action d-flex justify-content-between align-items-center',
                        'bg-dark text-light border-secondary',
                        isSelected ? 'active' : '',
                      ].join(' ')}
                      onClick={() => setSelectedFilename(it.filename)}
                    >
                      <div className="d-flex align-items-center gap-2 w-100">
                        <span
                          className={`badge rounded-pill ${
                            isSelected ? 'text-bg-primary' : 'text-bg-secondary'
                          }`}
                          style={{ width: 28, textAlign: 'center' }}
                        >
                          {isSelected ? '✓' : ''}
                        </span>

                        <span className="fw-semibold text-truncate" style={{ maxWidth: '55vw' }}>
                          {it.filename}
                        </span>

                        {isCurrent && <span className="badge text-bg-info">현재</span>}
                      </div>
                    </button>
                  );
                })}

                {pagedItems.length === 0 && (
                  <div className="text-center text-secondary py-4">단어장이 없습니다.</div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="card-footer d-flex justify-content-end gap-2">
            <button
              className="btn btn-sm btn-primary"
              disabled={!selectedFilename}
              onClick={() => selectedFilename && onMove(selectedFilename)}
            >
              이동
            </button>

            <button
              className="btn btn-sm btn-outline-danger"
              disabled={deleteDisabled}
              onClick={handleDelete}
              title={selectedFilename === DEFAULT_WORDBOOK_FILENAME
                ? `${DEFAULT_WORDBOOK_FILENAME}는 삭제할 수 없습니다.` : undefined
              }
            >
              삭제
            </button>

            <button className="btn btn-sm btn-outline-light" onClick={onClose}>
              취소
            </button>
          </div>
        </div>
      </div>

      {/* ===============================
        새 단어장 생성 모달
        =============================== */}
      {createOpen && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-flex justify-content-center align-items-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1060 }}
          onMouseDown={e => {
            if (e.target === e.currentTarget && !creating) setCreateOpen(false);
          }}
        >
          <div className="card bg-dark text-light shadow-lg" style={{ width: 420 }}>
            <div className="card-header fw-semibold">새 단어장 생성</div>

            <div className="card-body">
              <label className="form-label">파일명</label>
              <input
                className={`form-control bg-black text-light ${createError ? 'is-invalid' : ''}`}
                value={newName}
                autoFocus
                onChange={e => setNewName(e.target.value)}
                placeholder="예: my_words.txt"
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateConfirm();
                }}
              />
              {createError && <div className="invalid-feedback d-block">{createError}</div>}
            </div>

            <div className="card-footer d-flex justify-content-end gap-2">
              <button
                className="btn btn-sm btn-outline-light"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                취소
              </button>
              <button className="btn btn-sm btn-primary" onClick={handleCreateConfirm} disabled={creating}>
                {creating ? '생성 중...' : '생성'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
