/**
 * 오피넷 aroundAll 스윕으로 주유소 좌표와 가격을 채운다. 새벽 크론이 실행한다.
 *
 *   pnpm refresh [--budget 1400] [--fuel gasoline]
 *
 * aroundAll 응답에는 주유소마다 정확한 KATEC 좌표가 함께 오므로,
 * 이 한 번의 스윕으로 좌표와 가격을 동시에 얻는다(주소 지오코딩 불필요).
 *
 * 일일 호출 예산(무료 1,500)을 넘지 않도록 budget으로 자르고,
 * 아무 것도 안 나온 셀은 barren으로 표시해 다음 실행부터 건너뛴다.
 */
import { createPool, ensureSchema, loadEnv } from './lib/pool';
import {
  createOpinetClient,
  type OpinetClient,
  type UsageStore,
} from './lib/opinet';
import { katecToWgs84, wgs84ToKatec } from '../src/lib/geo/katec';
import { SWEEP_RADIUS_M } from '../src/lib/store/grid';
import { PROD_CODE } from '../src/lib/fuel/opinet-types';
import type { FuelType } from '../src/lib/fuel/types';

const API_BASE = 'https://www.opinet.co.kr/api';
const DELAY_MS = 200;

/**
 * 주유소가 확실히 많은 지점(강남 역삼동). 빈 응답이 이어질 때 여기를 찔러 본다.
 * 여기서도 0이 나오면 셀이 빈 게 아니라 키가 소진되거나 막힌 것이다.
 */
const PROBE_POINT = { lat: 37.4996, lon: 127.0478 };

/** 이만큼 연속으로 빈 응답이면 키가 살아 있는지 확인한다. */
const PROBE_AFTER_EMPTY = 25;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readFlag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

type AroundRow = {
  UNI_ID?: string;
  OS_NM?: string;
  POLL_DIV_CD?: string;
  PRICE?: number | string;
  GIS_X_COOR?: number | string;
  GIS_Y_COOR?: number | string;
};

async function sweepCell(
  center: { lat: number; lon: number },
  fuel: FuelType,
  client: OpinetClient,
): Promise<AroundRow[]> {
  const katec = wgs84ToKatec(center.lat, center.lon);
  return (await client.call('aroundAll', {
    x: katec.x.toFixed(1),
    y: katec.y.toFixed(1),
    radius: String(SWEEP_RADIUS_M),
    prodcd: PROD_CODE[fuel],
    sort: '1',
  })) as AroundRow[];
}

const toNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

