/**
 * 이미 쓴 오피넷 호출량을 api_usage에 기록한다.
 * 사용량 추적을 도입하기 전에 소진한 키를 클라이언트가 건너뛰게 하려는 1회성 보정이다.
 *
 *   pnpm tsx scripts/seed-usage.ts OPINET 1500
 */
import { createPool } from './lib/pool';

async function main(): Promise<void> {
  const keyName = process.argv[2];
  const calls = Number.parseInt(process.argv[3] ?? '', 10);
  if (!keyName || !Number.isFinite(calls)) {
    throw new Error('사용법: seed-usage.ts <키이름> <호출수>');
  }

  const pool = createPool();
  const date = new Date().toISOString().slice(0, 10);
  try {
    await pool.query(
      `INSERT INTO api_usage (key_name, date, calls) VALUES ($1, $2, $3)
       ON CONFLICT (key_name, date) DO UPDATE
         SET calls = GREATEST(api_usage.calls, EXCLUDED.calls)`,
      [keyName, date, calls],
    );
    const { rows } = await pool.query<{ key_name: string; calls: number }>(
      'SELECT key_name, calls FROM api_usage WHERE date = $1 ORDER BY key_name',
      [date],
    );
    for (const row of rows) console.log(`  ${row.key_name}: ${row.calls}회`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
