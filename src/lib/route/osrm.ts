import type { Coord } from '../fuel/types';

/**
 * OSRM 공개 데모 서버. OSM 도로망 기반이며 API 키가 없다.
 * 이용정책상 상업적 사용은 불가하고 호출량 제한이 있으므로, 후보를 좁힌 뒤에만 호출한다.
 */
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

export type RouteResult = {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  /** [lon, lat] 순서. GeoJSON/turf/MapLibre가 모두 이 순서를 쓴다. */
  readonly geometry: readonly [number, number][];
};

type OsrmResponse = {
  code?: string;
  message?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
  }>;
};

/**
 * 경유지를 순서대로 지나는 경로를 구한다.
 * waypoints 는 최소 2개(출발지, 목적지)여야 한다.
 */
export async function fetchRoute(
  waypoints: readonly Coord[],
  signal?: AbortSignal,
): Promise<RouteResult> {
  if (waypoints.length < 2) {
    throw new Error('경로 계산에는 출발지와 목적지가 모두 필요하다.');
  }

  const path = waypoints.map(({ lat, lon }) => `${lon},${lat}`).join(';');
  const url = new URL(`${OSRM_BASE}/${path}`);
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`OSRM 응답 실패: HTTP ${response.status}`);
  }

  const data = (await response.json()) as OsrmResponse;
  if (data.code && data.code !== 'Ok') {
    throw new Error(`OSRM 경로 계산 실패: ${data.code} ${data.message ?? ''}`);
  }

  const route = data.routes?.[0];
  const coordinates = route?.geometry?.coordinates;
  if (
    !route ||
    typeof route.distance !== 'number' ||
    typeof route.duration !== 'number' ||
    !coordinates?.length
  ) {
    throw new Error('OSRM 응답에 유효한 경로가 없다.');
  }

  return {
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    geometry: coordinates,
  };
}
