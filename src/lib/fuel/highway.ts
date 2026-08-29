import { parseKrwPrice } from './parse';
import type { FuelSource, Station } from './types';

const ENDPOINT = 'https://data.ex.co.kr/openapi/business/curStateStation';

/**
 * data.ex.co.kr 앞단의 WAF가 기본 curl/fetch User-Agent를 'HTTP 400 Request Blocked'로
 * 차단한다. 인증키 문제로 오해하기 쉬우므로 브라우저 UA를 반드시 보낸다.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * 서버가 numOfRows를 100으로 캡하는데, 100을 보내면 실제로는 99행만 돌려주는
 * 오프바이원이 있다(99+99+28=226). 50은 정확히 50행이 오므로 50을 쓴다.
 */
const ROWS_PER_PAGE = 50;
/** 목록이 늘어나도 무한루프에 빠지지 않도록 두는 안전 상한. */
const MAX_PAGES = 50;

type RawStation = {
  serviceAreaCode?: string;
  serviceAreaName?: string;
  routeName?: string;
  direction?: string;
  svarAddr?: string;
  oilCompany?: string;
  telNo?: string;
  gasolinePrice?: string;
  diselPrice?: string;
  lpgPrice?: string;
};

type RawResponse = {
  list?: RawStation[];
  count?: number;
  code?: string;
  message?: string;
};

const OIL_COMPANY_LABELS: Record<string, string> = {
  AD: '알뜰',
  SK: 'SK에너지',
  GS: 'GS칼텍스',
  S: 'S-OIL',
  HD: '현대오일뱅크',
  RT: '자영',
  NH: '농협',
};

function toStation(raw: RawStation): Station | null {
  const code = raw.serviceAreaCode?.trim();
  const name = raw.serviceAreaName?.trim();
  // 식별자와 이름이 없으면 지오코딩도 표시도 불가능하므로 버린다.
  if (!code || !name) return null;

  const prices: Record<string, number> = {};
  const gasoline = parseKrwPrice(raw.gasolinePrice);
  const diesel = parseKrwPrice(raw.diselPrice);
  const lpg = parseKrwPrice(raw.lpgPrice);
  if (gasoline !== null) prices.gasoline = gasoline;
  if (diesel !== null) prices.diesel = diesel;
  if (lpg !== null) prices.lpg = lpg;

  const company = raw.oilCompany?.trim() ?? '';

  return {
    id: `highway:${code}`,
    source: 'highway',
    name,
    brand: OIL_COMPANY_LABELS[company] ?? company ?? '알 수 없음',
    address: raw.svarAddr?.trim() ?? '',
    coord: null, // 이 API는 좌표를 주지 않는다. stations.geo.json에서 채운다.
    prices,
    highway: {
      routeName: raw.routeName?.trim() ?? '',
      direction: raw.direction?.trim() ?? '',
    },
    tel: raw.telNo?.trim() || null,
  };
}

async function fetchPage(apiKey: string, pageNo: number): Promise<RawResponse> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('type', 'json');
  url.searchParams.set('numOfRows', String(ROWS_PER_PAGE));
  url.searchParams.set('pageNo', String(pageNo));

  const response = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    // 유가는 하루 단위로 바뀐다. 1시간 캐시로 일일 호출량을 아낀다.
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(
      `도로공사 API 응답 실패 (page ${pageNo}): HTTP ${response.status}. ` +
        'User-Agent 헤더가 누락되면 400 Request Blocked가 반환된다.',
    );
  }

  const text = await response.text();
  let parsed: RawResponse;
  try {
    parsed = JSON.parse(text) as RawResponse;
  } catch {
    // 인증 실패 시 JSON이 아니라 HTML 에러 페이지가 돌아온다.
    throw new Error(
      `도로공사 API가 JSON이 아닌 응답을 반환했다 (page ${pageNo}): ${text.slice(0, 120)}`,
    );
  }

  if (parsed.code && parsed.code !== 'SUCCESS') {
    throw new Error(`도로공사 API 오류: ${parsed.code} ${parsed.message ?? ''}`);
  }
  return parsed;
}

/** 전국 고속도로 휴게소 주유소를 페이징으로 모두 가져온다. */
export async function fetchHighwayStations(apiKey: string): Promise<Station[]> {
  if (!apiKey) throw new Error('DORO 환경변수(도로공사 API 키)가 설정되지 않았다.');

  const collected: Station[] = [];
  const seen = new Set<string>();

  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    const page = await fetchPage(apiKey, pageNo);
    const rows = page.list ?? [];
    if (rows.length === 0) break;

    for (const raw of rows) {
      const station = toStation(raw);
      // 페이지 경계에서 같은 행이 중복되는 경우가 있어 id로 걸러낸다.
      if (station && !seen.has(station.id)) {
        seen.add(station.id);
        collected.push(station);
      }
    }

    // 페이지당 실제 반환 행 수가 numOfRows와 어긋날 수 있으므로
    // 페이지 길이가 아니라 전체 건수(count)를 종료 조건으로 삼는다.
    const total = page.count ?? 0;
    if (total > 0 && collected.length >= total) break;
  }

  return collected;
}

export const highwaySource: FuelSource = {
  id: 'highway',
  listAll: () => fetchHighwayStations(process.env.DORO ?? ''),
};
