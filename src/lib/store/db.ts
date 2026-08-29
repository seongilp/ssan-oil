import { neon } from '@neondatabase/serverless';

/**
 * 웹 요청용 읽기 클라이언트. Neon의 HTTP 드라이버는 커넥션을 유지하지 않아
 * 서버리스에서 지연이 낮다. 대량 쓰기는 scripts/lib/pool.ts 의 Pool을 쓴다.
 *
 * 최상위에서 즉시 연결을 만들면 환경변수가 없는 빌드 시점에 터지므로
 * 처음 호출될 때 만든다.
 */
type SqlClient = ReturnType<typeof neon>;

let cached: SqlClient | null = null;

export function getSql(): SqlClient {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 환경변수가 설정되지 않았다.');

  cached = neon(url);
  return cached;
}
