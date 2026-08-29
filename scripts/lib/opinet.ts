/**
 * 오피넷 API 호출기.
 *
 * 키가 두 종류이고 인증 파라미터 이름이 서로 다르다.
 *   - OPINET (41자)  → certkey=
 *   - OIL    (10자)  → code=
 * 파라미터 이름이 틀리면 에러 없이 빈 배열이 돌아와서 원인 파악이 어렵다.
 *
 * 키마다 일일 한도(무료 1,500회)가 따로 걸리므로, 예산을 나눠 쓰고
 * 한 키를 소진하면 다음 키로 넘어간다.
 */
const API_BASE = 'https://www.opinet.co.kr/api';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 키 하나의 무료 일일 한도. 여유를 두고 조금 낮춰 잡는다. */
export const PER_KEY_BUDGET = 1450;

type Credential = {
  readonly name: string;
  readonly param: 'certkey' | 'code';
  readonly value: string;
  used: number;
};

export type OpinetClient = {
  /** 남은 호출 가능 횟수(모든 키 합계). */
  remaining(): number;
  /** 지금까지 호출한 횟수. */
  used(): number;
  /** 현재 쓰고 있는 키 이름. 소진 판정 로그에 쓴다. */
  currentKey(): string | null;
  call(operation: string, params: Record<string, string>): Promise<unknown[]>;
};

export type UsageStore = {
  load(keyName: string): Promise<number>;
  record(keyName: string, calls: number): Promise<void>;
};

/** 환경변수에서 사용 가능한 키를 모은다. 없으면 예외를 던진다. */
export async function createOpinetClient(
  usage?: UsageStore,
  perKeyBudget = PER_KEY_BUDGET,
): Promise<OpinetClient> {
  const credentials: Credential[] = [];

  if (process.env.OPINET) {
    credentials.push({ name: 'OPINET', param: 'certkey', value: process.env.OPINET, used: 0 });
  }
  if (process.env.OIL) {
    credentials.push({ name: 'OIL', param: 'code', value: process.env.OIL, used: 0 });
  }
  if (credentials.length === 0) {
    throw new Error('오피넷 키가 없다. .env.local 에 OPINET 또는 OIL 을 설정하라.');
  }

  // 오늘 이미 쓴 만큼을 반영한다. 이게 없으면 재실행 때마다 예산이 되살아나
  // 소진된 키로 계속 호출하게 되고, 빈 응답을 '주유소 없음'으로 오해한다.
  if (usage) {
    for (const credential of credentials) {
      credential.used = await usage.load(credential.name);
    }
  }

  for (const credential of credentials) {
    console.log(
      `  키 ${credential.name}: 오늘 ${credential.used}/${perKeyBudget}회 사용`,
    );
  }

  const pick = (): Credential | null =>
    credentials.find((credential) => credential.used < perKeyBudget) ?? null;

  return {
    remaining: () =>
      credentials.reduce((sum, c) => sum + Math.max(0, perKeyBudget - c.used), 0),
    used: () => credentials.reduce((sum, c) => sum + c.used, 0),
    currentKey: () => pick()?.name ?? null,

    async call(operation, params) {
      const credential = pick();
      if (!credential) throw new Error('모든 키의 일일 예산을 소진했다.');

      const url = new URL(`${API_BASE}/${operation}.do`);
      url.searchParams.set('out', 'json');
      url.searchParams.set(credential.param, credential.value);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      credential.used += 1;
      await usage?.record(credential.name, 1);
      const response = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
      if (!response.ok) throw new Error(`${operation} HTTP ${response.status}`);

      const data = (await response.json()) as { RESULT?: { OIL?: unknown[] } };
      return data.RESULT?.OIL ?? [];
    },
  };
}
