---
paths:
  - "api/**/*.js"
---

# 파이프라인 안전 규칙

## 필수 확인 사항
- 모든 API 파일 수정 전 반드시 Read 먼저
- 환경변수 추가 시 Vercel에도 동일하게 추가 필요 (junho에게 안내)
- 새 npm 패키지 추가 시 비용/용량 확인

## 무료 API만 사용
허용: Groq, Gemini Flash, Pollinations, Meta Graph API, YouTube API
금지: OpenAI, ElevenLabs (유료), Replicate (유료)

## Groq 호출 규칙
- max_tokens: 600 이하
- 1회 실행당 Groq 호출 최대 2회
- RPM 한도: 30회/분 (멀티 클라이언트 시 stagger 필수)

## Instagram/Facebook 토큰 처리
- 토큰은 파라미터로 전달 (모듈 레벨 상태 금지)
- 만료 60일 → 45일 경과시 갱신 알림

## Vercel 서버리스 제약
- 최대 실행시간: 300초
- 상태 공유 불가 (요청 간)
- 파일 시스템 쓰기 불가 (/tmp 제외)
