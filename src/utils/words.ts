// utils/words.ts
import { nowIso8601Format, isParsableDate } from './date';

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

    const parts = trimmed.split('/|/');

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
      return `${word}/|/${safeLink}/|/${safeAdded}/|/${safeOrder}`;
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

