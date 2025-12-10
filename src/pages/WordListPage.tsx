// WordListPage.tsx
import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link, generatePath } from 'react-router-dom';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { ref as rtdbRef, onValue, push, set as rtdbSet, onDisconnect } from 'firebase/database';
import { auth, VITE_VOCA_ENV, storage, database } from '~/constants/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { LogoutButton } from '~/components/LogoutButton';
import { ROUTE_SIGN_IN, ROUTE_USER_WORDS_EDIT } from '~/constants/routes';
import type { PageSize } from '~/types/editor';
import { computeInitialPageSize, paginate } from '~/utils/editor';
import { PaginationControls } from '~/components/PaginationControls';

function getDefaultWordbookPath(uid: string) {
  return `voca/${VITE_VOCA_ENV}/users/${uid}/wordbooks/default.txt`;
}

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

  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const [iframeLoading, setIframeLoading] = useState(false);

  const [leftWidth, setLeftWidth] = useState(280); // 초기 폭(px)
  const dividerRef = useRef<HTMLDivElement | null>(null);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [mobileMode, setMobileMode] = useState(false); // 모바일일 때 iframe만 보기 모드

  // 단어 리스트 페이지네이션 상태
  const [pageSize, setPageSize] = useState<PageSize>(computeInitialPageSize(120));
  const [pageIndex, setPageIndex] = useState(0); // 0-based

  // 북마크 관련 상태 (database)
  const [bookmarkWordIndex, setBookmarkWordIndex] = useState<number | null>(null);
  const [bookmarkKey, setBookmarkKey] = useState<string | null>(null);
  const [initialBookmarkApplied, setInitialBookmarkApplied] = useState(false);

  const wordbookPath = uid ? getDefaultWordbookPath(uid) : null;

  // Resize detection
  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) setMobileMode(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  // ESC → iframe 닫기
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedLink(null);
        setSelectedIndex(null);
        setMobileMode(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Drag to resize (left panel)
  useEffect(() => {
    const divider = dividerRef.current;
    if (!divider) return;

    let dragging = false;

    const onMouseDown = () => {
      dragging = true;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;

      const newWidth = e.clientX;
      if (newWidth > 150 && newWidth < window.innerWidth - 200) {
        setLeftWidth(newWidth);
      }
    };
    const onMouseUp = () => {
      dragging = false;
    };

    divider.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      divider.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // 🔹 database 북마크 전체 감시 (현재 로그인한 유저 기준)
  useEffect(() => {
    if (!currentUserUid || !uid) return;

    const viewerUid = currentUserUid;
    // 🔸 앞에 슬래시 빼는 걸 추천 (실제 경로는 voca/... 로 가게)
    const basePath = `voca/${VITE_VOCA_ENV}/users/${viewerUid}/bookmarks`;
    const dbRef = rtdbRef(database, basePath);

    const unsub = onValue(
      dbRef,
      snap => {
        // ✅ 데이터 없어도 이 콜백은 한 번은 무조건 호출돼야 한다.
        const val = snap.val() as Record<string, Bookmark> | null;

        // 북마크 없으면 그냥 상태 비우기
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
        // 🔥 권한 문제 / 네트워크 문제 등을 여기서 바로 확인
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



  // 🔹 초기 로딩 시: 북마크 wordIndex → pageIndex 반영 (한 번만)
  useEffect(() => {
    if (initialBookmarkApplied) return;
    if (!text) return;
    if (bookmarkWordIndex == null) return;

    const allLines = text
      .split('\n')
      .filter((l: string) => l.trim() !== '');

    if (allLines.length === 0) return;

    let idx = bookmarkWordIndex;
    if (idx < 0) idx = 0;
    if (idx >= allLines.length) idx = allLines.length - 1;

    const newPageIndex = Math.floor(idx / pageSize);
    setPageIndex(newPageIndex);
    setInitialBookmarkApplied(true);
  }, [text, bookmarkWordIndex, pageSize, initialBookmarkApplied]);

  // 🔹 페이지 바뀔 때마다 RTDB에 북마크 저장 + onDisconnect 갱신
  useEffect(() => {
    if (!currentUserUid || !uid || !wordbookPath) {
      return;
    }
    if (!text) return; // 텍스트 없으면 스킵

    const allLines = text
      .split('\n')
      .filter((l: string) => l.trim() !== '');

    if (allLines.length === 0) return;

    const viewerUid = currentUserUid;
    const basePath = `voca/${VITE_VOCA_ENV}/users/${viewerUid}/bookmarks`;
    const baseRef = rtdbRef(database, basePath);

    const wordIndex = pageIndex * pageSize;

    let key = bookmarkKey;
    if (!key) {
      const newRef = push(baseRef); // 랜덤 bookmarkId 생성
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

    onDisconnect(bkRef).set(bookmark).catch(err => {
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
  const lines = text
    .split('\n')
    .filter((l: string) => l.trim() !== '');

  const {
    totalPages,
    safePageIndex,
    pageStart,
    pagedItems: pagedLines,
  } = paginate(lines, pageSize, pageIndex);

  return (
    <div
      className="container-fluid py-3"
      style={{ height: '100vh', overflow: 'hidden' }}
    >
      {/* --- 상단 바: 왼쪽 페이지네이션, 오른쪽 수정/로그아웃 --- */}
      <div className="d-flex justify-content-between align-items-center mb-3">
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

        <div className="d-flex align-items-center gap-2">
          {canEdit && (
            <button
              className="btn btn-primary"
              onClick={() =>
                nav(generatePath(ROUTE_USER_WORDS_EDIT, { uid }))
              }
            >
              수정
            </button>
          )}
          <LogoutButton />
        </div>
      </div>

      {/* --- 메인 2-컬럼 레이아웃 (모바일 분기 포함) --- */}
      <div className="d-flex" style={{ height: 'calc(100% - 80px)' }}>
        {/* LEFT (단어 목록) */}
        {!mobileMode && (
          <div
            className="overflow-auto bg-black"
            style={{
              width: leftWidth,
              borderRight: '1px solid #555',
              paddingRight: 5,
            }}
          >
            <ul
              className="list-group list-group-flush"
              style={{ listStyle: 'none', paddingLeft: 0, marginBottom: 0 }}
            >
              {pagedLines.map((line: string, localIdx: number) => {
                const idx = pageStart + localIdx; // 원래 전체 인덱스
                const parts = line.split('/|/');
                const word = parts[0]?.trim();
                const link = parts[1]?.trim();

                const isSelected = selectedIndex === idx;

                return (
                  <li
                    key={idx}
                    className={`
                      px-2 bg-black text-light border
                      ${isSelected ? 'border-info' : 'border-secondary'}
                    `}
                    style={{
                      cursor: link ? 'pointer' : 'default',
                      backgroundColor: isSelected ? '#1d3557' : '#000',
                    }}
                    onClick={() => {
                      if (!link) {
                        setSelectedLink(null);
                        setSelectedIndex(null);
                        setMobileMode(false);
                        return;
                      }

                      if (selectedIndex === idx) {
                        setSelectedLink(null);
                        setSelectedIndex(null);
                        setMobileMode(false);
                        return;
                      }

                      setSelectedIndex(idx);

                      if (selectedLink !== link) {
                        setIframeLoading(true);
                      }

                      setSelectedLink(link);

                      if (isMobile) {
                        setMobileMode(true);
                      }
                    }}
                  >
                    <span className="fw-bold">{word}</span>
                  </li>
                );
              })}
              {lines.length === 0 && (
                <li className="list-group-item bg-black text-secondary">
                  단어가 없습니다. 에디터에서 단어를 추가해 주세요.
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Divider (drag handle) — 데스크탑에서만 */}
        {!mobileMode && (
          <div
            ref={dividerRef}
            style={{
              width: 6,
              cursor: 'col-resize',
              background: '#444',
            }}
          ></div>
        )}

        {/* RIGHT (iframe viewer) */}
        <div className="flex-grow-1 position-relative">
          {selectedLink ? (
            <>
              {iframeLoading && (
                <div
                  className="position-absolute top-50 start-50 translate-middle text-light"
                  style={{ zIndex: 10 }}
                >
                  <div className="spinner-border text-info" />
                </div>
              )}

              <iframe
                src={selectedLink}
                onLoad={() => setIframeLoading(false)}
                style={{
                  width: '110%',
                  height: '110%',
                  transform: 'scale(0.9)',
                  transformOrigin: '0 0',
                  border: 'none',
                  background: '#111',
                }}
              />
            </>
          ) : (
            <div className="text-secondary d-flex justify-content-center align-items-center h-100">
              단어를 클릭하면 오른쪽에 치트시트가 표시됩니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
