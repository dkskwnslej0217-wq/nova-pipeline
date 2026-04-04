# HTML 상태맵 — 파일 재탐색 0회 목표

> 마지막 갱신: 2026-04-02
> 파일 수정 후 이 파일 반드시 업데이트할 것

## 공통 패턴 (모든 페이지 동일)
- 폰트: Orbitron (Google Fonts)
- 배경: #000005 ~ #000008
- 강조색: #7c3aed, #8b5cf6, #c4b5fd
- 바텀 네비 높이: 60px (모든 페이지 적용됨)
- body padding-bottom: 80px (바텀 네비 여백)
- 바텀 네비 구조: ✦UNIVERSE / ◎CHAT / ⬡PROJECT / ◈BUDGET

## index.html (메인 우주 3D)
- Three.js + OrbitControls 3D 별 우주
- 폰트 기준:
  - 플랫폼레벨 텍스트: clamp(.55rem,.6vw,.65rem) — 수정완료 (이전 .28rem)
  - 힌트 텍스트: clamp(.62rem,.65vw,.72rem), opacity .45 — 수정완료 (이전 .12)
  - 유저 별 라벨(name): clamp(.75rem,.9vw,.95rem)
  - 유저 별 라벨(tag): clamp(.6rem,.65vw,.72rem)
  - 검색창: .8rem
- search-wrap: bottom:80px (이전 55px, 바텀 네비 겹침 수정)
- fb-btn: bottom:80px, right:24px (이전 24px, 바텀 네비 겹침 수정)
- LOGIN 버튼: 그라디언트 배경 linear-gradient(#5b21b6,#7c3aed), 강조됨
- localStorage: nova_user (로그인 상태)
- 바텀 네비 active: UNIVERSE

## output/chat/index.html (AI 채팅 워크스페이스)
- overflow:hidden (의도적 — 전체화면 채팅 UI)
- 헤더 back-btn: 제거됨 (이전 ← UNIVERSE 링크 있었음)
- msg-bubble: .95rem
- input: .9rem
- plan-badge: .7rem
- limit-bar: .75rem
- upgrade-bar 버튼: .85rem
- input-area padding-bottom: calc(.8rem + 60px) — 바텀 네비 여백
- 바텀 네비 active: CHAT
- localStorage: nova_user 읽어 user_id, star_color 사용

## output/project/index.html (프로젝트 + 퀘스트)
- 로그인 체크: if (!me) location.href='/login.html' ← 이미 있음
- 헤더 nav-link: 제거됨 (이전 ← UNIVERSE, CHAT 링크 있었음)
- quest-grid: repeat(auto-fill,minmax(140px,1fr)) — 수정완료 (이전 1fr 1fr)
- star-toast: bottom:4.5rem (72px — 바텀 네비 위)
- project-card: .68rem title, .78rem desc
- quest-card: .78rem title, .68rem desc
- cluster: .88rem label, .78rem desc
- 바텀 네비 active: PROJECT

## output/budget/index.html (투명 예산)
- back 링크: 제거됨 (이전 ← NOVA UNIVERSE 링크 있었음)
- 에러 상태: 재시도 버튼 추가됨
- card-title: .78rem
- card-value: clamp(1.4rem,3vw,2rem)
- card-desc: .75rem
- plan-label: .75rem
- alloc-label: .8rem
- 바텀 네비 active: BUDGET

## login.html (로그인/회원가입)
- overflow:hidden 제거됨 → 모바일 landscape 스크롤 가능
- min-height:100%, padding-bottom:60px
- tab: .78rem (이전 .48rem)
- field label: .72rem (이전 .44rem)
- submit-btn: .85rem (이전 .5rem)
- msg: .78rem (이전 .46rem)
- back link: .72rem (이전 .42rem)
- 바텀 네비 있음 (active 없음 — 로그인 페이지)

## output/universe/index.html (별 우주 뷰어)
- index.html과 유사한 Three.js 구조
- 바텀 네비 active: UNIVERSE

## 아직 미해결 (다음 세션 할 것)
- 토스페이먼츠 결제 자동화 미완료
- 클러스터 집계 실집계 개선
- Make.com 업로드 자동화 시나리오 2 미구현
