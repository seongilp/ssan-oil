# 갱신 크론

주유소 좌표와 가격을 매일 새벽에 채우고, 결과를 디스코드로 알린다.
웹 앱은 이 결과(Neon Postgres)를 읽기만 하므로 **요청 시점 외부 API 호출이 0회**다.

## 구성

| 유닛 | 시각 (KST) | 하는 일 |
|---|---|---|
| `oil-refresh.timer` | 04:10 | 갱신 실행 → 결과 요약 알림 |
| `oil-log.timer` | 08:00 | 지난 24시간 로그를 파일로 첨부해 전송 |

로그 전송을 별도 타이머로 둔 이유는, **타이머가 아예 돌지 않은 경우**를 잡기 위해서다.
실행 직후 훅은 실행이 없으면 아무것도 보내지 못한다.

## 갱신 순서 (`refresh.sh`)

```
1  조준 좌표 보완            Nominatim (무료, 오피넷 예산과 무관)
2  격자 재계산 (hints)       호출 없음
3  좌표 탐색 스윕            aroundAll — 호출당 여러 곳
4  미확보 좌표 핀포인트 조회  detailById — 호출당 1곳, 하루 600회 상한
5  격자 커버 갱신            호출 없음
6  휘발유 가격 갱신
7  경유 가격 갱신
8  결과 점검 + 알림
```

한 단계가 실패해도 나머지는 계속 돌고, 실패한 단계는 **즉시** 디스코드로 알린다.
최종 요약은 성공/실패와 무관하게 항상 전송된다.

## 호출 예산

오피넷 무료 API는 키당 하루 1,500회다. 키가 두 개라 합쳐서 약 2,900회를 쓴다.
키별 사용량은 `api_usage` 테이블에 남기므로, 스크립트를 여러 번 실행해도
예산이 되살아나지 않는다.

**오피넷은 한도를 넘겨도 에러 대신 빈 배열을 준다.** 그래서 빈 응답을 곧바로
'주유소 없음'으로 확정하지 않는다. 확실히 주유소가 많은 지점을 찔러 보고
거기서도 비면 키 소진으로 판단해 중단한다.

## 서버 설치

```bash
# 코드 배포
rsync -az --exclude node_modules --exclude .next --exclude .git --exclude .env.local \
  ./ ebs:/opt/oil-price/
ssh ebs 'cd /opt/oil-price && pnpm install --frozen-lockfile'

# 비밀키 (root 소유, 600)
# DATABASE_URL, OPINET, OIL, OSM_CONTACT, DISCORD_WEBHOOK
ssh ebs 'sudo vi /etc/oil-price.env && sudo chmod 600 /etc/oil-price.env'

# 유닛 등록
ssh ebs 'sudo cp /opt/oil-price/ops/systemd/*.service /opt/oil-price/ops/systemd/*.timer \
  /etc/systemd/system/ && sudo systemctl daemon-reload \
  && sudo systemctl enable --now oil-refresh.timer oil-log.timer'
```

## 확인

```bash
ssh ebs 'systemctl list-timers "oil-*"'                    # 다음 실행 시각
ssh ebs 'journalctl -u oil-refresh -n 50 --no-pager'        # 실행 로그
ssh ebs 'sudo systemctl start oil-refresh.service'          # 즉시 한 번 실행
```

## 최초 데이터 적재

오피넷에서 CSV 두 개(`사업자_기본정보`, `현재_판매가격`)를 내려받아 적재한 뒤,
격자를 만들고 스윕을 돌린다.

```bash
pnpm db:migrate                # Neon 스키마 적용
pnpm import:csv ~/Downloads    # 주유소 마스터 + 가격
pnpm hint                      # 행정동 지오코딩으로 조준 좌표
pnpm build:grid --hints        # 조준 좌표를 덮는 스윕 지점
pnpm refresh --mode hints      # 좌표 수집
pnpm fill-coords               # 남은 곳 핀포인트 조회
```
