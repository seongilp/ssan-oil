/**
 * 로컬 SQLite에만 있는 조준 좌표(hint)를 Neon으로 옮긴다.
 * Neon 전환 중 SQLite에서 계속 돌던 작업 결과를 넘기기 위한 1회성 스크립트다.
 */
import { DatabaseSync } from 'node:sqlite';
import { createPool } from './lib/pool';

async function main(): Promise<void> {
  const db = new DatabaseSync('data/fuel.db', { readOnly: true });
  const pool = createPool();

  try {
    const rows = db
      .prepare(
        'SELECT uni_id, hint_lat, hint_lon FROM stations WHERE hint_lat IS NOT NULL',
      )
      .all() as Array<{ uni_id: string; hint_lat: number; hint_lon: number }>;

    console.log(`조준 좌표 ${rows.length}건 이관`);

    const BATCH = 1000;
    for (let start = 0; start < rows.length; start += BATCH) {
      const slice = rows.slice(start, start + BATCH);
      await pool.query(
        `UPDATE stations AS s SET hint_lat = v.lat, hint_lon = v.lon
         FROM (SELECT * FROM UNNEST($1::text[], $2::double precision[], $3::double precision[])
               AS t(uni_id, lat, lon)) AS v
         WHERE s.uni_id = v.uni_id`,
        [
          slice.map((row) => row.uni_id),
          slice.map((row) => row.hint_lat),
          slice.map((row) => row.hint_lon),
        ],
      );
    }

    const { rows: check } = await pool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM stations WHERE hint_lat IS NOT NULL',
    );
    console.log(`Neon 조준 좌표 보유: ${check[0].n}곳`);
  } finally {
    db.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
