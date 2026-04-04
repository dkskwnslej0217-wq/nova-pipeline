# Claude 규정 모니터링

## 목표
Claude API 정책/규정 변경 감지해서
시스템이 흔들리지 않게 미리 대응

## 모니터링 방법
Tavily로 매주 검색:
- "Anthropic Claude policy update 2026"
- "Claude API terms of service change"
- "Claude usage policy update"
- "Anthropic model update release"

## 변경 감지 시 대응

### 마이너 업데이트
- 메모로 기록
- 다음 실행 시 반영

### 기능 변경
- 영향받는 brain/ skills/ 파일 자동 수정
- 테스트 실행 1회

### 규정 강화 (기존에 되던 게 안 될 때)
1. 즉시 해당 기능 실행 중단
2. 대안 탐색
3. brain/보안.md + brain/법적준수.md 업데이트

## 흔들림 최소화 전략

### 1. Claude 의존도 분산
- 핵심 로직은 brain/ 파일에 직접 저장
- Claude한테 판단 맡기지 말고 파일에 명시
- "이렇게 해줘" 대신 "이 파일 읽고 이 순서대로 해줘"

### 2. 백업 플랜
- 중요 brain/ 파일은 주기적으로 백업
- output/ 파일 외부 저장소에 백업
- Supabase 데이터 주기적 export

### 3. 테스트 루틴
- 매주 월요일 핵심 기능 테스트 실행
- 이상 감지 시 즉시 보고

## 실행 주기
run_weekly.md에 포함
결과 memory/Claude변경로그.md에 저장
