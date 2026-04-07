# YouTube 플랫폼 규정

## 현재 상태
- GitHub Actions 워크플로우 완성 (테스트 진행 중)
- run-pipeline.js에서 repository_dispatch로 트리거

## 콘텐츠 타입
- 영상 (Shorts 타겟: 세로형 60초 이내)
- 현재: 정지이미지 + TTS 음성 합성 영상

## 영상 스펙
- 해상도: 1920x1080 (현재 코드)
- 오디오: WAV → AAC 변환
- 포맷: MP4 (H.264)
- 카테고리: 28 (과학기술)

## 글자 수 제한
- 제목: 최대 100자
- 설명: 최대 5,000자 (현재 500자 사용)
- 태그: 최대 500자

## 하루 업로드 한도
- 일반 계정: 하루 100개 (현재 1개)
- 24시간 내 동일 영상 재업로드 금지

## 차단 방지 규칙
- 저작권 음원 사용 금지 (TTS 사용 중 — 안전)
- 오해의 소지 있는 제목/설명 금지
- 스팸 링크 설명란 금지
- 커뮤니티 가이드 위반 콘텐츠 금지

## API 정보
- googleapis YouTube Data API v3
- 환경변수 (GitHub Secrets):
  - YOUTUBE_CLIENT_ID
  - YOUTUBE_CLIENT_SECRET
  - YOUTUBE_REFRESH_TOKEN
  - GOOGLE_TTS_KEY
  - PEXELS_API_KEY
  - TELEGRAM_BOT_TOKEN
  - TELEGRAM_CHAT_ID
- 공개 설정: public (현재)

## 워크플로우
- 트리거: repository_dispatch (create-video 이벤트)
- 수동 실행: workflow_dispatch 가능
- 파일: .github/workflows/create-video.yml
