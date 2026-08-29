/**
 * 가격 데이터는 새벽에 한 번만 바뀐다. CDN에는 오래 두고, 만료 뒤에도
 * 낡은 응답을 먼저 돌려주면서 뒤에서 갱신하게 한다(stale-while-revalidate).
 */
const ONE_HOUR = 3600;
const ONE_DAY = 86400;

export const CACHE_HEADERS = {
  /** 지도/목록 조회. 뷰포트마다 달라 CDN 적중률은 낮지만 반복 이동에는 효과가 있다. */
  stations: `public, s-maxage=${ONE_HOUR}, stale-while-revalidate=${ONE_DAY}`,
  /** 저장소 현황. 자주 바뀌지 않는다. */
  stats: `public, s-maxage=${ONE_HOUR}, stale-while-revalidate=${ONE_DAY}`,
  /** 주소 검색 결과는 사실상 불변이다. */
  geocode: `public, s-maxage=${ONE_DAY}, stale-while-revalidate=${ONE_DAY * 7}`,
} as const;
