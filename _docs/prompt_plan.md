# 구현 계획: Remotion → Canvas 슬라이드 영상 (v4)

> 확정일: 2026-04-10
> 상태: ✅ Phase 1 완료

## 요약
ffmpeg + PNG 캐릭터 방식을 canvas 슬라이드 스타일로 전면 교체.
5개 슬라이드를 Node.js canvas로 렌더링 → ffmpeg xfade로 연결 → 음성(TTS) 합성.

## 슬라이드 구성
| 슬라이드 | 내용 | 타이밍 |
|---|---|---|
| 1. 타이틀 | NOVA 브랜드 + 툴 이름 크게 | 0~20% |
| 2. 핵심 기능 | 3가지 포인트 순차 표시 | 20~40% |
| 3. vs 비교 | 기존 툴 vs 새 툴 (좌/우 패널) | 40~60% |
| 4. 이렇게 써요 | STEP 1/2/3 원형 번호 | 60~80% |
| 5. 조합 팁 + CTA | 초록 배너 + 팔로우 버튼 | 80~100% |

## 완료된 변경
- `package.json`: canvas → dependencies 이동
- `.github/workflows/create-video.yml`: libcairo2-dev 등 canvas 빌드 의존성 추가
- `scripts/generate_video.js`: v4 전면 교체 (슬라이드 방식)

## Phase 2 (추후)
- Puppeteer로 툴 사이트 스크린샷 → 슬라이드 3에 실제 앱 이미지 삽입
- SCRIPT_TEXT 구조화 (run-pipeline.js에서 bullets/steps 별도 전달)
