'use client';

import dynamic from 'next/dynamic';
import {
  ArrowUpDown,
  ChevronDown,
  Fuel,
  Loader2,
  MapPin,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import PlaceSearch from '@/components/PlaceSearch';
import ResultList from '@/components/ResultList';
import VisibleStations from '@/components/VisibleStations';
import type { ApiStation } from '@/components/map/useStationLayer';
import { COLLAPSED_PX, useSheetDrag } from '@/components/useSheetDrag';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { Place, PlanResponse } from '@/lib/api-types';
import { FUEL_LABELS, type FuelType } from '@/lib/fuel/types';
import { formatKm, formatMinutes } from '@/lib/format';

// MapLibre는 window에 의존하므로 서버 렌더링에서 제외한다.
const RouteMap = dynamic(() => import('@/components/RouteMap'), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

const FUEL_OPTIONS = Object.entries(FUEL_LABELS) as [FuelType, string][];

export default function Home() {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [fuel, setFuel] = useState<FuelType>('gasoline');
  const [liters, setLiters] = useState(40);
  const [efficiency, setEfficiency] = useState(12);
  const [maxDetour, setMaxDetour] = useState(10);
  const [showOptions, setShowOptions] = useState(false);
  const [showStations, setShowStations] = useState(true);
  // 모바일에서는 지도를 가리지 않도록 패널을 접을 수 있게 한다.
  const [sheetOpen, setSheetOpen] = useState(true);
  const [visible, setVisible] = useState<readonly ApiStation[]>([]);
  const [stats, setStats] = useState<{
    stations: number;
    geocoded: number;
    date: string | null;
  } | null>(null);

  // 헤더 문구를 실제 저장소 현황으로 채운다. 실패해도 화면은 그대로 동작한다.
  useEffect(() => {
    fetch('/api/stats')
      .then((response) => (response.ok ? response.json() : null))
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { dragHeight, isDragging, handlers } = useSheetDrag(sheetOpen, setSheetOpen);

  const canSubmit = origin !== null && destination !== null && !isLoading;

  function swap() {
    setOrigin(destination);
    setDestination(origin);
  }

  async function submit() {
    if (!origin || !destination) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: origin.lat, lon: origin.lon },
          destination: { lat: destination.lat, lon: destination.lon },
          fuel,
          liters,
          efficiencyKmPerL: efficiency,
          maxDetourMinutes: maxDetour,
        }),
      });
      const data = (await response.json()) as PlanResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? '경로 계산에 실패했다.');
      setPlan(data);
      setSelectedId(data.results[0]?.id ?? null);
      // 결과가 나왔으니 접혀 있었다면 펴서 보여준다.
      setSheetOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '알 수 없는 오류');
      setPlan(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="relative h-dvh overflow-hidden lg:flex lg:flex-row">
      {/* 모바일에서는 지도를 화면 전체에 깔고 패널을 그 위에 띄운다. */}
      <div className="absolute inset-0 lg:static lg:order-2 lg:flex-1">
        <RouteMap
          plan={plan}
          selectedId={selectedId}
          onSelect={setSelectedId}
          fuel={fuel}
          showStations={showStations}
          onStations={setVisible}
        />
      </div>

      <aside
        style={
          // 드래그 중에는 손가락 위치를 그대로 높이로 쓴다.
          // 데스크톱에서는 이 값을 무시하도록 lg에서 max-height를 none으로 덮는다.
          dragHeight !== null ? { maxHeight: `${dragHeight}px` } : undefined
        }
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-border bg-background shadow-2xl lg:static lg:z-auto lg:order-1 lg:h-full lg:w-[404px] lg:!max-h-none lg:rounded-none lg:border-t-0 lg:border-r lg:shadow-none ${
          isDragging ? '' : 'transition-[max-height] duration-300 ease-out'
        } ${dragHeight !== null ? '' : sheetOpen ? 'max-h-[78dvh]' : 'max-h-[88px]'}`}
      >
        {/*
          손잡이. 끌어서 여닫고, 거의 안 움직이면 탭으로 처리한다.
          touch-none 이 없으면 브라우저 스크롤 제스처가 먼저 가로채 간다.
          데스크톱에서는 사이드바가 항상 열려 있어 숨긴다.
        */}
        <div
          {...handlers}
          role="button"
          tabIndex={0}
          aria-expanded={sheetOpen}
          aria-label={sheetOpen ? '패널 접기' : '패널 펼치기'}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setSheetOpen(!sheetOpen);
            }
          }}
          className="relative flex shrink-0 cursor-grab touch-none items-center justify-center py-3 active:cursor-grabbing lg:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-muted-foreground/40" />
          <ChevronDown
            className={`absolute right-4 size-4 text-muted-foreground transition-transform ${
              sheetOpen ? '' : 'rotate-180'
            }`}
          />
        </div>
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Fuel className="size-4" />
            </span>
            <div>
              <h1 className="text-sm font-bold leading-tight">경로 위의 싼 주유소</h1>
              <p className="text-[11px] leading-tight text-muted-foreground">
                {stats
                  ? `전국 ${stats.geocoded.toLocaleString('ko-KR')}곳 · ${stats.date ?? ''} 기준`
                  : '전국 주유소 가격'}
              </p>
            </div>
          </div>
          <ThemeToggle />
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="relative space-y-1.5">
            <PlaceSearch
              label="출발지"
              placeholder="어디서 출발하나요?"
              tone="origin"
              value={origin}
              onChange={setOrigin}
            />
            <PlaceSearch
              label="목적지"
              placeholder="어디로 가나요?"
              tone="destination"
              value={destination}
              onChange={setDestination}
            />
            {origin && destination && (
              <Button
                variant="outline"
                size="icon"
                aria-label="출발지와 목적지 바꾸기"
                onClick={swap}
                className="absolute -right-1 top-1/2 size-8 -translate-y-1/2 rounded-full bg-background shadow-sm"
              >
                <ArrowUpDown className="size-3.5" />
              </Button>
            )}
          </div>

          <div className="space-y-2.5 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">연료</Label>
              <Select value={fuel} onValueChange={(next) => setFuel(next as FuelType)}>
                <SelectTrigger className="h-8 w-28" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FUEL_OPTIONS.map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/*
              스위치 모양으로 두어 실수로 눌러도 무엇이 바뀌는지 바로 보이게 한다.
              전체 폭 버튼이면 패널을 접으려다 잘못 누르기 쉽다.
            */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              <span>지도에 주유소 가격 표시</span>
              <button
                type="button"
                role="switch"
                aria-checked={showStations}
                aria-label="지도에 주유소 가격 표시"
                onClick={() => setShowStations((previous) => !previous)}
                className={`ml-auto flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  showStations ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              >
                <span
                  className={`size-4 rounded-full bg-background shadow-sm transition-transform ${
                    showStations ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowOptions((previous) => !previous)}
              className="flex w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <SlidersHorizontal className="size-3" />
              주유량 {liters}L · 연비 {efficiency}km/L · 우회 {maxDetour}분까지
            </button>

            {showOptions && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                <NumberField label="주유량(L)" value={liters} min={1} max={200} onChange={setLiters} />
                <NumberField label="연비" value={efficiency} min={1} max={50} onChange={setEfficiency} />
                <NumberField label="우회(분)" value={maxDetour} min={0} max={120} onChange={setMaxDetour} />
              </div>
            )}
          </div>

          <Button
            className="h-11 w-full rounded-xl text-sm font-semibold"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {isLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                계산 중...
              </>
            ) : (
              <>
                <Search className="size-4" />
                싼 주유소 찾기
              </>
            )}
          </Button>

          {error && (
            <p className="rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </p>
          )}

          {plan && (
            <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
              기본 경로{' '}
              <strong className="font-semibold text-foreground tabular-nums">
                {formatKm(plan.base.distanceKm)}
              </strong>{' '}
              ·{' '}
              <strong className="font-semibold text-foreground tabular-nums">
                {formatMinutes(plan.base.durationMinutes)}
              </strong>{' '}
              · 후보 {plan.stationsConsidered}곳 검토
            </div>
          )}

          {plan && plan.results.length === 0 && (
            <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
              우회 {maxDetour}분 안에 들를 수 있는 주유소가 없다. 우회 시간을 늘려보라.
            </p>
          )}

          {/* 경로 검색 전에는 지금 보이는 지역의 최저가를 대신 보여준다. */}
          {plan === null && showStations && (
            <VisibleStations stations={visible} limit={8} />
          )}

          <ResultList
            results={plan?.results ?? []}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          <p className="pt-2 text-[10px] leading-relaxed text-muted-foreground/70">
            지도 © OpenStreetMap contributors · 경로 OSRM · 가격 한국석유공사 오피넷
            <br />
            {stats && stats.geocoded < stats.stations
              ? `좌표 확보 ${stats.geocoded.toLocaleString('ko-KR')}/${stats.stations.toLocaleString('ko-KR')} — 지오코딩 진행 중이라 일부 주유소가 아직 안 보인다.`
              : '고속도로 휴게소는 방향별로 진입 가능 여부가 다르다.'}
          </p>
        </div>
      </aside>

    </main>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          // 빈 입력이나 범위 밖 값으로 상태가 오염되지 않게 막는다.
          if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
        }}
        className="h-8 tabular-nums"
      />
    </div>
  );
}
