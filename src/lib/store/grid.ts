import type { Coord } from '../fuel/types';

/** aroundAll의 최대 반경(m). 이보다 크게 요청해도 5km로 잘린다. */
export const SWEEP_RADIUS_M = 5000;

/**
 * 반경 r인 원으로 평면을 빈틈없이 덮으려면 육각 배치에서
 * 중심 간격이 r*√3 이어야 한다. 경계 오차를 감안해 조금 좁힌다.
 */
const SPACING_M = SWEEP_RADIUS_M * Math.sqrt(3) * 0.92;

const METERS_PER_DEG_LAT = 111_320;

const metersPerDegLon = (lat: number): number =>
  METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

export type Bounds = {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
};

/** 좌표를 셀 키로 쓸 수 있게 고정 자릿수로 반올림한다. */
export const roundCoord = (value: number): number => Math.round(value * 1e5) / 1e5;

/** 사각 영역을 육각 배치로 채우는 중심점들을 만든다. */
export function hexCellsInBounds(bounds: Bounds): Coord[] {
  const rowStepDeg = ((SPACING_M * Math.sqrt(3)) / 2) / METERS_PER_DEG_LAT;
  const cells: Coord[] = [];

  let rowIndex = 0;
  for (let lat = bounds.south; lat <= bounds.north + rowStepDeg; lat += rowStepDeg) {
    const colStepDeg = SPACING_M / metersPerDegLon(lat);
    // 홀수 행을 반 칸 밀어야 육각 배치가 되어 틈이 생기지 않는다.
    const offset = rowIndex % 2 === 0 ? 0 : colStepDeg / 2;

    for (let lon = bounds.west + offset; lon <= bounds.east + colStepDeg; lon += colStepDeg) {
      cells.push({ lat: roundCoord(lat), lon: roundCoord(lon) });
    }
    rowIndex += 1;
  }

  return cells;
}

/** 두 좌표 사이 거리(m). 짧은 거리에서 충분히 정확한 평면 근사. */
export function distanceMeters(a: Coord, b: Coord): number {
  const dx = (b.lon - a.lon) * metersPerDegLon((a.lat + b.lat) / 2);
  const dy = (b.lat - a.lat) * METERS_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/**
 * 알려진 주유소 좌표를 반경 radius 원반으로 덮는 최소 지점을 그리디로 고른다.
 * 전국을 맹목적으로 격자 스윕하는 것보다 호출 수가 크게 줄어든다.
 */
export function greedyCover(
  points: readonly Coord[],
  radiusMeters: number,
): Coord[] {
  const uncovered = new Set(points.map((_, index) => index));
  const centers: Coord[] = [];

  // 셀 크기를 반경에 맞춘 격자에 넣어 후보 탐색을 국소화한다.
  const cellSizeDeg = radiusMeters / METERS_PER_DEG_LAT;
  const buckets = new Map<string, number[]>();
  const bucketKey = (coord: Coord) =>
    `${Math.floor(coord.lat / cellSizeDeg)}:${Math.floor(coord.lon / cellSizeDeg)}`;

  points.forEach((point, index) => {
    const key = bucketKey(point);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  });

  const neighborsOf = (point: Coord): number[] => {
    const latCell = Math.floor(point.lat / cellSizeDeg);
    const lonCell = Math.floor(point.lon / cellSizeDeg);
    const found: number[] = [];
    for (let dLat = -2; dLat <= 2; dLat += 1) {
      for (let dLon = -2; dLon <= 2; dLon += 1) {
        const bucket = buckets.get(`${latCell + dLat}:${lonCell + dLon}`);
        if (bucket) found.push(...bucket);
      }
    }
    return found;
  };

  while (uncovered.size > 0) {
    // 아직 덮이지 않은 점 하나를 잡고, 그 주변에서 가장 많이 덮는 중심을 고른다.
    const seedIndex = uncovered.values().next().value as number;
    const seed = points[seedIndex];

    let best: { center: Coord; covered: number[] } = {
      center: seed,
      covered: [seedIndex],
    };

    for (const candidateIndex of neighborsOf(seed)) {
      const candidate = points[candidateIndex];
      if (distanceMeters(seed, candidate) > radiusMeters) continue;

      const covered = neighborsOf(candidate).filter(
        (index) =>
          uncovered.has(index) && distanceMeters(candidate, points[index]) <= radiusMeters,
      );
      if (covered.length > best.covered.length) {
        best = { center: candidate, covered };
      }
    }

    for (const index of best.covered) uncovered.delete(index);
    centers.push({ lat: roundCoord(best.center.lat), lon: roundCoord(best.center.lon) });
  }

  return centers;
}
