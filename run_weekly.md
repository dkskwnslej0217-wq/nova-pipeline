# run_weekly — 월요일만 실행

## 실행 순서
0. brain/시스템점검.md 체크리스트 실행
   → 이상 있으면 즉시 보고 후 수정
1. brain/AI모니터.md → 새 무료 API 탐색
2. brain/트렌드예보.md → 다음 주 트렌드 예측
3. brain/예측엔진.md → 다음 주 주제 5개 생성
4. brain/캘린더.md → 일주일치 캘린더 생성
5. memory/캘린더.md 저장
6. brain/정책모니터.md 실행
   → 정책 변경 감지 → 해당 파일 자동 수정
   → memory/정책변경로그.md 저장
7. brain/Claude모니터.md 실행
   → 정책 변경 감지 → 영향 파악 → 자동 대응
8. brain/성능모니터.md 실행 → memory/성능리포트.md 저장
9. Supabase 전체 데이터 export → output/backup/ 저장
10. brain/피드백루프.md 실행 → memory/피드백.md 저장
11. brain/성장전략.md 실행 → memory/성장전략.md 저장
12. 완료 보고
13. brain/리포트생성.md 실행
    → 주간 리포트 생성
    → output/리포트/주간_[날짜].md 저장
14. brain/디자인트렌드.md 실행
    → 최신 디자인 트렌드 수집
    → memory/디자인트렌드.md 저장
    → brain/웹자동업데이트.md 실행
    → 변경사항 있으면 자동 반영
    → memory/웹업데이트로그.md 저장
16. brain/모듈트래커.md 실행
    → 신규 모듈 탐색
    → 있으면 junho에게 추가 여부 확인
    → memory/모듈트래커.md 저장
17. brain/사용자학습.md 실행
    → 전체 유저 패턴 분석
    → memory/사용자패턴.md 저장
    → 업그레이드 필요한 것 junho에게 보고
18. brain/법적준수.md 읽고
    각 플랫폼 정책 변경 자동 검색
    변경 감지 시 즉시 보고
19. brain/전문가모듈.md 실행
    → 매출/유저 현황 체크
    → 경고 조건 해당 시 junho에게 즉시 보고
    → 해결방안 함께 제시
20. brain/파일맵.md → 전체 감사 실행 (감사관 기능 통합됨)
    → memory/감사로그.md 저장
    → junho에게 주간 감사 보고서 제출

## 실행 방법
Claude Code에서: run_weekly.md 실행해줘
