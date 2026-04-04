# L1_state — NOVA 현재 상태
last_updated: 2026-04-04

## 완성
- NOVA SaaS 기본 구조 (Vercel Edge + Supabase + Make.com)
- AI 채팅 (Groq→Claude 폴백, 플랜별 한도)
- TTS (GoogleTTS→ElevenLabs 폴백)
- 프로젝트/퀘스트 CRUD
- 로그인/회원가입 (password_hash)
- 세션 토큰 인증 시스템
- GitHub Actions 영상 파이프라인 (TTS→Pexels→FFmpeg→YouTube)
- Make.com → run-pipeline → GitHub Actions → YouTube 자동 트리거 연결
- Groq 한국어 강제 (system prompt)
- 비밀번호 찾기 (Resend 이메일, api/forgot.js)
- Telegram GitHub Secrets 추가 (영상 업로드 알림 정상화)
- 채팅 x-session-token 헤더 수정 (로그인 유저 401 버그 수정)
- stats POST 토큰 헤더 수정
- TELEGRAM_BOT_TOKEN 폴백 (run-pipeline, monthly-reset)
- generate_video.js 디버그 로그 제거

## 진행 중
- 없음

## 마지막으로 한 것
- 챗 튕김 수정: replaceState로 location.href 리다이렉트 제거 (output/chat/index.html)
- 업그레이드 페이지 완성 (output/upgrade/index.html + success.html + api/payment.js)
- 관리자 뷰 완성 (api/admin.js + output/admin/index.html) — /admin 접속 + MASTER_PASSWORD
- api/alert.js 디버그 코드 제거
- .gitignore에 get_token.js/cjs 추가
- 배포 완료 (main 브랜치 push)

## 다음 작업 (새 세션에서 바로 실행)
0. **Supabase MCP 연결 확인** — Claude Code 트레이까지 완전 종료 후 재시작 → ListMcpResourcesTool로 supabase 서버 뜨는지 확인 (settings.json 토큰 이미 세팅됨)
1. 토스 실 키 연결 — Vercel 환경변수에 TOSS_SECRET_KEY 추가 + Supabase users 테이블에 subscription_end 컬럼 추가
2. 캐시 시스템 확인 (cache 테이블 — api/chat.js에서 실제로 쓰는지 확인)
3. 클러스터 실집계 (projects.primary_tag 기반)

## 미해결 (우선순위)
1. 토스페이먼츠 실 키 연결 (TOSS_SECRET_KEY + subscription_end 컬럼)
2. 캐시 시스템
3. 클러스터 실집계
4. Make.com 시나리오2 (TTS→영상→YouTube)
5. 이탈 감지 고도화
