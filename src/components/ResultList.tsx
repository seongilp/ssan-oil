'use client';

import { Clock, Route, TrendingDown } from 'lucide-react';
import type { PlanResult } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { formatKm, formatMinutes, formatWon } from '@/lib/format';
import { cn } from '@/lib/utils';

type Props = {
  readonly results: readonly PlanResult[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
};

export default function ResultList({ results, selectedId, onSelect }: Props) {
  if (results.length === 0) return null;

  return (
    <ol className="space-y-2">
      {results.map((result, index) => {
        const isBest = index === 0;
        const isSelected = result.id === selectedId;

        return (
          <li key={result.id}>
            <button
              type="button"
              onClick={() => onSelect(result.id)}
              className={cn(
                'w-full rounded-2xl border bg-card p-3.5 text-left transition-all',
                'hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                isSelected
                  ? 'border-primary ring-2 ring-primary/20'
                  : 'border-border',
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums',
                    isBest
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{result.name}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {result.brand}
                        {result.routeName ? ` · ${result.routeName}` : ''}
                        {result.direction ? ` · ${result.direction} 방향` : ''}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-base font-bold tabular-nums">
                        {result.price.toLocaleString('ko-KR')}
                        <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">
                          원/L
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" />+{formatMinutes(result.extraMinutes)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Route className="size-3" />+{formatKm(result.extraKm)}
                    </span>
                    <span className="ml-auto font-medium text-foreground tabular-nums">
                      총 {formatWon(result.totalCost)}
                    </span>
                  </div>

                  {isBest && result.savingVsWorst > 0 && (
                    <Badge
                      variant="secondary"
                      className="mt-2.5 gap-1 border-0 bg-success/10 text-success"
                    >
                      <TrendingDown className="size-3" />
                      {formatWon(result.savingVsWorst)} 절약
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
