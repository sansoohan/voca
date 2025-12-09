import type { PageSize } from '~/types/editor';
import { allowedPageSizes } from '~/constants/editor';

type Props = {
  className?: string;
  pageSize: PageSize;
  pageIndex: number;   // 0-based (현재 페이지 index, safe한 값)
  totalPages: number;
  onPageSizeChange: (size: PageSize) => void;
  onPageIndexChange: (index: number) => void; // 0-based로 콜백
};

export function PaginationControls({
  className,
  pageSize,
  pageIndex,
  totalPages,
  onPageSizeChange,
  onPageIndexChange,
}: Props) {
  const canPrev = totalPages > 0 && pageIndex > 0;
  const canNext = totalPages > 0 && pageIndex < totalPages - 1;

  const displayPage = totalPages === 0 ? 0 : pageIndex + 1;

  return (
    <div className={`d-flex align-items-center gap-3 ${className ?? ''}`}>
      {/* 페이지당 개수 선택 */}
      <div className="d-flex align-items-center gap-2">
        <span className="small text-secondary">페이지 당</span>
        <select
          className="form-select form-select-sm bg-black text-light"
          style={{ width: 'auto' }}
          value={pageSize}
          onChange={e => {
            const newSize = Number(e.target.value) as PageSize;
            onPageSizeChange(newSize);
          }}
        >
          {allowedPageSizes.map(size => (
            <option key={size} value={size}>{`${size}개`}</option>
          ))}
        </select>
      </div>

      {/* 페이지 이동 컨트롤 */}
      <div className="d-flex align-items-center gap-2">
        <button
          className="btn btn-sm btn-outline-light"
          disabled={!canPrev}
          onClick={() => {
            if (!canPrev) return;
            onPageIndexChange(pageIndex - 1);
          }}
        >
          ◀
        </button>

        <span className="small text-secondary">
          {totalPages === 0 ? '0 / 0' : `${displayPage} / ${totalPages}`}
        </span>

        <input
          type="number"
          className="form-control form-control-sm bg-black text-light"
          style={{ width: 70 }}
          min={totalPages === 0 ? 0 : 1}
          max={totalPages === 0 ? 0 : totalPages}
          value={displayPage}
          onChange={e => {
            if (totalPages === 0) return;
            const raw = Number(e.target.value);
            if (Number.isNaN(raw)) return;
            const clamped = Math.min(
              totalPages,
              Math.max(1, raw),
            );
            onPageIndexChange(clamped - 1);
          }}
        />

        <button
          className="btn btn-sm btn-outline-light"
          disabled={!canNext}
          onClick={() => {
            if (!canNext) return;
            onPageIndexChange(pageIndex + 1);
          }}
        >
          ▶
        </button>
      </div>
    </div>
  );
}
