import proj4 from 'proj4';

/**
 * 오피넷 API는 WGS84 위경도가 아니라 KATEC(TM128, Bessel 타원체) 좌표를 쓴다.
 * 요청의 x/y도, 응답의 GIS_X_COOR/GIS_Y_COOR도 모두 이 좌표계다.
 * GPS 좌표를 그대로 넣으면 결과가 비거나 엉뚱한 곳이 나오므로 경계에서 반드시 변환한다.
 *
 * OSM(지도/경로/지오코딩)은 전부 WGS84이므로, 변환은 오피넷 어댑터 안에서만 일어나야 한다.
 */
const KATEC =
  '+proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000 ' +
  '+ellps=bessel +units=m +no_defs ' +
  '+towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';

const WGS84 = 'EPSG:4326';

export type KatecPoint = { readonly x: number; readonly y: number };

/**
 * 오피넷 실측 좌표 25건과 비교해 얻은 계통 오차(scripts/calibrate-katec.ts).
 * proj4 정의만으로는 약 100m가 남아서 여기서 보정한다.
 * 이보다 큰 편차는 투영이 아니라 주소 지오코딩 쪽 오차였다.
 */
const KATEC_OFFSET = { x: 96.7, y: 86.9 } as const;

export function wgs84ToKatec(lat: number, lon: number): KatecPoint {
  const [x, y] = proj4(WGS84, KATEC, [lon, lat]);
  return { x: x + KATEC_OFFSET.x, y: y + KATEC_OFFSET.y };
}

export function katecToWgs84(x: number, y: number): { lat: number; lon: number } {
  const [lon, lat] = proj4(KATEC, WGS84, [x - KATEC_OFFSET.x, y - KATEC_OFFSET.y]);
  return { lat, lon };
}
