import { strict as assert } from 'node:assert';
import { katecToWgs84, wgs84ToKatec } from './katec';

/**
 * node --test 로 실행. 오피넷 키 없이도 좌표 변환의 정확성을 검증한다.
 * 변환이 틀리면 "주유소가 하나도 없다"는 형태로만 드러나서 원인 파악이 어렵다.
 */
const SEOUL_CITY_HALL = { lat: 37.5663, lon: 126.9779 };

// 왕복 변환 오차가 1m 미만이어야 한다.
const roundTrip = katecToWgs84(
  wgs84ToKatec(SEOUL_CITY_HALL.lat, SEOUL_CITY_HALL.lon).x,
  wgs84ToKatec(SEOUL_CITY_HALL.lat, SEOUL_CITY_HALL.lon).y,
);
assert.ok(Math.abs(roundTrip.lat - SEOUL_CITY_HALL.lat) < 1e-5, '위도 왕복 오차');
assert.ok(Math.abs(roundTrip.lon - SEOUL_CITY_HALL.lon) < 1e-5, '경도 왕복 오차');

// KATEC 좌표는 한반도 범위에서 대략 x 100k~500k, y 200k~800k 사이에 들어온다.
const katec = wgs84ToKatec(SEOUL_CITY_HALL.lat, SEOUL_CITY_HALL.lon);
assert.ok(katec.x > 100_000 && katec.x < 500_000, `x가 범위를 벗어남: ${katec.x}`);
assert.ok(katec.y > 200_000 && katec.y < 800_000, `y가 범위를 벗어남: ${katec.y}`);

console.log('katec: ok', katec);
