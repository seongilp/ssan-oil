import { lineString, nearestPointOnLine, point } from '@turf/turf';
import type { FuelType, Station } from '../fuel/types';
import type { TripParams } from './cost';
import type { RouteResult } from './osrm';

export type Candidate = {
  readonly station: Station;
  readonly price: number;
  /** 경로 폴리라인까지의 직선 거리(km). 실제 우회거리가 아니라 후보를 좁히는 용도다. */
  readonly corridorKm: number;
  /** 실제 경로 계산 전, 순위를 매기기 위한 총비용 추정치(원). */
  readonly estimatedCost: number;
};

/**
 * 경로 주변 회랑(corridor) 안에서 후보를 고른다.
 *
 * 가격만 보고 자르면 안 된다. 회랑 끝자락의 최저가 주유소들이 상위를 채워버리고,
 * 그것들이 전부 우회 시간 초과로 탈락하면 결과가 비어버린다.
 * 실제 OSRM 호출 전에 '주유비 + 왕복 우회 주행비'로 총비용을 추정해 순위를 매긴다.
 */
export function selectCandidates(
  stations: readonly Station[],
  route: RouteResult,
  fuel: FuelType,
  corridorKm: number,
  limit: number,
  params: TripParams,
): Candidate[] {
  // 좌표가 2개 미만이면 turf가 LineString을 만들지 못한다.
  if (route.geometry.length < 2) return [];
  const line = lineString(route.geometry.map(([lon, lat]) => [lon, lat]));

  const candidates: Candidate[] = [];
  for (const station of stations) {
    const { coord } = station;
    const price = station.prices[fuel];
    if (!coord || price === undefined) continue;

    const snapped = nearestPointOnLine(line, point([coord.lon, coord.lat]), {
      units: 'kilometers',
    });
    const distance = snapped.properties.dist;
    if (typeof distance !== 'number' || distance > corridorKm) continue;

    // 경로에서 벗어났다가 돌아와야 하므로 추가 주행은 최소 왕복 거리다.
    const estimatedExtraKm = distance * 2;
    const estimatedCost =
      params.liters * price +
      (params.efficiencyKmPerL > 0
        ? (estimatedExtraKm / params.efficiencyKmPerL) * price
        : 0);

    candidates.push({ station, price, corridorKm: distance, estimatedCost });
  }

  candidates.sort(
    (a, b) => a.estimatedCost - b.estimatedCost || a.corridorKm - b.corridorKm,
  );
  return candidates.slice(0, limit);
}
