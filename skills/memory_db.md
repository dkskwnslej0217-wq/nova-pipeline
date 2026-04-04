# DB 메모리 스킬

## 목적
대화가 끊겨도 작업 기록을 영구 저장하고 불러옴

## 저장하기
curl -X POST "$SUPABASE_URL/rest/v1/memory" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "date": "오늘날짜",
    "topic": "주제",
    "summary": "요약",
    "result": "결과",
    "score_trend": 0,
    "score_hook": 0,
    "score_comment": 0,
    "score_total": 0,
    "user_id": "'"$USER_ID"'"
  }'

## 불러오기 (최근 5개, user_id 필터 적용)
curl "$SUPABASE_URL/rest/v1/memory?user_id=eq.$USER_ID&order=created_at.desc&limit=5" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"

## 사용 규칙
- 실행 시작 시: 최근 5개 기록 불러오기
- 실행 종료 시: 오늘 결과 저장
