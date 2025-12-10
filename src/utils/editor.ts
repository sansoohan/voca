// utils/words.ts
import type { PageSize, SimpleItem } from '~/types/editor';
import { allowedPageSizes, SEP } from '~/constants/editor';
import { nowIso8601Format, isParsableDate } from '~/utils/date';

export interface WordLine {
  word: string;
  link: string;
  addedAt: string;
  order: string;
}

export function parseTextToWordLines(raw: string): WordLine[] {
  const lines = raw.split('\n');
  const result: WordLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue; // 빈 줄 삭제

    const parts = trimmed.split(SEP);

    // 1. 그 줄의 단어가 위 형태가 아니면 그 줄은 삭제
    // => 최소한 <단어>는 있어야 함.
    const word = (parts[0] ?? '').trim();
    if (!word) continue;

    const link = (parts[1] ?? '').trim();
    let addedAt = (parts[2] ?? '').trim();
    const order = (parts[3] ?? '').trim();

    // 2,3. <단어> 또는 <단어>/|/<링크> 처리:
    // addedAt 이 없거나 포맷이 아니면 현재시간으로
    if (!addedAt || !isParsableDate(addedAt)) {
      addedAt = nowIso8601Format();
    }

    // order 는 나중에 textarea 줄 번호로 다시 채울 거라
    // 지금은 빈 값이어도 상관 없음

    result.push({ word, link, addedAt, order });
  }

  // 5. 모든 단어들의 <순번>을 textarea 몇번째 줄인지에 따라 변경
  // → result 배열 순서를 textarea 순서라고 보면 됨.
  return result.map((item, index) => ({
    ...item,
    order: String(index + 1),
  }));
}

// WordLine 배열 -> 저장용 문자열
export function wordLinesToText(lines: WordLine[]): string {
  return lines
    .map(({ word, link, addedAt, order }) => {
      const safeLink = link ?? '';
      const safeAdded = addedAt ?? '';
      const safeOrder = order ?? '';
      return `${word}${SEP}${safeLink}${SEP}${safeAdded}${SEP}${safeOrder}`;
    })
    .join('\n');
}

// 랜덤 배치 (DB 저장은 안 하고 textarea 에만 반영)
export function shuffleLines(raw: string): string {
  const lines = raw
    .split('\n')
    .map(l => l)
    .filter(l => l.trim().length > 0);

  for (let i = lines.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }

  return lines.join('\n');
}

export const computeInitialPageSize = (
  reservedForHeader: number,
  approximateRowHeight: number,
): PageSize => {
  const vh = window.innerHeight;
  const available = Math.max(0, vh - reservedForHeader);

  const approxCount = Math.max(5, Math.floor(available / approximateRowHeight));

  let best: PageSize = 10;
  for (const size of allowedPageSizes) {
    if (size <= approxCount) best = size;
  }
  return best;
};

export function paginate<T>(
  items: T[],
  pageSize: PageSize,
  pageIndex: number,
) {
  const totalPages =
    items.length === 0 ? 0 : Math.ceil(items.length / pageSize);

  const safePageIndex =
    totalPages === 0 ? 0 : Math.min(pageIndex, totalPages - 1);

  const pageStart = safePageIndex * pageSize;
  const pagedItems = items.slice(pageStart, pageStart + pageSize);

  return {
    totalPages,
    safePageIndex,
    pageStart,
    pagedItems,
  };
}

// 한 줄을 파싱해서 단어/링크만 뽑아보고, 잘못된 포맷이면 null
export function parseLineForSimple(line: string, index: number): SimpleItem | null {
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