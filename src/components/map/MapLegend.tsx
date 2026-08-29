'use client';

const TIERS = [
  { color: '#f04452', label: '최저가' },
  { color: '#15b76d', label: '싼 편' },
  { color: '#3182f6', label: '보통' },
  { color: '#8b95a1', label: '비싼 편' },
] as const;

/** 마커 색이 무엇을 뜻하는지 알려준다. 기준은 '화면에 보이는 범위 안에서'다. */
export default function MapLegend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-xl border border-border bg-background/90 px-2.5 py-2 text-[10px] shadow-sm backdrop-blur">
      <div className="mb-1 font-medium text-muted-foreground">화면 안 가격 비교</div>
      <div className="flex items-center gap-2.5">
        {TIERS.map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1">
            <span
              className="size-2 rounded-full ring-1 ring-background"
              style={{ backgroundColor: color }}
            />
            <span className="text-foreground">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
