# NOVA 실행 코어 — 매 세션 시작 시 실행

## 1단계 — 항상 로드 (필수)
1. memory/오늘요약.md → 날짜 확인 (불일치 시 즉시 중단)
2. brain/파일맵.md → 감사관 체크 → 이상 시 자동 수정 or 중단
3. brain/인증.md → MASTER_PASSWORD 확인 → 실패 시 즉시 중단
4. brain/보안.md → 입력값 보안 체크
5. Supabase keep-alive: `SELECT count(*) FROM memory LIMIT 1;`
6. Supabase users 테이블 → 플랜별 한도 확인 → 초과 시 중단
   - 유저 10명↑ → 폴백 시스템 도입 검토 알림
   - 유저 50명↑ → Claude API 연동 강력 권장 알림

## 2단계 — 작업별 조건부 로드 (최대 5개)

### 콘텐츠 생성 요청 시
brain/판단.md → brain/개인화.md → brain/품질채점.md → brain/감정분석.md
→ skills/[해당 플랫폼].md

콘텐츠 생성 파이프라인:
1. Supabase 최근 5개 + memory/캘린더.md → 오늘 주제 확인
2. brain/판단.md → 주제 확정 (중복 체크 + 카테고리 분류)
3. brain/개인화.md → 성공 패턴 확인
4. brain/바이럴공식.md → 공식 1개 선택
5. 멀티모델 파이프라인:
   - Gemini Flash → 트렌드 키워드 추출
   - Groq → 훅 초안 3개 생성
   - Claude → 최종 완성 + 브랜드 톤 적용
6. skills/출력포맷.md → 플랫폼별 포맷 적용
7. brain/감정분석.md → 감정 흐름 체크
8. brain/품질채점.md → 100점 채점 → 70점↓ 재생성
9. score_total ≥ 7점 → output/staging/ 저장 / 미만 → output/ 저장만

### 트렌드 필요 시
memory/트렌드_[오늘날짜].md → brain/트렌드예보.md

### 에러 발생 시
brain/에러자동복구.md

### 보안 이슈 감지 시
brain/이상탐지.md → brain/법적준수.md → brain/침해대응.md

### 성과 분석 요청 시
brain/성능모니터.md → brain/AB테스트.md → brain/경쟁자분석.md

### 시리즈 요청 시
brain/시리즈기획.md → memory/시리즈목록.md

### 멀티플랫폼 요청 시
brain/멀티플랫폼최적화.md

## 3단계 — 검증 + 저장
1. skills/자기검증.md → 범죄이용방지 체크
2. Supabase content + performance 테이블 저장
3. 에러 발생 → brain/보안로그.md 기록
4. brain/백업.md → 오늘 변경사항 백업

## 주기적 자동 실행
- 5회마다: brain/자기학습.md
- 10회마다: brain/댓글분석.md + brain/성능모니터.md + brain/피드백루프.md
- 매주 월요일: brain/자기학습.md + brain/트렌드예보.md + brain/보안점검.md
- 매월 1일: brain/수익추적.md + brain/버전관리.md

## 완료
- 완료 보고 3줄 이내
- memory/오늘요약.md 덮어쓰기:

=== 세션 컨텍스트 ===
날짜: [오늘날짜]
마지막 작업: [한 줄]
다음 할 것: [한 줄]
시스템 상태: [정상/주의/오류]
현재 단계: [완료 단계]
===================
