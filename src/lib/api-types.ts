import type { Coord } from './fuel/types';

/** /api/plan 응답. 클라이언트와 서버가 같은 타입을 공유한다. */
export type PlanResult = {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly address: string;
  readonly routeName: string | null;
  readonly direction: string | null;
  readonly coord: Coord | null;
  readonly price: number;
  readonly extraKm: number;
  readonly extraMinutes: number;
  readonly fuelCost: number;
  readonly detourCost: number;
  readonly totalCost: number;
  readonly savingVsWorst: number;
};

export type PlanResponse = {
  readonly base: {
    readonly distanceKm: number;
    readonly durationMinutes: number;
    readonly geometry: readonly [number, number][];
  };
  readonly stationsConsidered: number;
  readonly results: readonly PlanResult[];
};

export type Place = {
  readonly label: string;
  readonly lat: number;
  readonly lon: number;
};
