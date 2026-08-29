/**
 * 좌표를 아직 못 받은 주유소를 UNI_ID로 하나씩 조회해 정확한 좌표를 채운다.
 *
 *   pnpm fill-coords [--budget N]
 *
 * 스윕(aroundAll)은 '반경 안에 뭐가 있나' 훑는 방식이라 빈 셀에 예산을 흘린다.
 * 남은 주유소는 UNI_ID를 정확히 알고 있으므로 detailById로 핀포인트 조회하는 게
 * 훨씬 확실하고 낭비가 없다. 덤으로 응답에 전 제품 가격이 함께 온다.
 */
import { createPool, ensureSchema, loadEnv } from './lib/pool';
import { createOpinetClient, type UsageStore } from './lib/opinet';
import { katecToWgs84 } from '../src/lib/geo/katec';
import { kstToday } from '../src/lib/date';
import { FUEL_BY_PROD_CODE } from '../src/lib/fuel/opinet-types';
import type { FuelType } from '../src/lib/fuel/types';

const DELAY_MS = 200;
/** 키가 살아 있는지 확인할 때 쓰는, 확실히 존재하는 주유소. */
const PROBE_ID = 'A0010207';
/** 이만큼 연속으로 빈 응답이면 키 소진을 의심한다. */
const PROBE_AFTER_EMPTY = 15;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readFlag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

type Detail = {
  UNI_ID?: string;
  OS_NM?: string;
  GIS_X_COOR?: number | string;
  GIS_Y_COOR?: number | string;
  OIL_PRICE?: Array<{ PRODCD?: string; PRICE?: number | string }>;
};

const toNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

async function main(): Promise<void> {
  loadEnv();

  const pool = createPool();
  await ensureSchema(pool);
  const date = kstToday();

  const usage: UsageStore = {
    async load(keyName) {
      const { rows } = await pool.query<{ calls: number }>(
        'SELECT calls FROM api_usage WHERE key_name = $1 AND date = $2',
        [keyName, date],
      );
      return rows[0]?.calls ?? 0;
    },
    async record(keyName, calls) {
      await pool.query(
        `INSERT INTO api_usage (key_name, date, calls) VALUES ($1, $2, $3)
         ON CONFLICT (key_name, date) DO UPDATE SET calls = api_usage.calls + EXCLUDED.calls`,
        [keyName, date, calls],
      );
    },
  };

  const client = await createOpinetClient(usage);
  const budgetFlag = readFlag('budget', '');
  const budget = budgetFlag ? Number.parseInt(budgetFlag, 10) : client.remaining();

  const { rows: pending } = await pool.query<{ uni_id: string }>(
    `SELECT uni_id FROM stations
     WHERE geocode_src IS DISTINCT FROM 'opinet'
     ORDER BY uni_id
     LIMIT $1`,
    [budget],
  );

  console.log(`좌표 미확보 ${pending.length}곳을 조회한다 (예산 ${budget}회).`);
  if (pending.length === 0) {
    await pool.end();
    return;
  }

  const probeAlive = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const rows = (await client.call('detailById', { id: PROBE_ID })) as Detail[];
        if (rows.length > 0) return true;
      } catch {
        // 다음 시도로 넘어간다.
      }
      await sleep(1000);
    }
    return false;
  };

  let calls = 0;
  let filled = 0;
  let priced = 0;
  let missing = 0;
  let consecutiveEmpty = 0;

  for (const station of pending) {
    if (calls >= budget) break;

    let rows: Detail[];
    try {
      rows = (await client.call('detailById', { id: station.uni_id })) as Detail[];
      calls += 1;
    } catch (error) {
      console.warn(`  ${station.uni_id} 실패: ${(error as Error).message}`);
      break;
    }

    const detail = rows[0];
    const x = toNumber(detail?.GIS_X_COOR);
    const y = toNumber(detail?.GIS_Y_COOR);

    if (!detail || x === null || y === null) {
      // 빈 응답은 '그런 주유소가 없다'일 수도, '키가 소진됐다'일 수도 있다.
      consecutiveEmpty += 1;
      missing += 1;
      if (consecutiveEmpty >= PROBE_AFTER_EMPTY) {
        if (!(await probeAlive())) {
          console.warn('\n키가 빈 응답만 돌려준다. 일일 한도 소진으로 보고 중단한다.');
          break;
        }
        // 키는 멀쩡하다. 정말로 조회가 안 되는 주유소들이다.
        consecutiveEmpty = 0;
      }
      await sleep(DELAY_MS);
      continue;
    }

    consecutiveEmpty = 0;
    const { lat, lon } = katecToWgs84(x, y);
    await pool.query(
      `UPDATE stations SET lat = $1, lon = $2, geocode_src = 'opinet' WHERE uni_id = $3`,
      [lat, lon, station.uni_id],
    );
    filled += 1;

    // detailById는 전 제품 가격을 함께 준다. 받은 김에 저장한다.
    const prices = (detail.OIL_PRICE ?? [])
      .map((entry) => ({
        fuel: FUEL_BY_PROD_CODE.get(entry.PRODCD ?? ''),
        price: toNumber(entry.PRICE),
      }))
      .filter(
        (entry): entry is { fuel: FuelType; price: number } =>
          entry.fuel !== undefined && entry.price !== null && entry.price > 0,
      );

    if (prices.length > 0) {
      await pool.query(
        `INSERT INTO prices (uni_id, date, fuel, price)
         SELECT * FROM UNNEST($1::text[], $2::date[], $3::text[], $4::integer[])
         ON CONFLICT (uni_id, date, fuel) DO UPDATE SET price = EXCLUDED.price`,
        [
          prices.map(() => station.uni_id),
          prices.map(() => date),
          prices.map((entry) => entry.fuel),
          prices.map((entry) => entry.price),
        ],
      );
      priced += prices.length;
    }

    if (calls % 50 === 0) {
      console.log(`  ${calls}/${budget} 호출 · 좌표 ${filled} · 응답없음 ${missing}`);
    }
    await sleep(DELAY_MS);
  }

  await pool.query(
    'INSERT INTO ingests (source, stations, prices, note) VALUES ($1, $2, $3, $4)',
    ['opinet-detail', filled, priced, `calls=${calls}, missing=${missing}`],
  );

  const { rows: after } = await pool.query<{ total: number; located: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE geocode_src = 'opinet')::int AS located
     FROM stations`,
  );

  console.log(`\n완료: 호출 ${calls}회 (남은 예산 ${client.remaining()}회)`);
  console.log(`  좌표 채움 ${filled}곳 · 가격 ${priced}건 · 응답 없음 ${missing}곳`);
  console.log(`  전체 좌표: ${after[0].located} / ${after[0].total}`);

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