async function main(): Promise<void> {
  loadEnv();
  // 예산을 지정하지 않으면 사용 가능한 키 전체의 남은 호출을 쓴다.
  const budgetFlag = readFlag('budget', '');
  const fuel = readFlag('fuel', 'gasoline') as FuelType;
  if (!(fuel in PROD_CODE)) throw new Error(`지원하지 않는 연료: ${fuel}`);

  const pool = createPool();
  await ensureSchema(pool);
  const date = new Date().toISOString().slice(0, 10);

  // 키별 오늘 사용량을 DB에 남긴다. 재실행해도 예산이 되살아나지 않는다.
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

  /**
   * 스윕에는 두 단계가 있다.
   *
   * - discover: 시군구 격자를 훑어 아직 좌표를 모르는 주유소를 찾는다.
   *   미해결 주유소가 많은 지역부터 가고, 다 찾은 지역은 통째로 건너뛴다.
   *   산지·해상 셀에 예산을 낭비하지 않기 위한 장치다.
   * - refresh: 좌표를 다 안 뒤의 일상 갱신. 실제 주유소를 덮는 최소 지점
   *   (build:grid 가 만든 region NULL 셀)만 훑는다.
   */
  const { rows: pendingRows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM stations WHERE geocode_src IS DISTINCT FROM 'opinet'",
  );
  const pending = pendingRows[0].n;
  const mode = readFlag('mode', pending > 0 ? 'discover' : 'refresh');

  const client = await createOpinetClient(usage);
  const budget = budgetFlag ? Number.parseInt(budgetFlag, 10) : client.remaining();

  /**
   * 배치가 크면 이미 다 찾은 지역의 셀을 계속 훑게 된다.
   * 작게 끊어 미해결 수를 자주 다시 계산한다.
   */
  const BATCH = 20;

  type Cell = { id: string; lat: number; lon: number; region: string | null };

  /**
   * 주유소는 읍·면 소재지에 몰려 있다. 격자를 좌상단부터 순서대로 훑으면
   * 외곽 산지를 먼저 밟게 되므로, 시군구 중심에서 가까운 셀부터 간다.
   * 경도 1도는 위도 1도보다 짧으므로(위도 36도 기준 약 0.8배) 그만큼 눌러서 비교한다.
   */
  const DISCOVER_SQL = `
    WITH deficit AS (
      SELECT region,
             COUNT(*) - COUNT(*) FILTER (WHERE geocode_src = 'opinet') AS missing
      FROM stations WHERE region <> '' GROUP BY region
    )
    SELECT c.id::text AS id, c.lat, c.lon, c.region
    FROM grid_cells c
    JOIN deficit d ON d.region = c.region
    JOIN regions r ON r.name = c.region
    WHERE c.barren = FALSE AND c.last_swept IS NULL AND d.missing > 0
    ORDER BY d.missing DESC,
      (c.lat - (r.south + r.north) / 2) ^ 2
      + ((c.lon - (r.west + r.east) / 2) ^ 2) * 0.64,
      c.id
    LIMIT $1`;

  const REFRESH_SQL = `
    SELECT id::text AS id, lat, lon, NULL::text AS region FROM grid_cells
    WHERE barren = FALSE AND region IS NULL
    ORDER BY (last_swept IS NOT NULL), last_swept, id
    LIMIT $1`;

  /**
   * 조준 좌표(hint)로 만든 지점만 훑는다. 아직 좌표를 모르는 주유소가
   * 실제로 있는 자리라 빈 셀이 거의 없다.
   */
  const HINTS_SQL = `
    SELECT id::text AS id, lat, lon, NULL::text AS region FROM grid_cells
    WHERE barren = FALSE AND region IS NULL AND last_swept IS NULL
    ORDER BY id
    LIMIT $1`;

  const selectSql =
    mode === 'discover' ? DISCOVER_SQL : mode === 'hints' ? HINTS_SQL : REFRESH_SQL;

  console.log(
    `모드 ${mode} · 최대 ${budget}회 호출 · 연료 ${fuel} · 좌표 미확보 ${pending}곳`,
  );

  let calls = 0;
  let coordCount = 0;
  let priceCount = 0;
  let barrenCount = 0;
  let skippedCount = 0;

  const swept = new Set<string>();
  /** 키 소진이 확인되면 바깥 루프까지 빠져나가야 한다. */
  let exhausted = false;

  /**
   * 오피넷은 일일 한도를 넘겨도 에러 대신 빈 배열을 준다. 그래서 빈 응답을
   * 곧바로 barren으로 굳히면, 키가 소진된 날 훑은 셀들이 영영 제외된다.
   *
   * 빈 응답은 일단 보류해 두었다가, 같은 키로 주유소가 하나라도 나오면
   * (= 키가 살아 있음이 증명되면) 그때 barren으로 확정한다.
   */
  let pendingBarren: string[] = [];

  const confirmBarren = async (): Promise<void> => {
    if (pendingBarren.length === 0) return;
    await pool.query(
      'UPDATE grid_cells SET barren = TRUE WHERE id = ANY($1::bigint[])',
      [pendingBarren],
    );
    barrenCount += pendingBarren.length;
    pendingBarren = [];
  };

  /** 보류한 셀들을 되돌려 다음 실행에서 다시 훑게 한다. */
  const revertPending = async (): Promise<void> => {
    if (pendingBarren.length === 0) return;
    await pool.query(
      'UPDATE grid_cells SET last_swept = NULL, last_yield = NULL WHERE id = ANY($1::bigint[])',
      [pendingBarren],
    );
    console.warn(`  보류 셀 ${pendingBarren.length}개를 미조회 상태로 되돌렸다.`);
    pendingBarren = [];
  };

  /**
   * 키가 아직 살아 있는지 확인한다.
   * 일시적 네트워크 오류로 멀쩡한 키를 죽었다고 판단하지 않도록 두 번 시도한다.
   */
  const probeKeyAlive = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const probe = await sweepCell(PROBE_POINT, fuel, client);
        calls += 1;
        if (probe.length > 0) return true;
      } catch {
        // 다음 시도로 넘어간다.
      }
      await sleep(1000);
    }
    return false;
  };

  while (calls < budget && !exhausted) {
    const { rows } = await pool.query<Cell>(selectSql, [BATCH + swept.size]);
    const batch = rows.filter((cell) => !swept.has(cell.id));
    if (batch.length === 0) break;

    for (const cell of batch) {
    if (calls >= budget) break;
    swept.add(cell.id);

    // 같은 배치 안에서 앞선 호출이 이 지역을 마저 채웠을 수 있다.
    if (cell.region) {
      const { rows: remaining } = await pool.query<{ missing: number }>(
        `SELECT (COUNT(*) - COUNT(*) FILTER (WHERE geocode_src = 'opinet'))::int AS missing
         FROM stations WHERE region = $1`,
        [cell.region],
      );
      if ((remaining[0]?.missing ?? 0) <= 0) {
        skippedCount += 1;
        continue;
      }
    }
    let stations: AroundRow[];
    try {
      stations = await sweepCell(cell, fuel, client);
      calls += 1;
    } catch (error) {
      // 개별 셀 실패로 전체 스윕을 버리지 않는다. 다음 실행에서 다시 잡힌다.
      console.warn(`  셀 ${cell.id} 실패: ${(error as Error).message}`);
      await sleep(DELAY_MS);
      continue;
    }

    const coords: Array<{ uniId: string; name: string; lat: number; lon: number }> = [];
    const priceRows: Array<{ uniId: string; price: number }> = [];

    for (const row of stations) {
      const uniId = row.UNI_ID?.trim();
      const x = toNumber(row.GIS_X_COOR);
      const y = toNumber(row.GIS_Y_COOR);
      const price = toNumber(row.PRICE);
      if (!uniId) continue;

      if (x !== null && y !== null) {
        const { lat, lon } = katecToWgs84(x, y);
        coords.push({ uniId, name: row.OS_NM?.trim() ?? '', lat, lon });
      }
      if (price !== null && price > 0) {
        priceRows.push({ uniId, price: Math.round(price) });
      }
    }

    if (coords.length > 0) {
      // CSV에 없던 신규 주유소도 좌표와 함께 받아들인다.
      await pool.query(
        `INSERT INTO stations (uni_id, source, name, lat, lon, geocode_src)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[],
                              $4::double precision[], $5::double precision[], $6::text[])
         ON CONFLICT (uni_id) DO UPDATE SET
           lat = EXCLUDED.lat, lon = EXCLUDED.lon, geocode_src = 'opinet'`,
        [
          coords.map((c) => c.uniId),
          coords.map(() => 'opinet'),
          coords.map((c) => c.name),
          coords.map((c) => c.lat),
          coords.map((c) => c.lon),
          coords.map(() => 'opinet'),
        ],
      );
      coordCount += coords.length;
    }

    if (priceRows.length > 0) {
      await pool.query(
        `INSERT INTO prices (uni_id, date, fuel, price)
         SELECT * FROM UNNEST($1::text[], $2::date[], $3::text[], $4::integer[])
         ON CONFLICT (uni_id, date, fuel) DO UPDATE SET price = EXCLUDED.price`,
        [
          priceRows.map((r) => r.uniId),
          priceRows.map(() => date),
          priceRows.map(() => fuel),
          priceRows.map((r) => r.price),
        ],
      );
      priceCount += priceRows.length;
    }

    await pool.query(
      'UPDATE grid_cells SET last_swept = $1, last_yield = $2 WHERE id = $3::bigint',
      [date, stations.length, cell.id],
    );

    if (stations.length === 0) {
      pendingBarren.push(cell.id);

      // 빈 응답이 계속되면 셀이 비어서인지 키가 죽어서인지 구분해야 한다.
      if (pendingBarren.length >= PROBE_AFTER_EMPTY) {
        const alive = await probeKeyAlive();
        if (alive) {
          await confirmBarren();
        } else {
          console.warn(
            `\n키 ${client.currentKey() ?? '?'} 가 빈 응답만 돌려준다. ` +
              '일일 한도 소진으로 보고 중단한다.',
          );
          await revertPending();
          exhausted = true;
          break;
        }
      }
    } else {
      // 주유소가 나왔다 = 키가 살아 있다. 보류분을 확정한다.
      await confirmBarren();
    }

    if (calls % 50 === 0) {
      console.log(
        `  ${calls}/${budget} 호출 · 좌표 ${coordCount} · 가격 ${priceCount} · 빈 셀 ${barrenCount}`,
      );
    }
    await sleep(DELAY_MS);
    }
  }

  // 남은 보류분은 키 상태를 한 번 확인한 뒤 확정하거나 되돌린다.
  if (pendingBarren.length > 0) {
    if (await probeKeyAlive()) await confirmBarren();
    else await revertPending();
  }

  await pool.query(
    'INSERT INTO ingests (source, stations, prices, note) VALUES ($1, $2, $3, $4)',
    [`opinet-sweep:${fuel}`, coordCount, priceCount, `calls=${calls}`],
  );

  const { rows: geocodedRows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM stations WHERE geocode_src = 'opinet'",
  );
  const { rows: remainingRows } = await pool.query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM grid_cells WHERE barren = FALSE AND last_swept IS NULL',
  );
  const geocoded = geocodedRows[0];
  const remaining = remainingRows[0];

  console.log(`\n스윕 완료 (${date})`);
  console.log(
    `  API 호출 ${calls}회 (남은 예산 ${client.remaining()}회) · ` +
      `빈 셀 ${barrenCount}개 · 완료 지역이라 건너뛴 셀 ${skippedCount}개`,
  );
  console.log(`  좌표 갱신 ${coordCount}건 · 가격 ${priceCount}건`);
  console.log(`  오피넷 정확 좌표 보유: ${geocoded.n}곳`);
  console.log(`  아직 안 훑은 셀: ${remaining.n}개`);

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
