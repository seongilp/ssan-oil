import { getSql } from './db';
import { KST_TODAY_SQL } from '../date';
import type { Coord, FuelType, Station } from '../fuel/types';

/** CSV의 연료 컬럼은 5종이지만 경로 계산은 3종만 쓴다. */
export type StoreFuel = 'gasoline' | 'diesel' | 'lpg' | 'premium' | 'kerosene';

/**
 * 화면 안 전체 주유소의 가격 분포. 마커를 200개로 자른 뒤 그 안에서 백분위를
 * 계산하면 잘려나간 비싼 주유소가 빠져 색 기준이 왜곡된다. 그래서 분포는
 * 자르기 전 전체를 대상으로 따로 구한다.
 */
export type PriceStats = {
  readonly count: number;
  readonly p25: number;
  readonly p75: number;
};

export type MapStation = {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly address: string;
  readonly isSelf: boolean;
  readonly coord: Coord;
  readonly price: number;
};

export type Bounds = {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
};

type StationRow = {
  uni_id: string;
  source: string;
  name: string;
  brand: string;
  address: string;
  tel: string | null;
  is_self: boolean;
  lat: number;
  lon: number;
  price: number;
};

/**
 * 주유소마다 '가장 최근 가격'을 고르는 공통 서브쿼리.
 *
 * 특정 날짜 하나에만 조인하면, 그날 갱신이 도중에 멈췄을 때 아직 안 채워진
 * 주유소가 지도에서 통째로 사라진다. 실제로 갱신이 실패한 날 지도가 텅 비었다.
 * 최근 며칠 안에서 각자 최신값을 쓰면 부분 갱신 중에도 지도가 온전하다.
 */
const LOOKBACK_DAYS = 7;

const latestPriceCte = (fuel: string) => `
  latest AS (
    SELECT DISTINCT ON (uni_id) uni_id, price, date
    FROM prices
    WHERE fuel = '${fuel}'
      AND date > ${KST_TODAY_SQL} - ${LOOKBACK_DAYS}
    ORDER BY uni_id, date DESC
  )`;

/** 저장소에 들어 있는 가장 최근 가격 날짜(YYYY-MM-DD). 없으면 null. */
export async function latestPriceDate(): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT to_char(MAX(date), 'YYYY-MM-DD') AS d FROM prices
  `) as Array<{ d: string | null }>;
  return rows[0]?.d ?? null;
}

/** bbox 안 전체를 대상으로 한 가격 분포(자르기 전 기준). */
export async function priceStatsInBounds(
  bounds: Bounds,
  fuel: StoreFuel,
): Promise<PriceStats | null> {
  const date = await latestPriceDate();
  if (!date) return null;

  const sql = getSql();
  const rows = (await sql`
    WITH ${sql.unsafe(latestPriceCte(fuel))}
    SELECT COUNT(*)::int AS count,
           percentile_disc(0.25) WITHIN GROUP (ORDER BY p.price)::int AS p25,
           percentile_disc(0.75) WITHIN GROUP (ORDER BY p.price)::int AS p75
    FROM stations s
    JOIN latest p ON p.uni_id = s.uni_id
    WHERE s.geocode_src = 'opinet'
      AND s.lat BETWEEN ${bounds.south} AND ${bounds.north}
      AND s.lon BETWEEN ${bounds.west} AND ${bounds.east}
  `) as Array<{ count: number; p25: number | null; p75: number | null }>;

  const row = rows[0];
  if (!row || row.count === 0 || row.p25 === null || row.p75 === null) return null;
  return { count: row.count, p25: row.p25, p75: row.p75 };
}

/**
 * 화면에 보이는 영역(bbox) 안의 주유소를 반환한다.
 *
 * 1만 곳을 한 번에 그리면 지도가 버티지 못해 limit으로 잘라야 하는데,
 * 단순히 '싼 순'으로 자르면 비싼 지역(강남·도심)이 통째로 사라져
 * 그 동네에 주유소가 아예 없는 것처럼 보인다.
 *
 * 그래서 화면을 격자로 나눠 칸마다 가장 싼 곳을 하나씩 고른다.
 * 지도 전체가 고르게 덮이면서도 각 동네의 최저가가 드러난다.
 */
export async function stationsInBounds(
  bounds: Bounds,
  fuel: StoreFuel,
  limit: number,
): Promise<MapStation[]> {
  const date = await latestPriceDate();
  if (!date) return [];

  // limit개를 채우도록 한 변의 칸 수를 정한다(예: 200개 → 15x15=225칸).
  const divisions = Math.max(1, Math.ceil(Math.sqrt(limit)));
  const latStep = (bounds.north - bounds.south) / divisions;
  const lonStep = (bounds.east - bounds.west) / divisions;

  const sql = getSql();
  const rows = (await sql`
    WITH ${sql.unsafe(latestPriceCte(fuel))}
    SELECT * FROM (
      SELECT DISTINCT ON (bucket)
             uni_id, source, name, brand, address, tel, is_self, lat, lon, price
      FROM (
        SELECT s.uni_id, s.source, s.name, s.brand, s.address, s.tel, s.is_self,
               s.lat, s.lon, p.price,
               floor((s.lat - ${bounds.south}) / ${latStep})::int * 100000
                 + floor((s.lon - ${bounds.west}) / ${lonStep})::int AS bucket
        FROM stations s
        JOIN latest p ON p.uni_id = s.uni_id
        WHERE s.geocode_src = 'opinet'
          AND s.lat BETWEEN ${bounds.south} AND ${bounds.north}
          AND s.lon BETWEEN ${bounds.west} AND ${bounds.east}
      ) AS tagged
      ORDER BY bucket, price ASC
    ) AS sampled
    ORDER BY price ASC
    LIMIT ${limit}
  `) as StationRow[];

  return rows.map((row) => ({
    id: row.uni_id,
    name: row.name,
    brand: row.brand,
    address: row.address,
    isSelf: row.is_self,
    coord: { lat: row.lat, lon: row.lon },
    price: row.price,
  }));
}

/** 경로 후보 계산용. 좌표와 해당 연료 가격이 모두 있는 주유소 전체. */
export async function allPricedStations(fuel: FuelType): Promise<Station[]> {
  const date = await latestPriceDate();
  if (!date) return [];

  const sql = getSql();
  const rows = (await sql`
    WITH ${sql.unsafe(latestPriceCte(fuel))}
    SELECT s.uni_id, s.source, s.name, s.brand, s.address, s.tel, s.is_self,
           s.lat, s.lon, p.price
    FROM stations s
    JOIN latest p ON p.uni_id = s.uni_id
    WHERE s.geocode_src = 'opinet'
  `) as StationRow[];

  return rows.map((row) => ({
    id: row.uni_id,
    source: row.source === 'highway' ? 'highway' : 'opinet',
    name: row.name,
    brand: row.brand,
    address: row.address,
    coord: { lat: row.lat, lon: row.lon },
    prices: { [fuel]: row.price } as Partial<Record<FuelType, number>>,
    highway: null,
    tel: row.tel,
  }));
}

export async function storeStats(): Promise<{
  stations: number;
  geocoded: number;
  date: string | null;
}> {
  const sql = getSql();
  const rows = (await sql`
    SELECT COUNT(*)::int AS stations,
           COUNT(*) FILTER (WHERE geocode_src = 'opinet')::int AS geocoded
    FROM stations
  `) as Array<{ stations: number; geocoded: number }>;

  return {
    stations: rows[0]?.stations ?? 0,
    geocoded: rows[0]?.geocoded ?? 0,
    date: await latestPriceDate(),
  };
}
