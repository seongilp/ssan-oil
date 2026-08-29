'use client';

import {
  GeoJSONSource,
  GeolocateControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import type { PlanResponse, PlanResult } from '@/lib/api-types';
import { formatWon } from '@/lib/format';
import MapLegend from '@/components/map/MapLegend';
import {
  useStationLayer,
  type ApiStation,
} from '@/components/map/useStationLayer';
import type { StoreFuel } from '@/lib/store/queries';

/**
 * OpenFreeMap 벡터 타일. API 키가 필요 없고 호출 제한도 없으며
 * positron(라이트)/dark(다크) 두 스타일이 있어 앱 테마를 그대로 따라간다.
 * (CARTO 베이스맵은 2025년부터 키를 요구해 워터마크가 찍힌다.)
 */
const STYLE_URL: Record<'light' | 'dark', string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

const ROUTE_SOURCE = 'route';

/** 위치 권한을 못 받았을 때 보여줄 기본 위치. */
const FALLBACK_CENTER: [number, number] = [126.978, 37.5665];
const FALLBACK_ZOOM = 11;

/** 마지막으로 본 위치를 기억해 다음 방문 때 즉시 그 동네를 보여준다. */
const LAST_VIEW_KEY = 'ssan-oil:last-view';

type SavedView = { lon: number; lat: number; zoom: number };

function readSavedView(): SavedView | null {
  try {
    const raw = localStorage.getItem(LAST_VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedView>;
    if (
      typeof parsed.lon !== 'number' ||
      typeof parsed.lat !== 'number' ||
      typeof parsed.zoom !== 'number'
    ) {
      return null;
    }
    return { lon: parsed.lon, lat: parsed.lat, zoom: parsed.zoom };
  } catch {
    // 사생활 보호 모드 등에서 localStorage 접근 자체가 막힐 수 있다.
    return null;
  }
}

function saveView(map: MapLibreMap): void {
  try {
    const center = map.getCenter();
    localStorage.setItem(
      LAST_VIEW_KEY,
      JSON.stringify({ lon: center.lng, lat: center.lat, zoom: map.getZoom() }),
    );
  } catch {
    // 저장에 실패해도 지도 동작에는 영향이 없다.
  }
}

type Props = {
  readonly plan: PlanResponse | null;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /** 상시 표시할 주유소 레이어의 연료 종류. */
  readonly fuel: StoreFuel;
  readonly showStations: boolean;
  readonly onStations?: (stations: readonly ApiStation[]) => void;
};

type LocatedResult = PlanResult & { coord: NonNullable<PlanResult['coord']> };

export default function RouteMap({
  plan,
  selectedId,
  onSelect,
  fuel,
  showStations,
  onStations,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  /** 현재 적용된 스타일 URL. 같은 스타일을 다시 setStyle 하면 타일이 리셋된다. */
  const styleUrlRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // 훅에 넘기려면 지도 인스턴스가 상태여야 한다(ref는 변경을 알리지 못한다).
  const [map, setMap] = useState<MapLibreMap | null>(null);

  const { resolvedTheme } = useTheme();
  const mode: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';

  // 지도 인스턴스는 한 번만 만든다. 이후 갱신은 스타일/소스/마커 교체로 처리한다.
  // 초기 스타일은 resolvedTheme이 확정되기 전에 결정되므로, 아래 테마 이펙트가
  // 실제로 다른 스타일일 때만 교체한다.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    styleUrlRef.current = STYLE_URL.light;

    // 지난번에 보던 곳이 있으면 거기서 시작한다. 전국 뷰는 너무 넓어 쓸모가 없다.
    const saved = readSavedView();
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL.light,
      center: saved ? [saved.lon, saved.lat] : FALLBACK_CENTER,
      zoom: saved?.zoom ?? FALLBACK_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: false, timeout: 8000 },
      trackUserLocation: false,
      showAccuracyCircle: false,
    });
    map.addControl(geolocate, 'top-right');

    mapRef.current = map;
    map.once('load', () => {
      setMap(map);
      // 저장된 위치가 없을 때만 자동으로 현재 위치를 묻는다.
      // 이미 보던 곳이 있으면 사용자가 버튼을 눌러 옮기도록 둔다.
      if (!saved) geolocate.trigger();
    });

    map.on('moveend', () => saveView(map));

    return () => {
      map.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, []);

  useStationLayer(map, fuel, showStations, mode === 'dark', onStations);

  // 테마가 바뀌면 베이스맵만 교체한다. 경로 레이어는 아래 이펙트가 다시 그린다.
  //
  // 초기 스타일이 아직 로드 중일 때 setStyle을 부르면 타일 요청이 끊기고
  // 지도가 빈 화면으로 멈춘다. 그래서 (1) 스타일이 실제로 달라졌을 때만,
  // (2) 최초 로드가 끝난 뒤에만 교체한다.
  useEffect(() => {
    const map = mapRef.current;
    const next = STYLE_URL[mode];
    if (!map || styleUrlRef.current === next) return;

    const apply = () => {
      styleUrlRef.current = next;
      map.setStyle(next, { diff: false });
    };

    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !plan) return;

    const draw = () => {
      const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: plan.base.geometry.map(([lon, lat]) => [lon, lat]),
        },
      };

      const existing = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
      if (existing) {
        existing.setData(geojson);
      } else {
        map.addSource(ROUTE_SOURCE, { type: 'geojson', data: geojson });
        // 흰 테두리를 깔아 어두운 배경에서도 경로선이 떠 보이게 한다.
        map.addLayer({
          id: `${ROUTE_SOURCE}-casing`,
          type: 'line',
          source: ROUTE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': mode === 'dark' ? '#16181d' : '#ffffff',
            'line-width': 9,
          },
        });
        map.addLayer({
          id: ROUTE_SOURCE,
          type: 'line',
          source: ROUTE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#3182f6', 'line-width': 5 },
        });
      }

      for (const marker of markersRef.current) marker.remove();
      markersRef.current = plan.results
        .filter((result): result is LocatedResult => result.coord !== null)
        .map((result, index) => {
          const isBest = index === 0;
          const isSelected = result.id === selectedId;

          const element = document.createElement('button');
          element.type = 'button';
          element.textContent = String(index + 1);
          element.title = `${result.name} · ${formatWon(result.price)}/L`;
          element.className = [
            'flex size-7 items-center justify-center rounded-full',
            'border-2 border-white text-[11px] font-bold tabular-nums text-white',
            'shadow-md transition-transform',
            isSelected ? 'scale-125 ring-2 ring-primary/40' : '',
            isBest ? 'bg-[#3182f6]' : 'bg-slate-500',
          ].join(' ');
          element.addEventListener('click', () => onSelectRef.current(result.id));

          return new Marker({ element })
            .setLngLat([result.coord.lon, result.coord.lat])
            .addTo(map);
        });

      const first = plan.base.geometry[0];
      const bounds = plan.base.geometry.reduce(
        (accumulator, coordinate) => accumulator.extend(coordinate),
        new LngLatBounds(first, first),
      );
      map.fitBounds(bounds, { padding: 56, duration: 600 });
    };

    if (map.isStyleLoaded()) draw();
    else map.once('styledata', draw);
  }, [plan, selectedId, mode]);

  return (
    <div className="relative size-full">
      <div ref={containerRef} className="size-full" />
      {showStations && <MapLegend />}
    </div>
  );
}
