/**
 * 로컬 SQLite(data/fuel.db)에 쌓아 둔 데이터를 Neon으로 옮긴다. 1회성 스크립트다.
 *
 *   pnpm db:import-sqlite
 *
 * 대량 적재는 행마다 왕복하면 너무 느리므로 UNNEST로 배치 INSERT 한다.
 */
import { DatabaseSync } from 'node:sqlite';
import type { Pool } from '@neondatabase/serverless';
import { createPool, ensureSchema } from './lib/pool';

const SQLITE_PATH = 'data/fuel.db';
const BATCH = 1000;

type Row = Record<string, unknown>;

/** 열 단위 배열로 뒤집는다. UNNEST는 컬럼별 배열을 받는다. */
function columns(rows: readonly Row[], keys: readonly string[]): unknown[][] {
  return keys.map((key) => rows.map((row) => row[key]));
}

async function insertBatched(
  pool: Pool,
  rows: readonly Row[],
  keys: readonly string[],
  sqlFor: (placeholders: string) => string,
  label: string,
): Promise<number> {
  let done = 0;
  for (let start = 0; start < rows.length; start += BATCH) {
    const slice = rows.slice(start, start + BATCH);
    const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');
    await pool.query(sqlFor(placeholders), columns(slice, keys));
    done += slice.length;
    if (done % 5000 === 0 || done === rows.length) {
      console.log(`  ${label} ${done}/${rows.length}`);
    }
  }
  return done;
}

async function main(): Promise<void> {
  const db = new DatabaseSync(SQLITE_PATH, { readOnly: true });
  const pool = createPool();

  try {
    await ensureSchema(pool);

    const stations = db
      .prepare(
        `SELECT uni_id, source, name, brand, region, address, tel, is_self,
                lat, lon, geocode_src, hint_lat, hint_lon
         FROM stations`,
      )
      .all() as Array<Record<string, unknown>>;

    await insertBatched(
      pool,
      stations.map((row) => ({ ...row, is_self: row.is_self === 1 })),
      [
        'uni_id', 'source', 'name', 'brand', 'region', 'address', 'tel',
        'is_self', 'lat', 'lon', 'geocode_src', 'hint_lat', 'hint_lon',
      ],
      (p) => `INSERT INTO stations
        (uni_id, source, name, brand, region, address, tel, is_self, lat, lon, geocode_src, hint_lat, hint_lon)
        SELECT * FROM UNNEST(${p.split(', ').map((ph, i) =>
          `${ph}::${['text','text','text','text','text','text','text','boolean','double precision','double precision','text','double precision','double precision'][i]}[]`,
        ).join(', ')})
        ON CONFLICT (uni_id) DO UPDATE SET
          name = EXCLUDED.name, brand = EXCLUDED.brand, region = EXCLUDED.region,
          address = EXCLUDED.address, tel = EXCLUDED.tel, is_self = EXCLUDED.is_self,
          lat = EXCLUDED.lat, lon = EXCLUDED.lon, geocode_src = EXCLUDED.geocode_src,
          hint_lat = EXCLUDED.hint_lat, hint_lon = EXCLUDED.hint_lon`,
      '주유소',
    );

    const prices = db
      .prepare('SELECT uni_id, date, fuel, price FROM prices')
      .all() as Array<Record<string, unknown>>;

    await insertBatched(
      pool,
      prices,
      ['uni_id', 'date', 'fuel', 'price'],
      () => `INSERT INTO prices (uni_id, date, fuel, price)
        SELECT * FROM UNNEST($1::text[], $2::date[], $3::text[], $4::integer[])
        ON CONFLICT (uni_id, date, fuel) DO UPDATE SET price = EXCLUDED.price`,
      '가격',
    );

    const regions = db
      .prepare('SELECT name, south, west, north, east FROM regions')
      .all() as Array<Record<string, unknown>>;

    if (regions.length > 0) {
      await insertBatched(
        pool,
        regions,
        ['name', 'south', 'west', 'north', 'east'],
        () => `INSERT INTO regions (name, south, west, north, east)
          SELECT * FROM UNNEST($1::text[], $2::double precision[], $3::double precision[],
                               $4::double precision[], $5::double precision[])
          ON CONFLICT (name) DO NOTHING`,
        '지역',
      );
    }

    const cells = db
      .prepare('SELECT lat, lon, last_swept, last_yield, barren, region FROM grid_cells')
      .all() as Array<Record<string, unknown>>;

    await insertBatched(
      pool,
      cells.map((row) => ({ ...row, barren: row.barren === 1 })),
      ['lat', 'lon', 'last_swept', 'last_yield', 'barren', 'region'],
      () => `INSERT INTO grid_cells (lat, lon, last_swept, last_yield, barren, region)
        SELECT * FROM UNNEST($1::double precision[], $2::double precision[], $3::date[],
                             $4::integer[], $5::boolean[], $6::text[])
        ON CONFLICT (lat, lon) DO UPDATE SET
          last_swept = EXCLUDED.last_swept, last_yield = EXCLUDED.last_yield,
          barren = EXCLUDED.barren, region = COALESCE(grid_cells.region, EXCLUDED.region)`,
      '격자',
    );

    for (const [label, query] of [
      ['주유소', 'SELECT COUNT(*)::int AS n FROM stations'],
      ['좌표 확보', "SELECT COUNT(*)::int AS n FROM stations WHERE geocode_src = 'opinet'"],
      ['가격', 'SELECT COUNT(*)::int AS n FROM prices'],
      ['격자', 'SELECT COUNT(*)::int AS n FROM grid_cells'],
      ['지역', 'SELECT COUNT(*)::int AS n FROM regions'],
    ] as const) {
      const { rows } = await pool.query<{ n: number }>(query);
      console.log(`  ${label}: ${rows[0].n}`);
    }
  } finally {
    db.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
