'use client';

import { ExternalLink } from 'lucide-react';
import type { ApiStation } from '@/components/map/useStationLayer';

type Props = {
  readonly stations: readonly ApiStation[];
  readonly limit: number;
};

/**
 * 경로 검색 전에도 쓸모가 있도록, 지금 지도에 보이는 범위의 최저가를 보여준다.
 * 지도를 옮기면 목록도 따라 바뀐다.
 */
export default function VisibleStations({ stations, limit }: Props) {
  if (stations.length === 0) return null;
  const top = stations.slice(0, limit);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold">이 지역 최저가</h2>
        <span className="text-[11px] text-muted-foreground">
          화면 안 {stations.length}곳
        </span>
      </div>

      <ol className="space-y-1">
        {top.map((station, index) => (
          <li key={station.id}>
            <a
              href={`https://map.kakao.com/link/to/${encodeURIComponent(station.name)},${station.coord.lat},${station.coord.lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted"
            >
              <span className="w-3 shrink-0 text-[11px] font-medium text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{station.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {station.brand}
                  {station.isSelf ? ' · 셀프' : ''}
                </span>
              </span>
              <span className="shrink-0 text-xs font-bold tabular-nums">
                {station.price.toLocaleString('ko-KR')}
              </span>
              <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
