// WordListPage.tsx
import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link, generatePath } from 'react-router-dom';
import { firestore, auth, VITE_VOCA_ENV } from '~/constants/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { LogoutButton } from '~/components/LogoutButton';
import type { UserDoc } from '~/types/user';
import { ROUTE_SIGN_IN, ROUTE_USER_WORDS_EDIT } from '~/constants/routes';
import type { PageSize } from '~/types/editor';
import { computeInitialPageSize } from '~/utils/editor';
import { allowedPageSizes } from '~/constants/editor';

export function WordListPage() {
  const { uid } = useParams<{ uid: string }>();
  const nav = useNavigate();

  const [userDoc, setUserDoc] = useState<UserDoc | undefined>(undefined);
  const [currentUserUid, setCurrentUserUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const [iframeLoading, setIframeLoading] = useState(false);

  const [leftWidth, setLeftWidth] = useState(280); // 초기 폭(px)
  const dividerRef = useRef<HTMLDivElement | null>(null);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [mobileMode, setMobileMode] = useState(false); // 모바일일 때 iframe만 보기 모드

  // ✅ 단어 리스트 페이지네이션 상태
  const [pageSize, setPageSize] = useState<PageSize>(computeInitialPageSize(120));
  const [pageIndex, setPageIndex] = useState(0); // 0-based

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
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUserUid(user?.uid ?? null);
    });
    return () => unsub();
  }, []);

  // Load Firestore doc
  useEffect(() => {
    if (!uid) return;
    const fetchData = async () => {
      try {
        const snap = await getDoc(doc(firestore, 'voca', VITE_VOCA_ENV, 'users', uid));
        if (!snap.exists()) {
          setError('존재하지 않는 사용자입니다.');
          return;
        }
        setUserDoc(snap.data() as UserDoc);
      } catch (e: any) {
        if (e.code === 'permission-denied') {
          setError('페이지에 접근할 수 없습니다');
        } else {
          setError('데이터를 불러오는 중 오류가 발생했습니다.');
        }
      }
    };
    fetchData();
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
    const onMouseUp = () => (dragging = false);

    divider.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      divider.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  if (error) {
    return (
      <div className='container py-5'>
        <p>{error}</p>
        <Link to={ROUTE_SIGN_IN} className='link-light'>
          로그인 페이지로 이동
        </Link>
      </div>
    );
  }

  if (!userDoc) {
    return (
      <div className='container py-5'>
        <p>로딩 중...</p>
      </div>
    );
  }

  const canEdit = currentUserUid === uid;
  const lines = userDoc.words.split('\n').filter((l: string) => l.trim() !== '');

  // ✅ 페이지네이션 계산
  const totalPages = lines.length === 0 ? 0 : Math.ceil(lines.length / pageSize);
  const safePageIndex = totalPages === 0 ? 0 : Math.min(pageIndex, totalPages - 1);
  const pageStart = safePageIndex * pageSize;
  const pagedLines = lines.slice(pageStart, pageStart + pageSize);

  return (
    <div className='container-fluid py-3' style={{ height: '100vh', overflow: 'hidden' }}>
      {/* --- 상단 바: 왼쪽 페이지네이션, 오른쪽 수정/로그아웃 --- */}
      <div className='d-flex justify-content-between align-items-center mb-3'>
        {/* 🔹 왼쪽: 페이지네이션 컨트롤 */}
        <div className='d-flex align-items-center gap-3'>
          <div className='d-flex align-items-center gap-2'>
            <span className='small text-secondary'>페이지 당</span>
            <select
              className='form-select form-select-sm bg-black text-light'
              style={{ width: 'auto' }}
              value={pageSize}
              onChange={(e) => {
                const newSize = Number(e.target.value) as PageSize;
                setPageSize(newSize);
                setPageIndex(0);
              }}
            >
              <>
                {allowedPageSizes.map((pageSizes) => {
                  return (<option value={pageSizes}>{`${pageSizes}개`}</option>);
                })}
              </>
            </select>
          </div>

          <div className='d-flex align-items-center gap-2'>
            <button
              className='btn btn-sm btn-outline-light'
              disabled={safePageIndex <= 0 || totalPages === 0}
              onClick={() => setPageIndex((prev) => Math.max(0, prev - 1))}
            >
              ◀
            </button>

            <span className='small text-secondary'>
              {totalPages === 0 ? '0 / 0' : `${safePageIndex + 1} / ${totalPages}`}
            </span>

            <input
              type='number'
              className='form-control form-control-sm bg-black text-light'
              style={{ width: 70 }}
              min={totalPages === 0 ? 0 : 1}
              max={totalPages === 0 ? 0 : totalPages}
              value={totalPages === 0 ? 0 : safePageIndex + 1}
              onChange={(e) => {
                if (totalPages === 0) return;
                const raw = Number(e.target.value);
                if (Number.isNaN(raw)) return;
                const clamped = Math.min(totalPages, Math.max(1, raw));
                setPageIndex(clamped - 1);
              }}
            />

            <button
              className='btn btn-sm btn-outline-light'
              disabled={totalPages === 0 || safePageIndex >= totalPages - 1}
              onClick={() =>
                setPageIndex((prev) => Math.min(totalPages - 1, prev + 1))
              }
            >
              ▶
            </button>
          </div>
        </div>

        {/* 🔹 오른쪽: 수정 버튼 + 로그아웃 */}
        <div className="d-flex align-items-center gap-2">
          {canEdit && (
            <button
              className='btn btn-primary'
              onClick={() => nav(generatePath(ROUTE_USER_WORDS_EDIT, { uid }))}
            >
              수정
            </button>
          )}
          <LogoutButton />
        </div>
      </div>

      {/* --- 메인 2-컬럼 레이아웃 (모바일 분기 포함) --- */}
      <div className='d-flex' style={{ height: 'calc(100% - 80px)' }}>
        {/* LEFT (단어 목록) */}
        {!mobileMode && (
          <div
            className='overflow-auto bg-black'
            style={{
              width: leftWidth,
              borderRight: '1px solid #555',
              paddingRight: 5,
            }}
          >
            <ul
              className='list-group list-group-flush'
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
                    <span className='fw-bold'>{word}</span>
                  </li>
                );
              })}
              {lines.length === 0 && (
                <li className='list-group-item bg-black text-secondary'>
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
        <div className='flex-grow-1 position-relative'>
          {selectedLink ? (
            <>
              {iframeLoading && (
                <div
                  className='position-absolute top-50 start-50 translate-middle text-light'
                  style={{ zIndex: 10 }}
                >
                  <div className='spinner-border text-info' />
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
            <div className='text-secondary d-flex justify-content-center align-items-center h-100'>
              단어를 클릭하면 오른쪽에 치트시트가 표시됩니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
