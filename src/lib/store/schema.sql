-- 주유소 마스터. 오피넷 고유번호(UNI_ID)를 그대로 PK로 쓴다.
CREATE TABLE IF NOT EXISTS stations (
  uni_id      TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  name        TEXT NOT NULL,
  brand       TEXT NOT NULL DEFAULT '',
  region      TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  tel         TEXT,
  is_self     BOOLEAN NOT NULL DEFAULT FALSE,
  -- 표시용 좌표. 오피넷이 준 값(geocode_src='opinet')만 신뢰한다.
  lat         DOUBLE PRECISION,
  lon         DOUBLE PRECISION,
  geocode_src TEXT,
  -- 주소 지오코딩으로 얻은 대략적 위치(오차 1~2km).
  -- 반경 5km 스윕 원을 어디에 놓을지 정하는 데만 쓰고 표시에는 쓰지 않는다.
  hint_lat    DOUBLE PRECISION,
  hint_lon    DOUBLE PRECISION,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 날짜별 가격. 매일 새벽에 한 행씩 쌓여 시계열이 된다.
CREATE TABLE IF NOT EXISTS prices (
  uni_id TEXT NOT NULL REFERENCES stations(uni_id) ON DELETE CASCADE,
  date   DATE NOT NULL,
  fuel   TEXT NOT NULL,
  price  INTEGER NOT NULL,
  PRIMARY KEY (uni_id, date, fuel)
);

-- 뷰포트(bbox) 조회가 주 질의 패턴이다.
CREATE INDEX IF NOT EXISTS idx_stations_coord ON stations (lat, lon)
  WHERE geocode_src = 'opinet';
CREATE INDEX IF NOT EXISTS idx_stations_region ON stations (region);
CREATE INDEX IF NOT EXISTS idx_prices_lookup ON prices (fuel, date, uni_id);

-- 스냅샷 적재 이력. 크론이 언제 무엇을 채웠는지 남긴다.
CREATE TABLE IF NOT EXISTS ingests (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source     TEXT NOT NULL,
  stations   INTEGER NOT NULL DEFAULT 0,
  prices     INTEGER NOT NULL DEFAULT 0,
  note       TEXT
);

-- aroundAll 스윕 지점. 한 번 훑어 아무 것도 안 나온 셀은 barren으로 표시해
-- 다음부터 건너뛴다. 일일 호출 예산을 지키는 핵심 장치다.
CREATE TABLE IF NOT EXISTS grid_cells (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lat        DOUBLE PRECISION NOT NULL,
  lon        DOUBLE PRECISION NOT NULL,
  last_swept DATE,
  last_yield INTEGER,
  barren     BOOLEAN NOT NULL DEFAULT FALSE,
  region     TEXT,
  UNIQUE (lat, lon)
);

CREATE INDEX IF NOT EXISTS idx_cells_queue ON grid_cells (barren, last_swept);
CREATE INDEX IF NOT EXISTS idx_cells_region ON grid_cells (region, barren, last_swept);

-- 시군구 경계 상자. 격자 셀을 지역에 묶어 '아직 좌표를 모르는 주유소가 많은
-- 지역'부터 훑기 위해 저장한다.
CREATE TABLE IF NOT EXISTS regions (
  name  TEXT PRIMARY KEY,
  south DOUBLE PRECISION NOT NULL,
  west  DOUBLE PRECISION NOT NULL,
  north DOUBLE PRECISION NOT NULL,
  east  DOUBLE PRECISION NOT NULL
);

-- 키별 일일 호출 수. 오피넷은 한도를 넘겨도 에러 대신 빈 배열을 주기 때문에,
-- 스크립트가 여러 번 실행돼도 누적 사용량을 알 수 있어야 한다.
CREATE TABLE IF NOT EXISTS api_usage (
  key_name TEXT NOT NULL,
  date     DATE NOT NULL,
  calls    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_name, date)
);
