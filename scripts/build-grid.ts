/**
 * 스윕할 격자 셀을 만든다.
 *
 *   pnpm build:grid            좌표를 이미 아는 주유소를 덮는 최소 지점(일상 갱신용)
 *   pnpm build:grid --hints    아직 좌표를 모르는 주유소의 조준 좌표를 덮는 지점
 *   pnpm build:grid --regions  시군구 경계 상자를 육각 배치로 채움(최후의 수단)
 *
 * --regions 는 산지·해상까지 타일링해 빈 셀이 절반을 넘는다.
 * 조준 좌표가 있으면 --hints 가 훨씬 적은 호출로 같은 범위를 덮는다.
 */
import type { Pool } from '@neondatabase/serverless';
import { createPool, ensureSchema, loadEnv } from './lib/pool';
import {
  greedyCover,
  hexCellsInBounds,
  roundCoord,
  SWEEP_RADIUS_M,
  type Bounds,
} from '../src/lib/store/grid';
import type { Coord } from '../src/lib/fuel/types';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DELAY_MS = 1100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 시군구 이름 → 경계 상자. Nominatim이 admin 영역의 boundingbox를 준다. */
async function regionBounds(region: string, contact: string): Promise<Bounds | null> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', region);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'kr');

  const response = await fetch(url, {
    headers: { 'User-Agent': `datalab-fuel-router/0.1 (${contact})` },
  });
  if (!response.ok) return null;

  const results = (await response.json()) as Array<{ boundingbox?: string[] }>;
  const box = results[0]?.boundingbox;
  if (!box || box.length < 4) return null;

  const [south, north, west, east] = box.map(Number.parseFloat);
  if (![south, north, west, east].every(Number.isFinite)) return null;
  // 시군구 경계를 벗어난 외곽 주유소도 잡히도록 살짝 넓힌다.
  return { south: south - 0.02, north: north + 0.02, west: west - 0.02, east: east + 0.02 };
}

const BATCH = 1000;

/**
 * 이미 있는 셀이라도 지역이 비어 있으면 채운다. DO NOTHING만 쓰면
 * 먼저 만들어진 셀에 지역이 영영 붙지 않는다.
 */
async function insertCells(
  pool: Pool,
  cells: readonly Coord[],
  region: string | null,
): Promise<number> {
  let inserted = 0;
  for (let start = 0; start < cells.length; start += BATCH) {
    const slice = cells.slice(start, start + BATCH);
    const result = await pool.query(
      `INSERT INTO grid_cells (lat, lon, region)
       SELECT * FROM UNNEST($1::double precision[], $2::double precision[], $3::text[])
       ON CONFLICT (lat, lon) DO UPDATE
         SET region = COALESCE(grid_cells.region, EXCLUDED.region)`,
      [
        slice.map((cell) => roundCoord(cell.lat)),
        slice.map((cell) => roundCoord(cell.lon)),
        slice.map(() => region),
      ],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function buildFromRegions(pool: Pool): Promise<void> {
  const contact = process.env.OSM_CONTACT ?? 'unknown';
  const { rows: regions } = await pool.query<{ region: string }>(
    "SELECT DISTINCT region FROM stations WHERE region <> '' ORDER BY region",
  );

  console.log(`시군구 ${regions.length}개의 경계 상자를 조회한다 (약 ${Math.round((regions.length * DELAY_MS) / 60000)}분).`);

  let total = 0;
  let inserted = 0;
  for (const [index, { region }] of regions.entries()) {
    const bounds = await regionBounds(region, contact);
    await sleep(DELAY_MS);
    if (!bounds) {
      console.warn(`  경계 없음: ${region}`);
      continue;
    }
    await pool.query(
      `INSERT INTO regions (name, south, west, north, east) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE SET
         south = EXCLUDED.south, west = EXCLUDED.west,
         north = EXCLUDED.north, east = EXCLUDED.east`,
      [region, bounds.south, bounds.west, bounds.north, bounds.east],
    );

    const cells = hexCellsInBounds(bounds);
    total += cells.length;
    // 셀에 지역을 붙여 둬야 '미해결 주유소가 많은 지역'부터 훑을 수 있다.
    inserted += await insertCells(pool, cells, region);

    if ((index + 1) % 25 === 0) {
      console.log(`  ${index + 1}/${regions.length} · 누적 셀 ${total} (신규 ${inserted})`);
    }
  }

  console.log(`\n생성 ${total}개 → 중복 제거 후 저장 ${inserted}개`);
}

/**
 * 아직 좌표를 모르는 주유소의 '조준 좌표(hint)'를 덮는 지점을 만든다.
 *
 * hint는 주소·행정동 지오코딩 결과라 1~2km 오차가 있지만, 스윕 반경이 5km라
 * 그 안에 실제 주유소가 들어온다. 오차를 흡수하려고 커버 반경은 좁게 잡는다.
 */
async function buildFromHints(pool: Pool): Promise<void> {
  const { rows: points } = await pool.query<{ lat: number; lon: number }>(
    `SELECT hint_lat AS lat, hint_lon AS lon FROM stations
     WHERE hint_lat IS NOT NULL AND geocode_src IS DISTINCT FROM 'opinet'`,
  );

  if (points.length === 0) {
    throw new Error('조준 좌표가 없다. 먼저 pnpm hint 를 실행하라.');
  }

  // hint 오차(최대 2km 남짓)만큼 여유를 두어 실제 주유소가 원 안에 들어오게 한다.
  const coverRadius = SWEEP_RADIUS_M - 2000;
  console.log(
    `미해결 ${points.length}곳의 조준 좌표를 반경 ${coverRadius}m 로 덮는다...`,
  );

  const centers = greedyCover(
    points.map((point) => ({ lat: point.lat, lon: point.lon })),
    coverRadius,
  );

  console.log(`  필요한 스윕 지점: ${centers.length}개`);
  console.log(`  저장 ${await insertCells(pool, centers, null)}개`);
}

async function buildFromCover(pool: Pool): Promise<void> {
  const { rows: points } = await pool.query<{ lat: number; lon: number }>(
    "SELECT lat, lon FROM stations WHERE geocode_src = 'opinet'",
  );

  if (points.length === 0) {
    throw new Error('좌표를 가진 주유소가 없다. 먼저 --regions 로 격자를 만들어 스윕하라.');
  }

  console.log(`좌표 ${points.length}곳을 반경 ${SWEEP_RADIUS_M}m 원반으로 덮는다...`);
  const centers = greedyCover(
    points.map((point) => ({ lat: point.lat, lon: point.lon })),
    SWEEP_RADIUS_M,
  );

  console.log(`  필요한 스윕 지점: ${centers.length}개`);
  console.log(`  저장 ${await insertCells(pool, centers, null)}개 (기존 셀은 유지)`);
}

async function main(): Promise<void> {
  loadEnv();
  const pool = createPool();
  await ensureSchema(pool);

  try {
    if (process.argv.includes('--regions')) await buildFromRegions(pool);
    else if (process.argv.includes('--hints')) await buildFromHints(pool);
    else await buildFromCover(pool);

    const { rows } = await pool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM grid_cells',
    );
    console.log(`격자 셀 총 ${rows[0].n}개`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
