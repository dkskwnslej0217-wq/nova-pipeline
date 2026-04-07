# L1_state
last_updated: 2026-04-07

## 내일 할 것 (순서대로)
1. Facebook 토큰 만료일 확인 → Vercel FACEBOOK_TOKEN_EXPIRES_AT 추가
   - Graph API Explorer → /debug_token?input_token=토큰&access_token=앱ID|앱시크릿
   - 나온 expires_at 값 → Vercel 환경변수 추가
2. YouTube GitHub Actions 테스트 (GitHub Secrets 확인)
3. Threads 이의신청 (Instagram 앱 → 설정 → "실수라고 생각합니다")

## 플랫폼 현황
- Threads: 차단 중 (error_subcode 2207051) — run-pipeline.js 주석처리됨
- Instagram: ✅
- Facebook: ✅ (2026-04-07 완료, 만료일 미등록)
- YouTube: 코드 완성, Actions 미테스트

## 배포
- URL: nova-pipeline-two.vercel.app
- 계정: dkskwnslej0217@gmail.com (부캐 고정)
