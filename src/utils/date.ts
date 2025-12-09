// utils/date.ts
export function nowIso8601Format(): string {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');

  // 💡 브라우저에서 실제 offset 구하기 (+09:00, -05:00, 등)
  const offset = getBrowserOffsetString();

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}${offset}`;
}

function getBrowserOffsetString(): string {
  const offsetMinutes = -new Date().getTimezoneOffset(); 
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');

  return `${sign}${hh}:${mm}`;
}

export function isParsableDate(str: string): boolean {
  if (!str) return false;

  const d = new Date(str);
  return !Number.isNaN(d.getTime());
}
