# CLAUDE.md — nova-pipeline

## 절대 금지
- .env 읽기 / API 키 출력 금지
- 파일 삭제·교체 금지 → Read 먼저 → merge
- 비용 API 추가 금지 (무료만: Groq·Gemini·Pollinations)
- git push --force (main 브랜치)
- 설명 없이 바로 코드 작성 금지 → junho 확인 후 시작

## 스택
- GitHub Actions / Supabase / Anthropic API (Claude Agent SDK) / Groq / Gemini Flash
- GitHub: dkskwnslej0217-wq/nova-pipeline

## 파이프라인 구조

### 전체 자동화 흐름 (GitHub Actions만 사용, Make.com 없음)
```
22:00 UTC / 07:00 KST  crawlee-agent (별도 레포)
  └─ PH(RSS) / Reddit(RSS) / HN(API) 수집 → Supabase trend_sources

22:30 UTC / 07:30 KST  research-agent (별도 레포)
  └─ TOP1 선정 + 분석 → Supabase research_results

23:00 UTC / 08:00 KST  nova-pipeline agent-pipeline.yml
  └─ agent/run-agents.js → 클라이언트별 병렬 에이전트 (Claude Agent SDK)
  └─ agent/kmong-agent.js → 크몽 자동화
  └─ GitHub API repository_dispatch → create-video 트리거

     create-video.yml (repository_dispatch 수신)
  └─ scripts/generate_video.js
  └─ FFmpeg + edge-tts + Remotion → 영상 생성
  └─ Instagram / Facebook / YouTube 발행
  └─ Telegram 완료 알림
```

### GitHub Actions 워크플로우 4개
| 파일 | 트리거 | 용도 |
|------|--------|------|
| agent-pipeline.yml | 매일 23:00 UTC (08:00 KST) | 메인 에이전트 실행 |
| create-video.yml | repository_dispatch / schedule | 영상 생성 + 발행 |
| retry-youtube.yml | schedule | YouTube 업로드 재시도 |
| yt-token-check.yml | schedule | YouTube 토큰 만료 체크 |

### Vercel 프로젝트
- `nova-pipeline-two` — 실제 운영 중 (nova-pipeline-two.vercel.app)
- `nova-pipeline` — 구버전

### crawlee-agent 연결 방식
- **직접 trigger 없음** — Supabase trend_sources 테이블 공유
- crawlee-agent가 저장 → nova-pipeline이 1시간 뒤 읽기
- create-video는 agent/run-agents.js가 GitHub API로 repository_dispatch 트리거

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

## Brain 참조 규칙 (자동)
junho 말에 따라 자동으로 해당 파일 읽기:

| 상황 | 읽을 파일 |
|------|---------|
| 콘텐츠 품질, 채점, 점수 | brain/품질채점.md |
| 패턴, 잘 되는 것, 공식 | brain/패턴.md + brain/바이럴공식.md |
| 실패, 오류, 안 되는 것 | brain/실패패턴.md + brain/에러복구.md |
| 인스타 관련 | brain/플랫폼_instagram.md |
| 페북 관련 | brain/플랫폼_facebook.md |
| 유튜브 관련 | brain/플랫폼_youtube.md |
| 성장, 팔로워, 방향 | brain/성장전략.md |
| 학습, 피드백, 개선 | brain/피드백루프.md |

→ 코드 수정 전 반드시 해당 brain 파일 먼저 확인

## 작업 방식
- 큰 작업은 반드시 단계 나눠서 하나씩 진행 (토큰 절약)
- 작업 시작 전 단계 먼저 보여주고 junho 확인 후 진행

## 세션 시작
- L1_state.md 자동 주입됨 (훅)
- "읽어/봐줘/확인해" → 요약만, 코드 수정 금지

## 저장
1. 저장 내용 먼저 보여주기
2. junho 확인 후 저장
