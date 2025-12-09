// pages/WordEditPage.tsx
import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, generatePath } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, firestore, VITE_VOCA_ENV } from '~/constants/firebase';
import { parseTextToWordLines, wordLinesToText, shuffleLines } from '~/utils/words';
import { LogoutButton } from '~/components/LogoutButton';
import type { UserDoc } from '~/types/user';
import { ROUTE_USER_WORDS } from '~/constants/routes';
import { isParsableDate } from '~/utils/date';
import { EditorMode } from '~/enums/editor';

const SEP = '/|/';

// ✅ 브라우저 높이에 맞춰 고를 수 있게 더 많은 옵션 허용
type PageSize = 10 | 15 | 20 | 25 | 30 | 40 | 50;

// 간편 에디터에서 보여줄 아이템 (원본 lineIndex를 기억해야 함)
type SimpleItem = {
  lineIndex: number; // text.split('\n') 기준 인덱스
  word: string;
  link: string | null;
};

// 한 줄을 파싱해서 단어/링크만 뽑아보고, 잘못된 포맷이면 null
function parseLineForSimple(line: string, index: number): SimpleItem | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(SEP);

  // 허용 필드 수: 1~4
  if (parts.length < 1 || parts.length > 4) {
    return null;
  }

  const word = parts[0]?.trim();
  if (!word) return null;

  const link = (parts[1]?.trim() || '') || null;
  const createdAtRaw = (parts[2]?.trim() || '') || null;

  // 작성시간이 있다면 유효해야 함
  if (createdAtRaw && !isParsableDate(createdAtRaw)) {
    return null;
  }

  return {
    lineIndex: index,
    word,
    link,
  };
}

