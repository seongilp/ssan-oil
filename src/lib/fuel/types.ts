/** 연료 종류. 오피넷 prodcd(B027=휘발유, D047=경유, K015=LPG)와 대응된다. */
export type FuelType = 'gasoline' | 'diesel' | 'lpg';

export const FUEL_LABELS: Record<FuelType, string> = {
  gasoline: '휘발유',
  diesel: '경유',
  lpg: 'LPG',
};

/** 주유소가 어느 소스에서 왔는지. 경로 구간별로 다른 소스를 쓰기 때문에 구분이 필요하다. */
export type SourceId = 'highway' | 'opinet';

export type Coord = {
  readonly lat: number;
  readonly lon: number;
};

/**
 * 소스 중립 주유소 표현. 도로공사/오피넷 응답은 모두 이 형태로 정규화된다.
 * 가격은 원 단위 정수이며, 값이 없는 연료는 키가 없다(0이 아님 — 0은 "공짜"로 오해된다).
 */
export type Station = {
  readonly id: string;
  readonly source: SourceId;
  readonly name: string;
  readonly brand: string;
  readonly address: string;
  readonly coord: Coord | null;
  readonly prices: Partial<Record<FuelType, number>>;
  /** 고속도로 주유소만 채워진다. 일반 주유소는 null. */
  readonly highway: HighwayInfo | null;
  readonly tel: string | null;
};

export type HighwayInfo = {
  readonly routeName: string;
  /** 진행 방향(예: '부산', '서울'). 반대 방향 휴게소는 들를 수 없으므로 필터링에 쓴다. */
  readonly direction: string;
};

/** 어댑터 인터페이스. 오피넷 키가 발급되면 같은 계약으로 꽂는다. */
export type FuelSource = {
  readonly id: SourceId;
  /** 전국 목록을 한 번에 반환하는 소스(도로공사)용. */
  readonly listAll?: () => Promise<readonly Station[]>;
  /** 좌표 반경 조회를 지원하는 소스(오피넷)용. radiusMeters는 소스별 상한이 있다. */
  readonly listAround?: (
    center: Coord,
    radiusMeters: number,
    fuel: FuelType,
  ) => Promise<readonly Station[]>;
};
