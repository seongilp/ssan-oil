#!/bin/bash
# 지난 24시간의 갱신 로그를 디스코드로 보낸다.
#
# 갱신 직후 알림(verify-refresh.ts)과 별개로 도는 이유는, 타이머 자체가 돌지 않은
# 경우를 잡기 위해서다. 실행이 없으면 실행 직후 훅도 없다.
set -uo pipefail

UNIT="${UNIT:-oil-refresh.service}"
SINCE="${SINCE:-24 hours ago}"

if [ -z "${DISCORD_WEBHOOK:-}" ]; then
  echo "DISCORD_WEBHOOK 이 없다" >&2
  exit 1
fi

LOG_FILE="$(mktemp -t oil-refresh-log.XXXXXX).txt"
trap 'rm -f "$LOG_FILE"' EXIT

journalctl -u "$UNIT" --since "$SINCE" --no-pager -o short-iso > "$LOG_FILE" 2>&1

LINES=$(wc -l < "$LOG_FILE" | tr -d ' ')

# 마지막 실행 결과를 systemd에서 직접 읽는다. 로그 파싱보다 확실하다.
RESULT=$(systemctl show "$UNIT" -p Result --value 2>/dev/null)
EXIT_CODE=$(systemctl show "$UNIT" -p ExecMainStatus --value 2>/dev/null)
LAST_RUN=$(systemctl show "$UNIT" -p ExecMainStartTimestamp --value 2>/dev/null)
NEXT_RUN=$(systemctl show "${UNIT%.service}.timer" -p NextElapseUSecRealtime --value 2>/dev/null)

if [ "$LINES" -eq 0 ]; then
  # 로그가 한 줄도 없다 = 지난 24시간 동안 한 번도 실행되지 않았다.
  TITLE="⚠️ 갱신 로그 없음 — 지난 24시간 동안 실행되지 않았다"
  COLOR=15745106
  echo "지난 24시간 동안 ${UNIT} 실행 기록이 없다" > "$LOG_FILE"
elif [ "$RESULT" = "success" ] && [ "$EXIT_CODE" = "0" ]; then
  TITLE="🗒️ 갱신 로그 (정상 종료)"
  COLOR=1423725
else
  TITLE="⚠️ 갱신 로그 (Result=${RESULT:-?}, exit=${EXIT_CODE:-?})"
  COLOR=15745106
fi

SUMMARY=$(printf '마지막 실행: %s\n종료 상태: %s (exit %s)\n로그 %s줄' \
  "${LAST_RUN:-없음}" "${RESULT:-?}" "${EXIT_CODE:-?}" "$LINES")

PAYLOAD=$(python3 - "$TITLE" "$SUMMARY" "$COLOR" <<'PY'
import json, sys
title, summary, color = sys.argv[1], sys.argv[2], int(sys.argv[3])
print(json.dumps({
    "embeds": [{
        "title": title,
        "description": summary,
        "color": color,
        "url": "https://ssan-oil.vercel.app",
    }]
}, ensure_ascii=False))
PY
)

HTTP=$(curl -s -o /dev/null -w '%{http_code}' \
  -F "payload_json=$PAYLOAD" \
  -F "files[0]=@${LOG_FILE};filename=oil-refresh.log;type=text/plain" \
  "$DISCORD_WEBHOOK")

echo "디스코드 응답: HTTP $HTTP (로그 ${LINES}줄)"
[ "$HTTP" = "200" ] || [ "$HTTP" = "204" ]
