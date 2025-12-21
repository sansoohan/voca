// pages/WordListPage/components/WordListFrame/index.tsx
import { type JSX } from 'react';
import { SEP } from '~/constants/editor';

import './index.css';

type WordListFrameProps = {
  wordItemFontSize: string;
  coreVisible: boolean;
  viewLines: string[];
  pagedLines: string[];
  pageStart: number;
  pageSize: number;
  safePageIndex: number;
  totalPages: number;
  rawLines: string[];
};

export function WordListFrame({
  wordItemFontSize,
  coreVisible,
  viewLines,
  pagedLines,
  pageStart,
  pageSize,
  safePageIndex,
  totalPages,
  rawLines,
}: WordListFrameProps) {
  // -------------------------
  // 괄호 색칠 (코드 에디터 느낌)
  // - [ ] : depth에 따라 색 변경
  // - ( ) { } < > : 고정색
  // -------------------------
  const renderBrackets = (text: string): JSX.Element[] => {
    const out: JSX.Element[] = [];
    let sqDepth = 0;

    const sqDepthClasses = [
      'wf-sq-depth-0',
      'wf-sq-depth-1',
      'wf-sq-depth-2',
      'wf-sq-depth-3',
      'wf-sq-depth-4',
    ];

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === '[') {
        const cls = sqDepthClasses[sqDepth % sqDepthClasses.length];
        out.push(
          <span key={i} className={`wf-br ${cls}`}>
            [
          </span>,
        );
        sqDepth++;
        continue;
      }

      if (ch === ']') {
        sqDepth = Math.max(0, sqDepth - 1);
        const cls = sqDepthClasses[sqDepth % sqDepthClasses.length];
        out.push(
          <span key={i} className={`wf-br ${cls}`}>
            ]
          </span>,
        );
        continue;
      }

      if (ch === '(' || ch === ')') {
        out.push(
          <span key={i} className="wf-br wf-paren">
            {ch}
          </span>,
        );
        continue;
      }

      if (ch === '{' || ch === '}') {
        out.push(
          <span key={i} className="wf-br wf-brace">
            {ch}
          </span>,
        );
        continue;
      }

      if (ch === '<' || ch === '>') {
        out.push(
          <span key={i} className="wf-br wf-angle">
            {ch}
          </span>,
        );
        continue;
      }

      out.push(<span key={i}>{ch}</span>);
    }

    return out;
  };

  return (
    <div
      className={[
        'bg-black',
        'wordlist-core-zone',
        coreVisible ? 'wordlist-core-zone-visible' : '',
      ].join(' ')}
      style={{
        flexShrink: 0,
        maxWidth: 720,
        minWidth: 260,
        borderRadius: 10,
        padding: 6,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 액자 느낌의 이너 프레임 */}
      <div className="wordlist-core-frame">
        <ul
          key={safePageIndex}
          className="wordlist-core-list"
        >
          {(() => {
            if (viewLines.length === 0) {
              return (
                <li
                  style={{ padding: '4px 6px', fontSize: '0.9rem' }}
                  className="text-secondary"
                >
                  {rawLines.length === 0
                    ? '단어가 없습니다. 에디터에서 단어를 추가해 주세요.'
                    : '검색 결과가 없습니다.'}
                </li>
              );
            }

            const items: JSX.Element[] = [];

            const isLastPage = totalPages > 0 && safePageIndex === totalPages - 1;
            const realCount = pagedLines.length;
            const padCount = isLastPage ? Math.max(0, pageSize - realCount) : 0;

            // 실제 단어 라인
            pagedLines.forEach((line: string, localIdx: number) => {
              // pageStart/localIdx는 “viewLines 기준”
              const viewIdx = pageStart + localIdx;

              const parts = line.split(SEP);
              const word = parts[0]?.trim();
              const link = parts[1]?.trim();
              const hasLink = !!link;

              items.push(
                <li
                  key={`view-${viewIdx}`}
                  className="wordlist-core-item"
                  style={{fontSize: wordItemFontSize}}
                >
                  {hasLink ? (
                    <a
                      href={link}
                      className="text-decoration-none wordlist-core-link"
                    >
                      <span className="fw-bold">{renderBrackets(word)}</span>
                    </a>
                  ) : (
                    <span className="fw-bold text-light wordlist-core-word">
                      {renderBrackets(word)}
                    </span>
                  )}
                </li>,
              );
            });

            // 마지막 페이지면 빈 줄로 패딩
            for (let i = 0; i < padCount; i++) {
              items.push(
                <li
                  key={`pad-${i}`}
                  className="wordlist-core-item wordlist-core-item-pad"
                >
                  ·
                </li>,
              );
            }

            return items;
          })()}
        </ul>
      </div>
    </div>
  );
}
