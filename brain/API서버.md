# junho API 서버 — 재판매 구조

## 목표
지금 만든 시스템을 SaaS로 포장해서
사람들이 돈 내고 쓰는 구조 만들기

## 작동 구조
사용자 접속
↓
junho 웹사이트에서 로그인
↓
Supabase에서 플랜 확인
↓
플랜별 한도 체크
↓
Anthropic API 호출 (junho API 키로)
↓
결과 사용자한테 전달
↓
사용량 Supabase에 기록
↓
월말에 결제 청구

## API 엔드포인트
POST /api/generate → 콘텐츠 자동 생성
POST /api/trend → 트렌드 수집
POST /api/analyze → 성과 분석
GET /api/status → 사용량 확인

## 플랜별 한도
무료: 하루 5회
스타터 (월 1만원): 하루 20회
프로 (월 3만원): 무제한
팀 (월 10만원): 멀티유저 5명

## 비용 관리
Claude Haiku 사용 (저렴)
사용자당 월 비용 약 0.3달러
100명 기준 월 30달러 비용
100명 × 1만원 = 100만원 수입
순수익 약 97만원

## 기술 스택
- Next.js or React (프론트엔드)
- Vercel (배포, 무료)
- Supabase (DB + 인증)
- Anthropic API (Claude 호출)
- 토스페이먼츠 or 페이플 (결제)

## 보안
- 사용자별 API 키 발급
- Rate Limiting
- JWT 인증
- junho API 키 절대 노출 금지
