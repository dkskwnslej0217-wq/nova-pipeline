# Threads 플랫폼 규정

## 현재 상태
- ⚠️ 차단 중 (error_subcode: 2207051)
- run-pipeline.js 에서 주석처리됨 — 자동 발행 안 함
- 이의신청 필요: Instagram 앱 → 설정 → 계정 → "실수라고 생각합니다"

## 콘텐츠 타입
- 텍스트 중심
- 이미지/링크 첨부 가능

## 글자 수 제한
- 최대 500자 (현재 코드 반영됨)

## 하루 발행 한도
- 명시적 한도 없으나 과도한 자동화 감지 시 차단
- 권장: 하루 1~3회
- 현재 파이프라인: 차단 해제 후 하루 1회

## 차단 방지 규칙 (중요 — 이미 차단 경험 있음)
- 자동화 감지되면 바로 차단
- 짧은 시간 내 반복 게시 금지
- 스팸성 문구/해시태그 남용 금지
- 발행 간격: 최소 1시간 이상
- 계정 활동(좋아요/댓글)과 병행할 것

## API 정보
- 엔드포인트: graph.threads.net/v1.0
- 환경변수: THREADS_ACCESS_TOKEN, THREADS_USER_ID
- 2단계: 컨테이너 생성 → threads_publish

## 차단 해제 후 재개 절차
1. memory/L1_state.md 업데이트
2. run-pipeline.js Threads 주석 해제
3. push → Redeploy
