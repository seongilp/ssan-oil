import { allPricedStations } from './queries';
import type { FuelType, Station } from '../fuel/types';

/**
 * 가격은 하루에 한 번만 바뀐다. 요청마다 DB를 훑을 이유가 없으므로
 * 연료별 전체 목록을 인스턴스 메모리에 올려 두고 재사용한다.
 *
 * 전국 1만 곳이라 메모리 부담이 작고(수 MB), 경로 후보 필터링은
 * 어차피 전체를 순회하므로 인메모리 배열이 가장 빠르다.
 */
const TTL_MS = 60 * 60 * 1000;

type Entry = { readonly loadedAt: number; readonly stations: Station[] };

const cache = new Map<FuelType, Entry>();
/** 같은 연료에 대한 동시 요청이 DB를 여러 번 훑지 않게 로딩을 공유한다. */
const inFlight = new Map<FuelType, Promise<Station[]>>();

export async function getStationSnapshot(fuel: FuelType): Promise<Station[]> {
  const cached = cache.get(fuel);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached.stations;

  const pending = inFlight.get(fuel);
  if (pending) return pending;

  const load = allPricedStations(fuel)
    .then((stations) => {
      cache.set(fuel, { loadedAt: Date.now(), stations });
      return stations;
    })
    .finally(() => {
      inFlight.delete(fuel);
    });

  inFlight.set(fuel, load);
  return load;
}

/** 크론이 새 가격을 채운 뒤 강제로 비울 때 쓴다. */
export function clearStationSnapshot(): void {
  cache.clear();
}
