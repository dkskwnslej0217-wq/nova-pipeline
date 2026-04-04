#!/bin/bash
# NOVA 실시간 상태 조회 — hook에서 자동 실행

set -a
source "$(dirname "$0")/../.env" 2>/dev/null
set +a

if [ -z "$SUPABASE_URL" ]; then
  echo "=== NOVA 상태: .env 로드 실패 ==="
  exit 0
fi

echo "=== NOVA 실시간 상태 ($(date '+%m/%d %H:%M')) ==="

# 유저 통계
USER_DATA=$(curl -s "${SUPABASE_URL}/rest/v1/users?select=plan_type" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" 2>/dev/null)

node -e "
const d = JSON.parse(process.argv[1]);
const total = d.length;
const free = d.filter(u => !u.plan_type || u.plan_type === 'free').length;
const paid = total - free;
console.log('유저: 총 ' + total + '명 (무료 ' + free + ' / 유료 ' + paid + ')');
" "$USER_DATA" 2>/dev/null || echo "유저: 조회 실패"

# 오늘 AI 사용량
TODAY=$(date -u +%Y-%m-%d)
AI_DATA=$(curl -s "${SUPABASE_URL}/rest/v1/ai_logs?select=id&created_at=gte.${TODAY}T00:00:00Z" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" 2>/dev/null)

node -e "
const d = JSON.parse(process.argv[1]);
console.log('오늘 AI 호출: ' + d.length + '회');
" "$AI_DATA" 2>/dev/null || echo "오늘 AI 호출: 조회 실패"

# 플랫폼 레벨
PLATFORM=$(curl -s "${SUPABASE_URL}/rest/v1/platform_config?id=eq.1&select=level,active_model" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" 2>/dev/null)

node -e "
const d = JSON.parse(process.argv[1]);
if(d[0]) console.log('플랫폼: Lv' + d[0].level + ' / 모델: ' + d[0].active_model);
else console.log('플랫폼: 데이터 없음');
" "$PLATFORM" 2>/dev/null || echo "플랫폼: 조회 실패"

echo "========================="
