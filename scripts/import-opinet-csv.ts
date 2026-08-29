/**
 * 오피넷 CSV(사업자 기본정보 + 현재 판매가격)를 SQLite 저장소에 적재한다.
 *
 *   pnpm import:csv [csv디렉터리]        (기본값: ~/Downloads)
 *
 * 좌표는 이 단계에서 채우지 않는다. scripts/geocode-store.ts 가 별도로 채운다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decodeCp949, parseCsv, type CsvRow } from '../src/lib/store/csv';
import { createPool, ensureSchema } from './lib/pool';

/** CSV 컬럼명 → 내부 연료 키. 값이 0이면 취급하지 않는 연료다. */
const FUEL_COLUMNS: Record<string, string> = {
  휘발유: 'gasoline',
  경유: 'diesel',
  고급휘발유: 'premium',
  실내등유: 'kerosene',
};

/** 파일명이 URL 인코딩된 채 저장되는 경우가 있어 디코딩해서 찾는다. */
function findCsv(directory: string, keyword: string): string | null {
  for (const entry of readdirSync(directory)) {
    if (!entry.toLowerCase().endsWith('.csv')) continue;
    let name = entry;
    try {
      name = decodeURIComponent(entry);
    } catch {
      // 인코딩되지 않은 평범한 파일명이면 그대로 쓴다.
    }
    if (name.includes(keyword)) return join(directory, entry);
  }
  return null;
}

function readCsv(path: string): CsvRow[] {
  return parseCsv(decodeCp949(readFileSync(path)));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const BATCH = 1000;

type StationEntry = [
  string,
  { name: string; brand: string; region: string; address: string; tel: string | null; isSelf: boolean },
];

/** 행마다 왕복하면 1만 건에 수 분이 걸린다. UNNEST로 배치 INSERT 한다. */
async function insertStations(
  pool: ReturnType<typeof createPool>,
  entries: readonly StationEntry[],
): Promise<void> {
  for (let start = 0; start < entries.length; start += BATCH) {
    const slice = entries.slice(start, start + BATCH);
    await pool.query(
      `INSERT INTO stations (uni_id, source, name, brand, region, address, tel, is_self, updated_at)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                            $6::text[], $7::text[], $8::boolean[], $9::timestamptz[])
       ON CONFLICT (uni_id) DO UPDATE SET
         name = EXCLUDED.name, brand = EXCLUDED.brand, region = EXCLUDED.region,
         tel = COALESCE(EXCLUDED.tel, stations.tel), is_self = EXCLUDED.is_self,
         -- 주소가 바뀌면 좌표를 무효화해 다음 스윕 때 다시 채우게 한다.
         lat = CASE WHEN stations.address = EXCLUDED.address THEN stations.lat END,
         lon = CASE WHEN stations.address = EXCLUDED.address THEN stations.lon END,
         geocode_src = CASE WHEN stations.address = EXCLUDED.address THEN stations.geocode_src END,
         address = EXCLUDED.address,
         updated_at = EXCLUDED.updated_at`,
      [
        slice.map(([id]) => id),
        slice.map(() => 'opinet'),
        slice.map(([, v]) => v.name),
        slice.map(([, v]) => v.brand),
        slice.map(([, v]) => v.region),
        slice.map(([, v]) => v.address),
        slice.map(([, v]) => v.tel),
        slice.map(([, v]) => v.isSelf),
        slice.map(() => new Date()),
      ],
    );
  }
}

async function insertPrices(
  pool: ReturnType<typeof createPool>,
  rows: readonly { uniId: string; fuel: string; price: number }[],
  date: string,
): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH) {
    const slice = rows.slice(start, start + BATCH);
    await pool.query(
      `INSERT INTO prices (uni_id, date, fuel, price)
       SELECT * FROM UNNEST($1::text[], $2::date[], $3::text[], $4::integer[])
       ON CONFLICT (uni_id, date, fuel) DO UPDATE SET price = EXCLUDED.price`,
      [
        slice.map((row) => row.uniId),
        slice.map(() => date),
        slice.map((row) => row.fuel),
        slice.map((row) => row.price),
      ],
    );
  }
}

async function main(): Promise<void> {
  const directory = process.argv[2] ?? join(homedir(), 'Downloads');

  const basicPath = findCsv(directory, '사업자_기본정보');
  const pricePath = findCsv(directory, '현재_판매가격');
  if (!basicPath) throw new Error(`'사업자_기본정보' CSV를 ${directory} 에서 찾지 못했다.`);
  if (!pricePath) throw new Error(`'현재_판매가격' CSV를 ${directory} 에서 찾지 못했다.`);

  console.log('기본정보:', basicPath);
  console.log('판매가격:', pricePath);

  const pool = createPool();
  await ensureSchema(pool);

  const date = today();
  const basicRows = readCsv(basicPath);
  const priceRows = readCsv(pricePath);

  // 두 CSV를 고유번호로 합친다. 가격 CSV에만 있는 주유소도 마스터에 넣는다.
  const stations = new Map<string, {
    name: string; brand: string; region: string; address: string;
    tel: string | null; isSelf: boolean;
  }>();

  for (const row of [...basicRows, ...priceRows]) {
    const uniId = row['고유번호'];
    if (!uniId) continue;
    const existing = stations.get(uniId);
    stations.set(uniId, {
      name: row['상호'] || existing?.name || '',
      brand: row['상표'] || existing?.brand || '',
      region: row['지역'] || existing?.region || '',
      address: row['주소'] || existing?.address || '',
      tel: row['전화번호'] || existing?.tel || null,
      isSelf: row['셀프여부'] === '셀프' || existing?.isSelf || false,
    });
  }

  const entries = [...stations.entries()];
  await insertStations(pool, entries);

  const prices: Array<{ uniId: string; fuel: string; price: number }> = [];
  for (const row of priceRows) {
    const uniId = row['고유번호'];
    if (!uniId) continue;
    for (const [column, fuel] of Object.entries(FUEL_COLUMNS)) {
      const price = Number.parseInt(row[column] ?? '', 10);
      // 0은 '취급 안 함'이지 공짜가 아니다. 저장하지 않는다.
      if (!Number.isFinite(price) || price <= 0) continue;
      prices.push({ uniId, fuel, price });
    }
  }
  await insertPrices(pool, prices, date);

  await pool.query(
    'INSERT INTO ingests (source, stations, prices, note) VALUES ($1, $2, $3, $4)',
    ['opinet-csv', entries.length, prices.length, date],
  );

  const { rows: stats } = await pool.query<{ total: number; geocoded: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE geocode_src = 'opinet')::int AS geocoded
     FROM stations`,
  );

  console.log(`\n적재 완료 (${date})`);
  console.log(`  주유소 ${stats[0].total}곳 (이번 적재 ${entries.length}행)`);
  console.log(`  가격 ${prices.length}건`);
  console.log(`  좌표 확보 ${stats[0].geocoded}/${stats[0].total}`);

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
