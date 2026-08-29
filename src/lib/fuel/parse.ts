/**
 * 도로공사 API는 가격을 '1,864원' 형태의 문자열로 주고,
 * 취급하지 않는 연료는 'X'로 준다. 파싱 실패는 조용히 넘기지 않고 null로 명시한다.
 */
export function parseKrwPrice(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits === '') return null;
  const value = Number.parseInt(digits, 10);
  // 국내 유가가 리터당 100원 미만이거나 100,000원 초과일 수는 없다.
  // 범위를 벗어나면 포맷이 바뀐 것이므로 값으로 취급하지 않는다.
  if (!Number.isFinite(value) || value < 100 || value > 100_000) return null;
  return value;
}

/**
 * '서울만남(부산)주유소' → '서울만남'
 * OSM의 휴게소 이름과 매칭하기 위해 방향 괄호와 시설 접미사를 떼어낸다.
 */
export function baseServiceAreaName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .replace(/(주유소|휴게소|충전소)\s*$/g, '')
    .trim();
}
