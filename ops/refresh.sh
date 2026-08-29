#!/bin/bash
# 새벽 갱신: 오피넷 스윕으로 주유소 좌표와 가격을 Neon에 채운다.
#
# 로컬 맥(launchd)에서도, 리눅스 서버(systemd/cron/도커)에서도 같은 스크립트를 쓴다.
# 필요한 환경변수: DATABASE_URL, OPINET, OIL, OSM_CONTACT
#   - 서버에서는 환경변수로 주입하고, 로컬에서는 .env.local 을 읽는다.
# 개별 단계가 실패해도 끝까지 가서 결과를 알려야 하므로 -e 는 쓰지 않는다.
set -uo pipefail

cd "$(dirname "$0")/.."

# 로컬 개발 환경 편의. 서버에서는 .env.local 이 없고 환경변수가 이미 들어와 있다.
if [ -f .env.local ] && [ -z "${DATABASE_URL:-}" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL 이 필요하다}"

# 키 하나라도 있어야 한다. 둘 다 있으면 예산이 두 배가 된다.
if [ -z "${OPINET:-}" ] && [ -z "${OIL:-}" ]; then
  echo "OPINET 또는 OIL 키가 필요하다" >&2
  exit 1
fi

RUNNER="${RUNNER:-node_modules/.bin/tsx}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "갱신 시작"

# 디스코드로 짧은 메시지를 보낸다. 실패해도 갱신 자체는 계속한다.
notify_discord() {
  local title="$1" desc="$2" color="$3"
  [ -z "${DISCORD_WEBHOOK:-}" ] && return 0

  local payload
  payload=$(python3 - "$title" "$desc" "$color" <<'PY'
import json, sys
title, desc, color = sys.argv[1], sys.argv[2], int(sys.argv[3])
# 디스코드 embed description 상한은 4096자다. 여유를 두고 자른다.
if len(desc) > 3800:
    desc = desc[:3800] + "\n… (이하 생략)"
print(json.dumps(
    {"embeds": [{"title": title, "description": desc, "color": color}]},
    ensure_ascii=False,
))
PY
)
  curl -s -o /dev/null --max-time 15 -X POST \
    -H 'Content-Type: application/json' -d "$payload" "$DISCORD_WEBHOOK" || true
}

# 단계별 실패를 모아 마지막에 한 번에 판정한다.
#
# 평소에는 조용히 있다가 마지막 요약만 보내지만, 실패한 단계가 생기면
# 그 즉시 알린다. 배치가 끝날 때까지 기다리면 원인 파악이 늦어진다.
STATUS=ok
run_step() {
  local name="$1"
  shift
  log "$name"

  local out
  out=$(mktemp -t oil-step.XXXXXX)
  if "$@" 2>&1 | tee "$out"; then
    rm -f "$out"
    return 0
  fi

  log "$name 실패"
  STATUS=fail

  # 원인을 바로 알 수 있게 해당 단계 출력의 끝부분을 같이 보낸다.
  local tail_output
  tail_output=$(tail -n 15 "$out")
  rm -f "$out"

  notify_discord \
    "❌ 단계 실패: ${name}" \
    "$(printf '```\n%s\n```' "$tail_output")" \
    15745106
}

# 1) 아직 좌표를 모르는 주유소가 있으면 행정동 지오코딩으로 조준 좌표를 채운다.
#    Nominatim은 무료라 오피넷 예산과 무관하다. 실패해도 나머지는 진행한다.
log "조준 좌표 보완"
"$RUNNER" scripts/hint-geocode.ts || log "조준 좌표 단계 실패(계속 진행)"

# 2) 조준 좌표를 덮는 스윕 지점을 만든다. 채울 게 없으면 실패가 아니다.
log "격자 재계산(hints)"
"$RUNNER" scripts/build-grid.ts --hints || log "격자(hints) 생략"

# 3) 미해결 주유소 찾기. 예산은 스크립트가 키별 잔여량에서 자동 계산한다.
run_step "좌표 탐색 스윕" "$RUNNER" scripts/refresh-prices.ts --fuel gasoline --mode hints

# 4) 스윕으로도 안 잡힌 나머지는 UNI_ID로 핀포인트 조회한다.
#    광역시 구 지역은 도로명주소에 동 이름이 없어 조준 좌표를 못 만든다.
#    스윕은 반경 탐색이라 이런 곳에 예산을 흘리지만, ID를 알면 1회에 1곳이 확실하다.
#    가격 갱신 예산을 남겨야 하므로 하루 600회로 묶는다.
run_step "미확보 좌표 핀포인트 조회" "$RUNNER" scripts/fill-coords.ts --budget 600

# 5) 좌표를 아는 주유소를 덮는 최소 지점으로 일상 가격 갱신.
run_step "격자 커버 갱신" "$RUNNER" scripts/build-grid.ts
run_step "휘발유 가격 갱신" "$RUNNER" scripts/refresh-prices.ts --fuel gasoline --mode refresh
run_step "경유 가격 갱신" "$RUNNER" scripts/refresh-prices.ts --fuel diesel --mode refresh

# 6) 결과 데이터를 직접 확인하고 알린다.
#    스크립트가 조용히 실패해도 겉으로는 정상 종료처럼 보이는 경우가 있다.
log "결과 점검"
"$RUNNER" scripts/verify-refresh.ts --status "$STATUS" --notify
VERIFY_STATUS=$?

log "갱신 완료 (단계 $STATUS, 점검 종료코드 $VERIFY_STATUS)"
exit "$VERIFY_STATUS"
