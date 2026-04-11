# Make.com 시나리오

## 핵심
Claude → /api/log 1회 → Make.com → Supabase + 구글시트 동시저장

## 시나리오 구조 (1개 웹훅, type으로 분기)
| type | Supabase | Sheets | 추가액션 |
|------|----------|--------|---------|
| content | contents 테이블 insert | 콘텐츠기록 | - |
| subscriber | subscribers upsert(email기준) | 구독자목록 | - |
| payment | users.plan_type update | 결제기록 | Gmail→junho알림 |
| error | - | 에러로그 | Telegram→junho |

## 데이터 구조 (공통필드: type, timestamp)
- content: platform, title, body, score, user_id
- subscriber: email, name, plan, source
- payment: email, plan, amount, method
- error: source, message, severity

## 구글시트 탭
콘텐츠기록(날짜/플랫폼/제목/점수/상태) / 구독자목록(날짜/이메일/이름/플랜/유입) / 결제기록(날짜/이메일/플랜/금액/수단) / 에러로그(날짜/소스/메시지/심각도)

## /api/log 호출 예시
```
POST /api/log {"type":"content","platform":"threads","title":"...","body":"...","score":8}
POST /api/log {"type":"error","source":"api/chat","message":"...","severity":"high"}
```

## Make.com 설정순서
1. New scenario → Webhooks > Custom webhook → URL복사
2. .env MAKE_SHEETS_WEBHOOK 업데이트
3. Router: type값으로 4개 경로 분기
4. 각 경로에 Supabase/Sheets/Telegram 모듈 연결
5. 시나리오 ON

비용: 이벤트당 3~4ops (무료1000ops/월, 유저200명→$9)
