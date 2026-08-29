/**
 * 새벽 갱신이 제대로 됐는지 점검하고 결과를 알린다.
 *
 *   pnpm tsx scripts/verify-refresh.ts [--status ok|fail] [--notify]
 *
 * 갱신 스크립트가 조용히 실패해도(키 소진, 네트워크 오류) 겉으로는 정상 종료처럼
 * 보이는 경우가 있어, 결과 데이터를 직접 확인한다.
 * DISCORD_WEBHOOK 이 있으면 --notify 로 디스코드에 보낸다.
 */
import { createPool, loadEnv } from './lib/pool';

/** 오늘 새로 들어와야 할 최소 가격 건수. 이보다 적으면 뭔가 잘못된 것이다. */
const MIN_PRICES_TODAY = 1000;

type Check = { label: string; ok: boolean; detail: string };

function readFlag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  loadEnv();
  const runStatus = readFlag('status', 'ok');
  const pool = createPool();
  const checks: Check[] = [];

  try {
    const { rows: priceRows } = await pool.query<{ fuel: string; n: number }>(
      `SELECT fuel, COUNT(*)::int AS n FROM prices
       WHERE date = CURRENT_DATE GROUP BY fuel ORDER BY fuel`,
    );
    const totalToday = priceRows.reduce((sum, row) => sum + row.n, 0);
    checks.push({
      label: '오늘 가격 적재',
      ok: totalToday >= MIN_PRICES_TODAY,
      detail:
        priceRows.length === 0
          ? '0건 — 갱신이 전혀 안 됐다'
          : priceRows.map((row) => `${row.fuel} ${row.n.toLocaleString()}`).join(', '),
    });

    const { rows: coordRows } = await pool.query<{ total: number; resolved: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE geocode_src = 'opinet')::int AS resolved
       FROM stations`,
    );
    const { total, resolved } = coordRows[0];
    checks.push({
      label: '좌표 확보',
      ok: resolved > 0,
      detail: `${resolved.toLocaleString()} / ${total.toLocaleString()} (${Math.round((resolved / total) * 100)}%)`,
    });

    const { rows: ingestRows } = await pool.query<{ source: string; n: number }>(
      `SELECT source, COUNT(*)::int AS n FROM ingests
       WHERE started_at >= CURRENT_DATE GROUP BY source ORDER BY source`,
    );
    checks.push({
      label: '갱신 기록',
      ok: ingestRows.length > 0,
      detail:
        ingestRows.length === 0
          ? '없음 — 스크립트가 돌지 않았다'
          : ingestRows.map((row) => `${row.source} ${row.n}회`).join(', '),
    });

    const { rows: usageRows } = await pool.query<{ key_name: string; calls: number }>(
      'SELECT key_name, calls FROM api_usage WHERE date = CURRENT_DATE ORDER BY key_name',
    );
    checks.push({
      label: 'API 호출',
      ok: true,
      detail:
        usageRows.length === 0
          ? '0회'
          : usageRows.map((row) => `${row.key_name} ${row.calls}`).join(' · '),
    });

    const { rows: pendingRows } = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM stations WHERE geocode_src IS DISTINCT FROM 'opinet'",
    );
    checks.push({
      label: '남은 미해결',
      ok: true,
      detail: `${pendingRows[0].n.toLocaleString()}곳`,
    });
  } catch (error) {
    checks.push({
      label: 'DB 접근',
      ok: false,
      detail: error instanceof Error ? error.message : '알 수 없는 오류',
    });
  } finally {
    await pool.end().catch(() => undefined);
  }

  const failed = checks.filter((check) => !check.ok);
  const healthy = runStatus === 'ok' && failed.length === 0;

  console.log(healthy ? '점검 결과: 정상' : '점검 결과: 이상');
  for (const check of checks) {
    console.log(`  ${check.ok ? '✓' : '✗'} ${check.label}: ${check.detail}`);
  }
  if (runStatus !== 'ok') console.log('  ✗ 갱신 스크립트가 오류로 끝났다');

  if (process.argv.includes('--notify')) {
    await notifyDiscord(healthy, runStatus, checks);
  }

  // 이상이 있으면 0이 아닌 코드로 끝내 systemd 로그에서 눈에 띄게 한다.
  if (!healthy) process.exit(1);
}

async function notifyDiscord(
  healthy: boolean,
  runStatus: string,
  checks: readonly Check[],
): Promise<void> {
  const webhook = process.env.DISCORD_WEBHOOK;
  if (!webhook) {
    console.log('  (DISCORD_WEBHOOK 이 없어 알림을 건너뛴다)');
    return;
  }

  const lines = checks.map((check) => `${check.ok ? '✅' : '❌'} **${check.label}** ${check.detail}`);
  if (runStatus !== 'ok') lines.push('❌ **갱신 스크립트** 오류로 종료');

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: healthy ? '주유소 가격 갱신 정상' : '주유소 가격 갱신 확인 필요',
            description: lines.join('\n'),
            // 초록/빨강
            color: healthy ? 0x15b76d : 0xf04452,
            url: 'https://ssan-oil.vercel.app',
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
    console.log(
      response.ok
        ? '  디스코드 알림 전송됨'
        : `  디스코드 알림 실패: HTTP ${response.status}`,
    );
  } catch (error) {
    // 알림 실패로 점검 자체를 실패로 만들지는 않는다.
    console.log(`  디스코드 알림 실패: ${(error as Error).message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
