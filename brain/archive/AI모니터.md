# AI 서비스 모니터링

## 목표
더 좋은 무료 AI/API가 나오면 자동으로 감지하고
비용 드는 서비스를 교체한다

## 현재 사용 중인 서비스
- Tavily API: 무료 1000회/월 (웹서치)
- Supabase: 무료 플랜 (메모리 DB)
- Claude API: 유료 (핵심 엔진)
- 영상 생성 API: 미정 (자동 탐색 중)
- 한국어 TTS API: 미정 (자동 탐색 중)

## 모니터링 주기
매주 월요일 첫 실행 시 자동 실행

## 검색 키워드
Tavily로 아래 검색:
- "free AI API 2026 best"
- "free vector database 2026"
- "free LLM API alternative 2026"
- "Tavily alternative free search API"
- "Supabase alternative free database"
- "free text to video API 2026"
- "free text to speech API Korean 2026"

## 비교 기준
- 무료 플랜 한도
- 응답 속도
- 정확도
- API 호환성 (교체 난이도)

## 자동 교체 조건
아래 조건 모두 충족 시 자동 교체 제안:
- 현재 서비스보다 무료 한도 2배 이상
- API 교체 난이도 낮음 (URL + 키만 바꾸면 됨)
- 신뢰할 수 있는 회사 서비스
- 영상 생성: 무료 크레딧 월 10개 이상
- 한국어 TTS: 무료 1000자 이상/월
- 품질: 720p 이상

## 자동 교체 프로세스
1. 교체 대상 서비스 감지
2. 새 서비스 API 문서 확인
3. skills/ 해당 파일 URL + 설명 자동 수정
4. CLAUDE.md 서비스 목록 업데이트
5. 보고: "교체 완료: [기존] → [신규] / 이유: [한 줄]"

## 절대 자동 교체 안 하는 것
- Claude API (핵심 엔진, 교체 불가)
- 교체 후 테스트 없이 바로 운영 투입