export function WordEditPage() {
  const { uid } = useParams<{ uid: string }>();
  const nav = useNavigate();

  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserUid, setCurrentUserUid] = useState<string | null>(null);

  const [editorMode, setEditorMode] = useState<EditorMode>(EditorMode.Simple);

  // 간편 에디터 상태 (원본 텍스트 기준 lineIndex)
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(null);

  // 간편 에디터 페이지네이션 상태
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [pageIndex, setPageIndex] = useState(0); // 0-based

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
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

        const snap = await getDoc(doc(firestore, 'voca', VITE_VOCA_ENV, 'users', uid));
        if (!snap.exists()) {
          setError('유저 데이터를 찾을 수 없습니다.');
          setLoading(false);
          return;
        }

        const data = snap.data() as UserDoc;
        setText(data.words ?? '');
        setError(null);
      } catch (e) {
        console.error(e);
        setError('데이터를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [uid]);

  // ✅ 처음 로딩 시, 브라우저 높이를 보고 pageSize 자동 결정
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const allowedSizes: PageSize[] = [10, 15, 20, 25, 30, 40, 50];

    const vh = window.innerHeight; // 전체 브라우저 높이
    // 대략 헤더/버튼/패딩 등 빼고 남는 리스트 영역 추정
    const reservedForHeader = 150; // px (필요하면 나중에 조정)
    const available = Math.max(0, vh - reservedForHeader);

    const approximateRowHeight = 26; // li 하나당 높이 (대략)
    const approxCount = Math.max(
      5,
      Math.floor(available / approximateRowHeight),
    );

    // approxCount 이하인 옵션 중 가장 큰 값 선택
    let best: PageSize = 10;
    for (const size of allowedSizes) {
      if (size <= approxCount) {
        best = size;
      }
    }

    setPageSize(best);
    setPageIndex(0);
  }, []);

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

      await updateDoc(doc(firestore, 'voca', VITE_VOCA_ENV, 'users', uid), {
        words: newText,
      });

      nav(generatePath(ROUTE_USER_WORDS, { uid }));
    } catch (e) {
      console.error(e);
      setError('저장 중 오류가 발생했습니다.');
    }
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

  // 페이지네이션 계산
  const totalPages = simpleItems.length === 0
    ? 0
    : Math.ceil(simpleItems.length / pageSize);

  const safePageIndex =
    totalPages === 0 ? 0 : Math.min(pageIndex, totalPages - 1);

  const pagedItems = simpleItems.slice(
    safePageIndex * pageSize,
    safePageIndex * pageSize + pageSize,
  );

  // 간편 에디터: 단어 선택 핸들러
  const handleSelectItem = (lineIndex: number) => {
    setSelectedLineIndex(prev => (prev === lineIndex ? null : lineIndex));
  };

  // 모달 열기 (추가/수정)
  const openAddModal = () => {
    setModalMode('add');
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

    setModalMode('edit');
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

    if (modalMode === 'add') {
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

  // ✅ 간편 → 고급: 선택된 단어 위치로 커서 이동 + 스크롤 조정
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

    // 브라우저가 자동으로 안 내려줄 때를 대비해서 강제로 스크롤
    try {
      const computed = window.getComputedStyle(el);
      const lineHeight =
        parseFloat(computed.lineHeight || '0') || 20; // 기본값 20px 정도로
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

  return (
    <div
      className="container py-4"
      style={{ minHeight: '100vh' }}
    >
      {/* 상단 바 */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="d-flex gap-2">
          <button className="btn btn-outline-light" onClick={handleBack}>
            뒤로
          </button>
          <button className="btn btn-success" onClick={handleSave}>
            변경
          </button>
          <button className="btn btn-secondary" onClick={handleRandom}>
            랜덤배치
          </button>
        </div>

        <div className="d-flex align-items-center gap-2">
          {/* 간편 / 고급 에디터 토글 */}
          <div className="btn-group me-2">
            <button
              className={`btn btn-sm ${
                isSimple ? 'btn-primary' : 'btn-outline-primary'
              }`}
              onClick={() => {
                // 고급 → 간편: 현재 커서 위치 기준으로 선택된 단어 결정
                if (!isSimple && advancedTextareaRef.current) {
                  const el = advancedTextareaRef.current;
                  const caret = el.selectionStart ?? 0;
                  const before = text.slice(0, caret);
                  const lineIndex =
                    before.split(/\r?\n/).length - 1; // 0-based

                  setSelectedLineIndex(lineIndex);

                  // 이 줄이 있는 페이지로 이동
                  const idx = simpleItems.findIndex(
                    item => item.lineIndex === lineIndex,
                  );
                  if (idx !== -1) {
                    const newPageIndex = Math.floor(idx / pageSize);
                    setPageIndex(newPageIndex);
                  }
                }

                setEditorMode(EditorMode.Simple);
              }}
            >
              간편 에디터
            </button>

            <button
              className={`btn btn-sm ${
                !isSimple ? 'btn-primary' : 'btn-outline-primary'
              }`}
              onClick={() => {
                setEditorMode(EditorMode.Advanced);
              }}
            >
              고급 에디터
            </button>
          </div>

          {/* 오른쪽에 로그아웃 버튼 */}
          <LogoutButton />
        </div>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div className="alert alert-danger py-2">
          {error}
        </div>
      )}

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

          {/* ✅ 페이지네이션 컨트롤 + 숫자 입력 */}
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="d-flex align-items-center gap-2">
              <span className="small text-secondary">페이지 당</span>
              <select
                className="form-select form-select-sm bg-black text-light"
                style={{ width: 'auto' }}
                value={pageSize}
                onChange={e => {
                  const newSize = Number(e.target.value) as PageSize;
                  setPageSize(newSize);
                  setPageIndex(0);
                }}
              >
                {/* ✅ 옵션 value 잘못된 부분 정리 + 타입과 일치 */}
                <option value={50}>50개</option>
                <option value={40}>40개</option>
                <option value={30}>30개</option>
                <option value={25}>25개</option>
                <option value={20}>20개</option>
                <option value={15}>15개</option>
                <option value={10}>10개</option>
              </select>
            </div>

            <div className="d-flex align-items-center gap-2">
              <button
                className="btn btn-sm btn-outline-light"
                disabled={safePageIndex <= 0 || totalPages === 0}
                onClick={() =>
                  setPageIndex(prev => Math.max(0, prev - 1))
                }
              >
                ◀
              </button>

              {/* 전체 페이지 */}
              <span className="small text-secondary">
                {`${totalPages} 페이지 중 `}
              </span>

              {/* ✅ 숫자 입력으로 페이지 점프 */}
              <input
                type="number"
                className="form-control form-control-sm bg-black text-light"
                style={{ width: 70 }}
                min={totalPages === 0 ? 0 : 1}
                max={totalPages === 0 ? 0 : totalPages}
                value={totalPages === 0 ? 0 : safePageIndex + 1}
                onChange={e => {
                  if (totalPages === 0) return;
                  const raw = Number(e.target.value);
                  if (Number.isNaN(raw)) return;
                  const clamped = Math.min(
                    totalPages,
                    Math.max(1, raw),
                  );
                  setPageIndex(clamped - 1);
                }}
              />

              <button
                className="btn btn-sm btn-outline-light"
                disabled={
                  totalPages === 0 || safePageIndex >= totalPages - 1
                }
                onClick={() =>
                  setPageIndex(prev =>
                    Math.min(totalPages - 1, prev + 1),
                  )
                }
              >
                ▶
              </button>
            </div>
          </div>

          {/* 단어 리스트 (페이지 단위) */}
          <ul
            className="list-group"
            // ✅ 불릿(점) 제거
            style={{ listStyle: 'none', paddingLeft: 0, marginBottom: 0 }}
          >
            {pagedItems.map(item => {
              const isSelected = item.lineIndex === selectedLineIndex;
              return (
                <li
                  key={item.lineIndex}
                  className={`
                    px-2 bg-black text-light border
                    ${isSelected ? 'border-info' : 'border-secondary'}
                  `}
                  style={{
                    cursor: 'default',
                    backgroundColor: isSelected ? '#1d3557' : '#000',
                  }}
                  onClick={() => handleSelectItem(item.lineIndex)}
                >
                  <span>
                    <span className="fw-bold me-2">{item.word}</span>
                    {item.link && (
                      <span className="text-info small">{item.link}</span>
                    )}
                  </span>
                </li>
              );
            })}
            {simpleItems.length === 0 && (
              <li className="list-group-item bg-black text-secondary">
                유효한 단어 행이 없습니다. 고급 에디터에서 포맷을 수정해주세요.
              </li>
            )}
          </ul>
        </>
      ) : (
        // ✅ 고급 에디터: 브라우저 높이에 맞춰 크게 + 커서 빨간색
        <textarea
          ref={advancedTextareaRef}
          className="form-control bg-black text-light"
          style={{
            height: 'calc(100vh - 200px)',
            minHeight: '50vh',
            caretColor: 'red', // 🔴 커서 색
            whiteSpace: 'pre',     // 🔴 자동 줄바꿈 막기
            overflowX: 'auto',     // 🔴 가로 스크롤 생기게
          }}
          value={text}
          onChange={e => setText(e.target.value)}
        />
      )}

      {/* 모달 (간단한 Bootstrap 스타일 대체) */}
      {modalOpen && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-flex justify-content-center align-items-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1050 }}
        >
          <div className="bg-dark text-light p-3 rounded" style={{ minWidth: 320 }}>
            <h5 className="mb-3">
              {modalMode === 'add' ? '단어 추가' : '단어 수정'}
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
              <button
                className="btn btn-primary btn-sm"
                onClick={handleModalConfirm}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
