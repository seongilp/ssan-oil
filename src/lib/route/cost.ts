import type { Station } from '../fuel/types';

export type TripParams = {
  /** 이번에 넣을 주유량(L). */
  readonly liters: number;
  /** 연비(km/L). 우회 주행으로 태우는 기름값을 계산하는 데 쓴다. */
  readonly efficiencyKmPerL: number;
  /** 이 시간을 넘게 돌아가야 하면 후보에서 제외한다(분). */
  readonly maxDetourMinutes: number;
};

export const DEFAULT_TRIP_PARAMS: TripParams = {
  liters: 40,
  efficiencyKmPerL: 12,
  maxDetourMinutes: 10,
};

export type Evaluation = {
  readonly station: Station;
  readonly price: number;
  /** 기본 경로 대비 추가 주행거리(km). 음수가 나올 수 있어 0으로 하한을 둔다. */
  readonly extraKm: number;
  readonly extraMinutes: number;
  /** 주유 자체의 비용(원). */
  readonly fuelCost: number;
  /** 우회 주행으로 추가로 태우는 기름값(원). */
  readonly detourCost: number;
  /** fuelCost + detourCost. 순위 기준. */
  readonly totalCost: number;
};

/**
 * 리터당 가격이 싸도 멀리 돌아가면 손해다.
 * '주유비 + 우회 주행에 드는 기름값'의 합으로 실제 부담을 계산한다.
 */
export function evaluate(
  station: Station,
  price: number,
  baseRoute: { distanceMeters: number; durationSeconds: number },
  viaRoute: { distanceMeters: number; durationSeconds: number },
  params: TripParams,
): Evaluation {
  // 우회 경로가 기본 경로보다 짧게 나오는 경우(경로 재탐색 차이)는 0으로 본다.
  const extraKm = Math.max(
    0,
    (viaRoute.distanceMeters - baseRoute.distanceMeters) / 1000,
  );
  const extraMinutes = Math.max(
    0,
    (viaRoute.durationSeconds - baseRoute.durationSeconds) / 60,
  );

  const fuelCost = params.liters * price;
  const detourCost =
    params.efficiencyKmPerL > 0 ? (extraKm / params.efficiencyKmPerL) * price : 0;

  return {
    station,
    price,
    extraKm,
    extraMinutes,
    fuelCost,
    detourCost,
    totalCost: fuelCost + detourCost,
  };
}

/** 총비용이 낮은 순. 동률이면 덜 돌아가는 쪽. */
export function rank(evaluations: readonly Evaluation[]): Evaluation[] {
  return [...evaluations].sort(
    (a, b) => a.totalCost - b.totalCost || a.extraMinutes - b.extraMinutes,
  );
}
