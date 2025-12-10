// pages/WordEditPage.tsx
import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, generatePath } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, storage } from '~/constants/firebase';
import {
  parseTextToWordLines,
  wordLinesToText,
  shuffleLines,
  computeInitialPageSize,
  paginate,
  parseLineForSimple,
} from '~/utils/editor';
import { ROUTE_USER_WORDS, ROUTE_SIGN_IN } from '~/constants/routes';
import { EditorModalMode, EditorMode } from '~/enums/editor';
import type { PageSize, SimpleItem } from '~/types/editor';
import { PaginationControls } from '~/components/PaginationControls';
import { ref as storageRef, getDownloadURL, uploadString, getMetadata } from 'firebase/storage';
import { UserLevel } from '~/enums/user';
import { getDefaultWordbookPath } from '~/utils/storage';
import { SEP } from '~/constants/editor';

export function WordEditPage() {
  const { uid } = useParams<{ uid: string }>();
  const nav = useNavigate();

  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserUid, setCurrentUserUid] = useState<string | null>(null);

  const [editorMode, setEditorMode] = useState<EditorMode>(EditorMode.Simple);

  // 공개 범위 상태 (기본: 비공개 Owner)
  const [readAccess, setReadAccess] = useState<UserLevel>(UserLevel.Owner);

  // 간편 에디터 상태 (원본 텍스트 기준 lineIndex)
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(null);

  // 간편 에디터 페이지네이션 상태
  const [pageSize, setPageSize] = useState<PageSize>(computeInitialPageSize(190, 23.4));
  const [pageIndex, setPageIndex] = useState(0); // 0-based

  const [modalOpen, setModalOpen] = useState(false);
  const [editorModalMode, setEditorModalMode] =
    useState<EditorModalMode>(EditorModalMode.Add);
  const [modalWord, setModalWord] = useState('');
  const [modalLink, setModalLink] = useState('');

  // 고급 에디터 textarea ref (커서 위치 / 스크롤 제어용)
  const advancedTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!uid) return;

    setLoading(true);
    const unsub = onAuthStateChanged(auth, async user => {
      try {
        if (!user) {
          setCurrentUserUid(null);
          setError('로그인이 필요합니다.');
          setLoading(false);
          return;
        }

        setCurrentUserUid(user.uid);

        if (user.uid !== uid) {
          setError('본인 계정만 수정할 수 있습니다.');
          setLoading(false);
          return;
        }

        const path = getDefaultWordbookPath(uid);
        const fileRef = storageRef(storage, path);

        try {
          // 텍스트 + 메타데이터를 함께 가져오기
          const [url, meta] = await Promise.all([
            getDownloadURL(fileRef),
            getMetadata(fileRef),
          ]);

          const res = await fetch(url);
          const txt = await res.text();
          setText(txt ?? '');

          const metaAccess = meta.customMetadata?.readAccess as | UserLevel | undefined;

          // 메타데이터 없으면 기본 Owner
          setReadAccess(metaAccess === UserLevel.Public ? UserLevel.Public : UserLevel.Owner);

          setError(null);
        } catch (err: any) {
          console.error(err);

          if (err.code === 'storage/object-not-found') {
            // 파일이 없는 경우: 에러로 막지 말고 "빈 단어장 + 비공개"로 시작
            setText('');
            setReadAccess(UserLevel.Owner);
            setError(null);
          } else {
            // 진짜 오류일 때만 에러 화면으로 보냄
            setError('단어장을 불러오는 중 오류가 발생했습니다.');
            setText('');
          }
        }
      } catch (e) {
        console.error(e);
        setError('단어장을 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [uid]);

  const handleBack = () => {
    if (!uid) return;
    nav(generatePath(ROUTE_USER_WORDS, { uid }));
  };

  const handleRandom = () => {
    setText(prev => shuffleLines(prev));
  };

  const handleSave = async () => {
    if (!uid || !currentUserUid || currentUserUid !== uid) {
      setError('저장 권한이 없습니다.');
      return;
    }

    try {
      const lines = parseTextToWordLines(text);
      const newText = wordLinesToText(lines);

      const path = getDefaultWordbookPath(uid);
      const fileRef = storageRef(storage, path);

      // 저장할 때 현재 readAccess 를 메타데이터에 반영
      await uploadString(fileRef, newText, 'raw', {
        customMetadata: {
          readAccess,
        },
      });

      nav(generatePath(ROUTE_USER_WORDS, { uid }));
    } catch (e) {
      console.error(e);
      setError('저장 중 오류가 발생했습니다.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      nav(ROUTE_SIGN_IN);
    } catch (e) {
      console.error(e);
    }
  };

  // 에디터 모드 토글 (고급 → 간편)
  const switchToSimpleEditor = () => {
    if (editorMode === EditorMode.Simple) return;

    if (advancedTextareaRef.current) {
      const el = advancedTextareaRef.current;
      const caret = el.selectionStart ?? 0;
      const before = text.slice(0, caret);
      const lineIndex = before.split(/\r?\n/).length - 1; // 0-based

      setSelectedLineIndex(lineIndex);

      // 해당 줄이 있는 페이지로 이동
      const simpleItems: SimpleItem[] = (() => {
        const lines = text.split(/\r?\n/);
        const items: SimpleItem[] = [];
        lines.forEach((line, idx) => {
          const parsed = parseLineForSimple(line, idx);
          if (parsed) items.push(parsed);
        });
        return items;
      })();

      const idx = simpleItems.findIndex(item => item.lineIndex === lineIndex);
      if (idx !== -1) {
        const newPageIndex = Math.floor(idx / pageSize);
        setPageIndex(newPageIndex);
      }
    }

    setEditorMode(EditorMode.Simple);
  };

  // 에디터 모드 토글 (간편 → 고급)
  const switchToAdvancedEditor = () => {
    if (editorMode === EditorMode.Advanced) return;
    setEditorMode(EditorMode.Advanced);
  };

  // 공개 범위 토글
  const toggleReadAccess = () => {
    setReadAccess(prev =>
      prev === UserLevel.Owner ? UserLevel.Public : UserLevel.Owner,
    );
  };

  // 간편 에디터용: text → SimpleItem[]
  const simpleItems: SimpleItem[] = (() => {
    const lines = text.split(/\r?\n/);
    const items: SimpleItem[] = [];
    lines.forEach((line, idx) => {
      const parsed = parseLineForSimple(line, idx);
      if (parsed) items.push(parsed);
    });
    return items;
  })();

  const { totalPages, safePageIndex, pagedItems } = paginate(
    simpleItems,
    pageSize,
    pageIndex,
  );

  // 간편 에디터: 단어 선택 핸들러
  const handleSelectItem = (lineIndex: number) => {
    setSelectedLineIndex(prev => (prev === lineIndex ? null : lineIndex));
  };

  // 모달 열기 (추가/수정)
  const openAddModal = () => {
    setEditorModalMode(EditorModalMode.Add);
    setModalWord('');
    setModalLink('');
    setModalOpen(true);
  };

  const openEditModal = () => {
    if (selectedLineIndex == null) return;

    const lines = text.split(/\r?\n/);
    const line = lines[selectedLineIndex] ?? '';
    const parsed = parseLineForSimple(line, selectedLineIndex);
    if (!parsed) return;

    setEditorModalMode(EditorModalMode.Edit);
    setModalWord(parsed.word);
    setModalLink(parsed.link ?? '');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
  };

  // 모달에서 확인 눌렀을 때
  const handleModalConfirm = () => {
    const word = modalWord.trim();
    const link = modalLink.trim();

    if (!word) {
      alert('단어를 입력해주세요.');
      return;
    }

    const newLine = link ? `${word}${SEP}${link}` : word;

    const lines = text.split(/\r?\n/);

    if (editorModalMode === EditorModalMode.Add) {
      let insertIndex = 0;
      if (selectedLineIndex != null) {
        insertIndex = selectedLineIndex + 1;
      }
      lines.splice(insertIndex, 0, newLine);
      setSelectedLineIndex(insertIndex);
    } else {
      if (selectedLineIndex == null) return;
      lines[selectedLineIndex] = newLine;
    }

    setText(lines.join('\n'));
    setModalOpen(false);
  };

  // 간편 에디터: 삭제
  const handleDelete = () => {
    if (selectedLineIndex == null) return;
    const lines = text.split(/\r?\n/);
    if (selectedLineIndex < 0 || selectedLineIndex >= lines.length) return;

    lines.splice(selectedLineIndex, 1);
    setText(lines.join('\n'));
    setSelectedLineIndex(null);
  };

  // 간편 → 고급: 선택된 단어 위치로 커서 이동 + 스크롤 조정
  useEffect(() => {
    if (editorMode !== EditorMode.Advanced) return;
    if (selectedLineIndex == null) return;
    const el = advancedTextareaRef.current;
    if (!el) return;

    const lines = text.split(/\r?\n/);
    let pos = 0;
    for (let i = 0; i < selectedLineIndex && i < lines.length; i++) {
      pos += lines[i].length + 1; // 줄 + 개행
    }

    el.focus();
    el.selectionStart = el.selectionEnd = pos;

    try {
      const computed = window.getComputedStyle(el);
      const lineHeight = parseFloat(computed.lineHeight || '0') || 20;
      const targetScrollTop =
        lineHeight * (selectedLineIndex - 1) - el.clientHeight / 2;
      el.scrollTop = Math.max(0, targetScrollTop);
    } catch {
      // getComputedStyle 실패해도 그냥 무시
    }
  }, [editorMode, selectedLineIndex, text]);

  if (loading) {
    return (
      <div className="container py-5">
        <p>로딩 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container py-5">
        <p>{error}</p>
      </div>
    );
  }

  const isSimple = editorMode === EditorMode.Simple;
  const isOwnerOnly = readAccess === UserLevel.Owner;

  return (
    <div className="container py-4" style={{ minHeight: '100vh' }}>
      {/* 상단 바 */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="d-flex gap-2">
          <button className="btn btn-outline-light" onClick={handleBack}>
            뒤로
          </button>
          <button className="btn btn-success" onClick={handleSave}>
            변경
          </button>
        </div>

        {/* 오른쪽 햄버거 메뉴 */}
        <div className="dropdown">
          <button
            className="btn btn-outline-light"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            ☰
          </button>
          <ul className="dropdown-menu dropdown-menu-end dropdown-menu-dark">
            {/* 에디터 모드 토글 */}
            {isSimple ? (
              <li>
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={switchToAdvancedEditor}
                >
                  고급 에디터로 변경
                </button>
              </li>
            ) : (
              <li>
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={switchToSimpleEditor}
                >
                  간편 에디터로 변경
                </button>
              </li>
            )}

            {/* 공개 범위 토글 */}
            <li>
              <button
                className="dropdown-item"
                type="button"
                onClick={toggleReadAccess}
              >
                {isOwnerOnly ? '전체공개로 전환' : '비공개로 전환'}
              </button>
            </li>

            {/* 단어 랜덤 섞기 */}
            <li>
              <button
                className="dropdown-item"
                type="button"
                onClick={handleRandom}
              >
                단어 랜덤섞기
              </button>
            </li>

            <li>
              <hr className="dropdown-divider" />
            </li>

            {/* 로그아웃 */}
            <li>
              <button
                className="dropdown-item text-danger"
                type="button"
                onClick={handleLogout}
              >
                로그아웃
              </button>
            </li>
          </ul>
        </div>
      </div>

      {/* 본문 */}
      {isSimple ? (
        <>
          {/* 간편 에디터 상단 아이콘 */}
          <div className="d-flex justify-content-end mb-2 gap-2">
            <button
              className="btn btn-sm btn-outline-light"
              onClick={openEditModal}
              disabled={selectedLineIndex == null}
              title="수정"
            >
              ✏ 수정
            </button>
            <button
              className="btn btn-sm btn-outline-light"
              onClick={openAddModal}
              title="추가"
            >
              ＋ 추가
            </button>
            <button
              className="btn btn-sm btn-outline-danger"
              onClick={handleDelete}
              disabled={selectedLineIndex == null}
              title="삭제"
            >
              🗑 삭제
            </button>
          </div>

          <PaginationControls
            className="w-100 justify-content-between mb-2"
            pageSize={pageSize}
            pageIndex={safePageIndex}
            totalPages={totalPages}
            onPageSizeChange={size => {
              setPageSize(size);
              setPageIndex(0);
            }}
            onPageIndexChange={setPageIndex}
          />

          {/* 단어 리스트 (페이지 단위) – WordListPage 스타일에 맞춤 */}
          <ul
            style={{
              listStyle: 'none',
              paddingLeft: 0,
              marginBottom: 0,
            }}
          >
            {pagedItems.map(item => {
              const isSelected = item.lineIndex === selectedLineIndex;
              const bg = isSelected ? '#1d3557' : '#000';

              return (
                <li
                  key={item.lineIndex}
                  onClick={() => handleSelectItem(item.lineIndex)}
                  style={{
                    padding: '2px 6px',          // 고밀도 패딩
                    borderBottom: '1px solid #333',
                    fontSize: '0.92rem',
                    lineHeight: 1.25,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    backgroundColor: bg,        // 🔹 선택 시 색 채우기로 표시
                    color: '#f8f9fa',
                    cursor: 'pointer',
                  }}
                >
                  <span className="fw-bold me-2">{item.word}</span>
                  {item.link && (
                    <span
                      className="small"
                      style={{ color: '#0dcaf0' }} // text-info 비슷한 색
                    >
                      {item.link}
                    </span>
                  )}
                </li>
              );
            })}

            {simpleItems.length === 0 && (
              <li
                style={{
                  padding: '4px 6px',
                  fontSize: '0.9rem',
                }}
                className="text-secondary bg-black"
              >
                새로운 단어를 추가해주세요
              </li>
            )}
          </ul>
        </>
      ) : (
        // 고급 에디터 그대로
        <textarea
          ref={advancedTextareaRef}
          className="form-control bg-black text-light"
          style={{
            height: 'calc(100vh - 200px)',
            minHeight: '50vh',
            caretColor: 'red',
            whiteSpace: 'pre',
            overflowX: 'auto',
          }}
          value={text}
          onChange={e => setText(e.target.value)}
        />
      )}

      {/* 모달 */}
      {modalOpen && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-flex justify-content-center align-items-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1050 }}
        >
          <div
            className="bg-dark text-light p-3 rounded"
            style={{ minWidth: 320 }}
          >
            <h5 className="mb-3">
              {editorModalMode === EditorModalMode.Add ? '단어 추가' : '단어 수정'}
            </h5>

            <div className="mb-2">
              <label className="form-label">단어</label>
              <input
                className="form-control"
                value={modalWord}
                onChange={e => setModalWord(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label className="form-label">링크 (선택)</label>
              <input
                className="form-control"
                value={modalLink}
                onChange={e => setModalLink(e.target.value)}
              />
            </div>

            <div className="d-flex justify-content-end gap-2">
              <button className="btn btn-secondary btn-sm" onClick={closeModal}>
                취소
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleModalConfirm}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
