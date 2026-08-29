/**
 * Neon에 스키마를 적용한다.
 *
 *   pnpm db:migrate
 */
import { createPool, ensureSchema } from './lib/pool';

async function main(): Promise<void> {
  const pool = createPool();
  try {
    await ensureSchema(pool);
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    console.log('테이블:', rows.map((row) => row.table_name).join(', '));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
