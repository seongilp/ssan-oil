import { existsSync, readFileSync } from 'node:fs';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

/**
 * 스크립트(적재·스윕)용 커넥션 풀.
 *
 * HTTP 드라이버는 한 번에 한 문장씩만 보낼 수 있어 1만 건 적재에 부적합하다.
 * Pool은 WebSocket으로 붙어 트랜잭션과 다중 행 INSERT를 쓸 수 있다.
 * Node에는 내장 WebSocket 생성자가 없어 ws를 주입한다.
 */
neonConfig.webSocketConstructor = ws;

export function loadEnv(): void {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = /^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/i.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

export function createPool(): Pool {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 환경변수가 설정되지 않았다.');
  return new Pool({ connectionString: url });
}

/** 스키마를 적용한다. 모든 스크립트가 시작할 때 한 번 부른다. */
export async function ensureSchema(pool: Pool): Promise<void> {
  const schema = readFileSync('src/lib/store/schema.sql', 'utf8');
  await pool.query(schema);
}
