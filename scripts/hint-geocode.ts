/**
 * 아직 정확한 좌표가 없는 주유소의 주소를 Nominatim으로 지오코딩해
 * '대략적 위치(hint)'를 채운다.
 *
 *   pnpm hint [최대건수]
 *
 * 이 좌표는 오차가 1~2km라 지도 표시에는 쓸 수 없다. 오직 반경 5km 스윕 원을
 * 어디에 놓을지 정하는 데만 쓴다. 원 안에만 들어오면 오피넷이 정확한 좌표를 준다.
 *
 * Nominatim은 무료지만 초당 1건 제한이 있다. 오피넷 호출 예산과는 무관하다.
 */
import type { Pool } from '@neondatabase/serverless';
import { createPool, loadEnv } from './lib/pool';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DELAY_MS = 1100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isInKorea = (lat: number, lon: number): boolean =>
  lat > 33 && lat < 39 && lon > 124 && lon < 132;

/** 괄호 안 법정동이 붙어 있으면 Nominatim이 못 찾는 경우가 많아 떼고 시도한다. */
function addressVariants(region: string, address: string): string[] {
  const stripped = address.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return [...new Set([address, stripped, `${region} ${stripped}`])].filter(
    (value) => value.length > 3,
  );
}

async function geocode(query: string, contact: string) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'kr');

  const response = await fetch(url, {
    headers: { 'User-Agent': `datalab-fuel-router/0.1 (${contact})` },
  });
  if (!response.ok) return null;

  const results = (await response.json()) as Array<{ lat: string; lon: string }>;
  const first = results[0];
  if (!first) return null;

  const lat = Number.parseFloat(first.lat);
  const lon = Number.parseFloat(first.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && isInKorea(lat, lon)
    ? { lat, lon }
    : null;
}

/**
 * '충남 논산시 연무읍 안심로 123' → '충남 논산시 연무읍'
 *
 * 개별 주소보다 읍·면·동 이름이 OSM에 훨씬 잘 등록돼 있다. 같은 읍면의 주유소는
 * 대체로 반경 5km 안에 모이므로, 행정동 하나만 찾아도 그 안의 주유소를 전부
 * 스윕 원에 담을 수 있다. 호출 수도 주유소 수가 아니라 읍면 수로 줄어든다.
 */
function adminArea(region: string, address: string): string | null {
  // 도로명(로/길)이 나오기 전까지의 토큰 중 행정구역 접미사를 가진 것을 찾는다.
  for (const token of address.split(/\s+/)) {
    if (/(로|길)\d*$/.test(token)) break;
    if (/(읍|면|동|가|리)$/.test(token) && token.length >= 2) {
      return `${region} ${token}`;
    }
  }
  return null;
}

async function geocodeAdminAreas(
  pool: Pool,
  contact: string,
  limit: number,
): Promise<void> {
  const { rows: stations } = await pool.query<{
    uni_id: string;
    region: string;
    address: string;
  }>(
    `SELECT uni_id, region, address FROM stations
     WHERE geocode_src IS DISTINCT FROM 'opinet' AND hint_lat IS NULL AND address <> ''`,
  );

  // 행정동별로 주유소를 묶는다. 한 번 찾으면 그 동의 주유소 전부에 적용된다.
  const byArea = new Map<string, string[]>();
  for (const station of stations) {
    const area = adminArea(station.region, station.address);
    if (!area) continue;
    const bucket = byArea.get(area);
    if (bucket) bucket.push(station.uni_id);
    else byArea.set(area, [station.uni_id]);
  }

  const areas = [...byArea.keys()].slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(
    `미해결 ${stations.length}곳이 행정동 ${byArea.size}개에 묶인다. ` +
      `${areas.length}개 조회 (예상 ${Math.round((areas.length * DELAY_MS) / 60000)}분)`,
  );

  let hit = 0;
  let applied = 0;
  for (const [index, area] of areas.entries()) {
    let found: { lat: number; lon: number } | null = null;
    try {
      found = await geocode(area, contact);
    } catch {
      found = null;
    }
    await sleep(DELAY_MS);

    if (found) {
      hit += 1;
      const ids = byArea.get(area) ?? [];
      // 같은 동의 주유소를 한 문장으로 갱신해 왕복을 줄인다.
      await pool.query(
        'UPDATE stations SET hint_lat = $1, hint_lon = $2 WHERE uni_id = ANY($3::text[])',
        [found.lat, found.lon, ids],
      );
      applied += ids.length;
    }
    if ((index + 1) % 100 === 0) {
      console.log(`  ${index + 1}/${areas.length} · 찾은 동 ${hit} · 적용 ${applied}곳`);
    }
  }

  const { rows: totals } = await pool.query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM stations WHERE hint_lat IS NOT NULL',
  );
  console.log(
    `\n완료: 행정동 ${hit}/${areas.length} · 주유소 ${applied}곳에 적용 · 조준 좌표 보유 ${totals[0].n}곳`,
  );
}

async function main(): Promise<void> {
  loadEnv();
  const contact = process.env.OSM_CONTACT ?? 'unknown';
  const limit = Number.parseInt(process.argv[2] ?? '', 10);

  const pool = createPool();

  // 기본은 행정동 단위. 개별 주소로 훑으려면 --address 를 준다.
  if (!process.argv.includes('--address')) {
    await geocodeAdminAreas(pool, contact, limit);
    await pool.end();
    return;
  }

  const { rows: pending } = await pool.query<{
    uni_id: string;
    region: string;
    address: string;
  }>(
    `SELECT uni_id, region, address FROM stations
     WHERE geocode_src IS DISTINCT FROM 'opinet' AND hint_lat IS NULL AND address <> ''
     ORDER BY uni_id
     ${Number.isFinite(limit) ? 'LIMIT ' + limit : ''}`,
  );

  console.log(
    `조준 좌표 대상 ${pending.length}건 (예상 ${Math.round((pending.length * DELAY_MS) / 60000)}분)`,
  );

  let hit = 0;
  for (const [index, station] of pending.entries()) {
    let found: { lat: number; lon: number } | null = null;
    for (const variant of addressVariants(station.region, station.address)) {
      try {
        found = await geocode(variant, contact);
      } catch {
        found = null;
      }
      await sleep(DELAY_MS);
      if (found) break;
    }

    if (found) {
      await pool.query(
        'UPDATE stations SET hint_lat = $1, hint_lon = $2 WHERE uni_id = $3',
        [found.lat, found.lon, station.uni_id],
      );
      hit += 1;
    }
    if ((index + 1) % 200 === 0) {
      console.log(`  ${index + 1}/${pending.length} · 성공 ${hit}`);
    }
  }

  const { rows: totals } = await pool.query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM stations WHERE hint_lat IS NOT NULL',
  );
  console.log(`\n완료: 이번 ${hit}/${pending.length} · 조준 좌표 보유 ${totals[0].n}곳`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
