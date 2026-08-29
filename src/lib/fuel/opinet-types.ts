import type { FuelType } from './types';

/** 오피넷 제품 코드. 요청의 prodcd와 응답의 PRODCD가 이 값을 쓴다. */
export const PROD_CODE: Record<FuelType, string> = {
  gasoline: 'B027',
  diesel: 'D047',
  lpg: 'K015',
};

export const FUEL_BY_PROD_CODE: ReadonlyMap<string, FuelType> = new Map(
  Object.entries(PROD_CODE).map(([fuel, code]) => [code, fuel as FuelType]),
);

/** 상표 코드 → 표시 이름. */
export const BRAND_LABELS: Record<string, string> = {
  SKE: 'SK에너지',
  GSC: 'GS칼텍스',
  HDO: '현대오일뱅크',
  SOL: 'S-OIL',
  RTO: '자영알뜰',
  RTX: '고속도로알뜰',
  NHO: '농협알뜰',
  ETC: '자가상표',
  E1G: 'E1',
  SKG: 'SK가스',
};

/** aroundAll 응답 1건. 좌표는 KATEC이다. */
export type RawAroundStation = {
  UNI_ID?: string;
  POLL_DIV_CO?: string;
  OS_NM?: string;
  PRICE?: number | string;
  DISTANCE?: number | string;
  GIS_X_COOR?: number | string;
  GIS_Y_COOR?: number | string;
};

/** detailById 응답 1건. */
export type RawStationDetail = {
  UNI_ID?: string;
  POLL_DIV_CO?: string;
  OS_NM?: string;
  VAN_ADR?: string;
  NEW_ADR?: string;
  TEL?: string;
  GIS_X_COOR?: number | string;
  GIS_Y_COOR?: number | string;
  LPG_YN?: string;
  MAINT_YN?: string;
  CAR_WASH_YN?: string;
  CVS_YN?: string;
  OIL_PRICE?: Array<{ PRODCD?: string; PRICE?: number | string }>;
};

export type OpinetEnvelope<T> = {
  RESULT?: { OIL?: T[] };
};
