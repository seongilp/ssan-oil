/**
 * KATEC ↔ WGS84 변환 오차를 실측으로 보정한다.
 *
 * 저장소에서 이미 지오코딩된 주유소를 표본으로 뽑아 오피넷 detailById로
 * 공식 KATEC 좌표를 받고, 우리 변환 결과와 비교해 계통 오차를 추정한다.
 *
 *   pnpm calibrate:katec [표본수]
 *
 * 표본 수만큼만 API를 쓴다(기본 25회). 일일 1,500회 예산에 부담이 없다.
 */
import { createPool, loadEnv } from './lib/pool';
import { wgs84ToKatec } from '../src/lib/geo/katec';

const API_BASE = 'https://www.opinet.co.kr/api';
const DELAY_MS = 250;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchDetail(uniId: string, certkey: string) {
  const url = new URL(`${API_BASE}/detailById.do`);
  url.searchParams.set('out', 'json');
  url.searchParams.set('id', uniId);
  // 인증 파라미터 이름은 code가 아니라 certkey다. 틀리면 에러 없이 빈 배열이 온다.
  url.searchParams.set('certkey', certkey);

  const response = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    RESULT?: { OIL?: Array<{ GIS_X_COOR?: number; GIS_Y_COOR?: number }> };
  };
  const oil = data.RESULT?.OIL?.[0];
  if (!oil || typeof oil.GIS_X_COOR !== 'number' || typeof oil.GIS_Y_COOR !== 'number') {
    return null;
  }
  return { x: oil.GIS_X_COOR, y: oil.GIS_Y_COOR };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

async function main(): Promise<void> {
  loadEnv();
  const certkey = process.env.OPINET;
  if (!certkey) throw new Error('OPINET 환경변수(오피넷 인증키)가 없다.');

  const sampleSize = Number.parseInt(process.argv[2] ?? '25', 10);

  // 전국에 고르게 퍼지도록 무작위 표본을 뽑는다. 한 지역에 몰리면
  // 계통 오차와 지역 편차를 구분할 수 없다.
  const pool = createPool();
  const { rows: samples } = await pool.query<{
    uni_id: string;
    lat: number;
    lon: number;
  }>(
    `SELECT uni_id, lat, lon FROM stations
     WHERE lat IS NOT NULL ORDER BY random() LIMIT $1`,
    [sampleSize],
  );

  if (samples.length === 0) throw new Error('지오코딩된 주유소가 아직 없다.');
  console.log(`표본 ${samples.length}건으로 보정값을 추정한다.\n`);

  const dxs: number[] = [];
  const dys: number[] = [];

  for (const sample of samples) {
    const actual = await fetchDetail(sample.uni_id, certkey);
    await sleep(DELAY_MS);
    if (!actual) continue;

    const projected = wgs84ToKatec(sample.lat, sample.lon);
    const dx = actual.x - projected.x;
    const dy = actual.y - projected.y;
    dxs.push(dx);
    dys.push(dy);
    console.log(
      `  ${sample.uni_id}  dx ${dx.toFixed(0).padStart(6)}m  dy ${dy.toFixed(0).padStart(6)}m`,
    );
  }

  if (dxs.length === 0) throw new Error('detailById 응답을 한 건도 받지 못했다.');

  // 지오코딩 자체의 오차(건물 단위 편차)가 섞여 있으므로 평균이 아니라
  // 이상치에 둔감한 중앙값을 계통 오차로 본다.
  const offsetX = median(dxs);
  const offsetY = median(dys);
  const residuals = dxs.map((dx, index) =>
    Math.hypot(dx - offsetX, dys[index] - offsetY),
  );

  console.log(`\n표본 ${dxs.length}건`);
  console.log(`  계통 오차(중앙값): dx ${offsetX.toFixed(1)}m, dy ${offsetY.toFixed(1)}m`);
  console.log(`  보정 후 잔차 중앙값: ${median(residuals).toFixed(0)}m`);
  console.log(
    `  보정 후 잔차 최대: ${Math.max(...residuals).toFixed(0)}m (지오코딩 오차 포함)`,
  );
  console.log(
    `\nsrc/lib/geo/katec.ts 의 KATEC_OFFSET 을 { x: ${offsetX.toFixed(1)}, y: ${offsetY.toFixed(1)} } 로 설정하라.`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
