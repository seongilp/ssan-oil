/**
 * 오피넷은 한국 서비스다. 일일 호출 한도도, 가격 기준일도 한국시각으로 끊긴다.
 *
 * UTC로 날짜를 계산하면 KST 00:00~09:00 사이에 도는 작업이 '어제'로 기록된다.
 * 새벽 04:10 크론이 정확히 이 구간에 들어가서, 전날 소진한 예산을 물려받아
 * 하루치 작업을 통째로 건너뛰는 문제가 있었다.
 */
const KST_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 한국시각 기준 오늘 날짜(YYYY-MM-DD). */
export function kstToday(): string {
  // en-CA 로케일이 YYYY-MM-DD 형식을 준다.
  return KST_FORMATTER.format(new Date());
}

/** SQL에서 한국시각 오늘을 가리키는 표현식. */
export const KST_TODAY_SQL = "(now() AT TIME ZONE 'Asia/Seoul')::date";
