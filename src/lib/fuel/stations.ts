import { getStationSnapshot } from '../store/snapshot';
import type { FuelType, Station } from './types';

/**
 * 경로 계산에 쓸 주유소 목록.
 *
 * 저장소(SQLite)만 읽는다. 가격은 새벽 크론이 CSV/API로 채워 두므로
 * 사용자 요청 시점에는 외부 API 호출이 한 건도 발생하지 않는다.
 */
export async function loadStations(fuel: FuelType): Promise<Station[]> {
  return getStationSnapshot(fuel);
}
