# CLAUDE.md — nova-pipeline

## 절대 금지
- .env 읽기 / API 키 출력 금지
- 파일 삭제·교체 금지 → Read 먼저 → merge
- 비용 API 추가 금지 (무료만: Groq·Gemini·Pollinations)
- git push --force (main 브랜치)
- 설명 없이 바로 코드 작성 금지 → junho 확인 후 시작

## 스택
- Vercel Node.js / Supabase / Make.com / Groq (무료) / Gemini Flash (폴백)
- 배포: nova-pipeline-two.vercel.app (git push → 자동 빌드)
- GitHub: dkskwnslej0217-wq/nova-pipeline
- Make.com: 매일 08:00 + 12:00 KST → /api/run-pipeline

## 파이프라인 구조
```
Make.com 트리거
  → /api/run-pipeline  (메인: 트렌드 수집 → 콘텐츠 생성 → 발행)
  → /api/run-client    (클라이언트별 실행)
  → /api/clients       (CRUD)
  → /api/weekly-report (매주 월요일)
  → /api/post-instagram / post-facebook (발행)
```

## Groq 사용 규칙
- max_tokens: 600 이하
- 1회 실행 최대 Groq 호출 2회
- 분리자 패턴: ===IG=== / ===FB=== / ===YT===

## 자동 라우팅 (junho가 용어 몰라도 됨)
junho 말 → 내가 자동으로 서브에이전트 사용:

| junho가 하는 말 | 자동 실행 |
|---|---|
| "오류", "에러", "안돼", "왜 안", "터졌", "실패" | pipeline-debugger 자동 사용 |
| "글", "콘텐츠", "퀄리티", "프롬프트", "더 잘" | content-optimizer 자동 사용 |
| "클라이언트", "고객", "토큰", "등록", "추가해" | client-manager 자동 사용 |

→ junho는 그냥 자연스럽게 말하면 됨. 에이전트 이름 외울 필요 없음.

## 세션 시작
- L1_state.md 자동 주입됨 (훅)
- "읽어/봐줘/확인해" → 요약만, 코드 수정 금지

## 저장
1. 저장 내용 먼저 보여주기
2. junho 확인 후 저장
