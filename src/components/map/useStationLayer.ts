'use client';

import {
  Popup,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type Map as MapLibreMap,
} from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { StoreFuel } from '@/lib/store/queries';
import { buildStationPopup, type PopupStation } from './station-popup';

/** 이 줌보다 멀면 마커가 너무 많아 의미가 없다. */
const MIN_ZOOM = 10;
/** 지도를 움직이는 동안 매번 부르지 않도록 두는 지연(ms). */
const DEBOUNCE_MS = 350;

const SOURCE_ID = 'stations';
const CIRCLE_LAYER = 'stations-circle';
const LABEL_LAYER = 'stations-label';

export type ApiStation = {
  id: string;
  name: string;
  brand: string;
  address: string;
  isSelf: boolean;
  price: number;
  coord: { lat: number; lon: number };
};

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

type PriceStats = { count: number; p25: number; p75: number };

function toFeatureCollection(
  stations: readonly ApiStation[],
  stats: PriceStats | null,
): GeoJSON.FeatureCollection {
  if (stations.length === 0) return EMPTY;

  // 색 기준은 화면 안 '전체' 분포에서 온다. 마커가 잘렸을 때
  // 남은 것만으로 백분위를 내면 전부 싼 것뿐이라 색이 무의미해진다.
  const cheapCutoff = stats?.p25 ?? stations[0].price;
  const pricyCutoff = stats?.p75 ?? stations[stations.length - 1].price;

  // 화면 안 최저가. 목록이 가격 오름차순이라 첫 항목이 최저가다.
  // 같은 값이 여러 곳이면 모두 최저가로 본다.
  const bestPrice = Math.min(...stations.map((station) => station.price));

  return {
    type: 'FeatureCollection',
    features: stations.map((station) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [station.coord.lon, station.coord.lat] },
      properties: {
        // 팝업에서 다시 쓰려면 원본을 통째로 실어 보내는 편이 단순하다.
        station: JSON.stringify(station),
        id: station.id,
        name: station.name,
        brand: station.brand,
        price: station.price,
        label: station.price.toLocaleString('ko-KR'),
        tier:
          station.price === bestPrice
            ? 'best'
            : station.price <= cheapCutoff
              ? 'cheap'
              : station.price >= pricyCutoff
                ? 'pricy'
                : 'mid',
      },
    })),
  };
}

function ensureLayers(map: MapLibreMap, dark: boolean): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY });
  }

  if (!map.getLayer(CIRCLE_LAYER)) {
    map.addLayer({
      id: CIRCLE_LAYER,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 4,
        'circle-color': [
          'match',
          ['get', 'tier'],
          'cheap', '#15b76d',
          'pricy', '#8b95a1',
          '#3182f6',
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': dark ? '#16181d' : '#ffffff',
      },
    });
  }

  if (!map.getLayer(LABEL_LAYER)) {
    map.addLayer({
      id: LABEL_LAYER,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': ['case', ['==', ['get', 'tier'], 'best'], 13, 11],
        'text-offset': [0, -1.1],
        'text-allow-overlap': false,
        // symbol-sort-key가 작을수록 먼저 배치된다. 가격 오름차순이므로
        // 라벨이 겹칠 때 싼 곳이 살아남고, 최저가는 항상 표시된다.
        // (text-ignore-placement는 데이터 기반 표현식을 지원하지 않는다.)
        'symbol-sort-key': ['get', 'price'],
      },
      paint: {
        'text-color': [
          'match',
          ['get', 'tier'],
          'best', dark ? '#ff6b76' : '#f04452',
          'cheap', dark ? '#2bd98a' : '#0f7a49',
          'pricy', dark ? '#9ba3af' : '#6b7684',
          dark ? '#7aa9f8' : '#1b64da',
        ],
        // 라이트/다크 어느 배경에서도 라벨이 읽히도록 테두리를 배경색에 맞춘다.
        'text-halo-color': dark ? '#16181d' : '#ffffff',
        'text-halo-width': 1.5,
      },
    });
  }
}

/**
 * 현재 보이는 영역의 주유소를 가격 라벨과 함께 지도에 상시 표시한다.
 * 경로 검색과 무관하게 동작하며, 데이터는 저장소에서만 온다(외부 API 호출 0).
 */
/** 마커를 누르면 주유소 상세와 길안내 링크를 띄운다. */
function installPopup(map: MapLibreMap): () => void {
  const popup = new Popup({ closeButton: true, offset: 12, maxWidth: '260px' });

  const onClick = (event: MapLayerMouseEvent) => {
    const raw = event.features?.[0]?.properties?.station;
    if (typeof raw !== 'string') return;

    let station: PopupStation;
    try {
      station = JSON.parse(raw) as PopupStation;
    } catch {
      return;
    }

    popup
      .setLngLat([station.coord.lon, station.coord.lat])
      .setDOMContent(buildStationPopup(station))
      .addTo(map);
  };

  const enter = () => {
    map.getCanvas().style.cursor = 'pointer';
  };
  const leave = () => {
    map.getCanvas().style.cursor = '';
  };

  for (const layer of [CIRCLE_LAYER, LABEL_LAYER]) {
    map.on('click', layer, onClick);
    map.on('mouseenter', layer, enter);
    map.on('mouseleave', layer, leave);
  }

  return () => {
    popup.remove();
    for (const layer of [CIRCLE_LAYER, LABEL_LAYER]) {
      map.off('click', layer, onClick);
      map.off('mouseenter', layer, enter);
      map.off('mouseleave', layer, leave);
    }
  };
}

export function useStationLayer(
  map: MapLibreMap | null,
  fuel: StoreFuel,
  enabled: boolean,
  dark: boolean,
  onStations?: (stations: readonly ApiStation[]) => void,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onStationsRef = useRef(onStations);
  onStationsRef.current = onStations;

  useEffect(() => {
    if (!map) return;

    const refresh = async () => {
      if (!map.getStyle()) return;
      ensureLayers(map, dark);

      const visible = enabled && map.getZoom() >= MIN_ZOOM;
      map.setLayoutProperty(CIRCLE_LAYER, 'visibility', visible ? 'visible' : 'none');
      map.setLayoutProperty(LABEL_LAYER, 'visibility', visible ? 'visible' : 'none');
      if (!visible) return;

      const bounds = map.getBounds();
      const params = new URLSearchParams({
        west: String(bounds.getWest()),
        south: String(bounds.getSouth()),
        east: String(bounds.getEast()),
        north: String(bounds.getNorth()),
        fuel,
        limit: '200',
      });

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`/api/stations?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          stations?: ApiStation[];
          stats?: PriceStats | null;
        };
        const stations = data.stations ?? [];
        const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
        source?.setData(toFeatureCollection(stations, data.stats ?? null));
        onStationsRef.current?.(stations);
      } catch {
        // 지도를 계속 움직이면 이전 요청이 취소된다. 정상 흐름이므로 무시한다.
      }
    };

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void refresh(), DEBOUNCE_MS);
    };

    const removePopup = installPopup(map);
    map.on('moveend', schedule);
    map.on('styledata', schedule);
    schedule();

    return () => {
      removePopup();
      map.off('moveend', schedule);
      map.off('styledata', schedule);
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [map, fuel, enabled, dark]);
}
