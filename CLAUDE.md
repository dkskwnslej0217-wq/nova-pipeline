# CLAUDE.md — nova-pipeline

## 정체
이주노(junho)의 콘텐츠 자동화 엔진.
목적: YouTube·Instagram·Threads·Facebook·Twitter·LinkedIn·TikTok·블로그에 AI 콘텐츠를 자동 생성·발행.
NOVA SaaS를 세상에 알리는 홍보 파이프라인.

## 절대 금지
- 기존 파일 삭제·교체 금지 → read → merge → 중복제거
- 비용 API 추가 금지 (무료만)
- .env 읽기 / API 키 출력 금지

## 스택
- Vercel Edge Functions (api/)
- Supabase (콘텐츠 저장)
- Make.com (웹훅 기반 자동화)
- 무료 AI: Groq / Gemini / Claude 폴백

## 현재 있는 API ✅
| 변수명 | 용도 |
|--------|------|
| GROQ_API_KEY | 텍스트 생성 |
| GEMINI_API_KEY | 분석·생성 |
| ANTHROPIC_API_KEY | Claude 폴백 |
| GOOGLE_TTS_KEY | 음성 생성 |
| PEXELS_API_KEY | 이미지 수집 |
| YOUTUBE_API_KEY | YouTube 트렌드 수집 |
| TELEGRAM_BOT_TOKEN | 알림 |
| TELEGRAM_CHAT_ID | 알림 채널 |
| MAKE_SHEETS_WEBHOOK | Make.com 연동 |
| PIPELINE_SECRET | 파이프라인 인증 |
| SUPABASE_URL | DB |
| SUPABASE_SERVICE_KEY | DB |

## 추가 예정 API (무료)
| 변수명 | 용도 | 상태 |
|--------|------|------|
| THREADS_ACCESS_TOKEN | Threads 자동 발행 | ⬜ 미설정 |
| INSTAGRAM_ACCESS_TOKEN | Instagram 자동 발행 | ⬜ 미설정 |
| FACEBOOK_ACCESS_TOKEN | Facebook 자동 발행 | ⬜ 미설정 |
| TWITTER_API_KEY | Twitter/X 자동 발행 | ⬜ 미설정 |
| TWITTER_API_SECRET | Twitter/X | ⬜ 미설정 |
| TWITTER_ACCESS_TOKEN | Twitter/X | ⬜ 미설정 |
| TWITTER_ACCESS_SECRET | Twitter/X | ⬜ 미설정 |
| LINKEDIN_ACCESS_TOKEN | LinkedIn 자동 발행 | ⬜ 미설정 |
| TIKTOK_ACCESS_TOKEN | TikTok 자동 발행 | ⬜ 미설정 |
| PINTEREST_ACCESS_TOKEN | Pinterest 자동 발행 | ⬜ 미설정 |
| WORDPRESS_URL | WordPress 블로그 | ⬜ 미설정 |
| WORDPRESS_USER | WordPress | ⬜ 미설정 |
| WORDPRESS_APP_PASSWORD | WordPress | ⬜ 미설정 |
| TISTORY_ACCESS_TOKEN | 티스토리 블로그 | ⬜ 미설정 |
| NAVER_CLIENT_ID | 네이버 트렌드 수집 | ⬜ 미설정 |
| NAVER_CLIENT_SECRET | 네이버 | ⬜ 미설정 |
| REDDIT_CLIENT_ID | Reddit 트렌드 수집 | ⬜ 미설정 |
| REDDIT_CLIENT_SECRET | Reddit | ⬜ 미설정 |
| DEEPL_API_KEY | 번역 (500k/월 무료) | ⬜ 미설정 |

## 파이프라인 흐름 (목표)
```
[수집]
YouTube + Reddit + Naver 트렌드
          ↓
[AI 생성] Groq/Gemini
  → 텍스트 (Threads/IG/Facebook/Twitter/LinkedIn)
  → 이미지 (Pollinations.ai — 키 없음)
  → 음성 (Google TTS)
  → 영상 (ffmpeg 합성)
          ↓
[발행]
Threads / Instagram / Facebook
Twitter(X) / LinkedIn / TikTok
Pinterest / WordPress / Tistory
YouTube Upload
          ↓
[알림] Telegram
```

## 현재 완성된 것
- YouTube 트렌드 수집 → Gemini 분석 → Groq 생성 → Supabase 저장 ✅
- Telegram 알림 ✅
- Google TTS 음성 생성 ✅
- Make.com 시나리오1 (Sheets 연동) ✅

## 미완성 (우선순위)
1. SNS 발행 API 연결 (Threads → Instagram → Facebook → Twitter 순)
2. 이미지 자동 생성 (Pollinations.ai)
3. ffmpeg 영상 합성
4. YouTube 자동 업로드
5. 블로그 자동 발행 (WordPress/Tistory)
6. 번역 후 다국어 발행 (DeepL)

## 파일 구조
```
nova-pipeline/
├── api/
│   ├── run-pipeline.js   ← 핵심: 매일 자동 실행
│   ├── tts.js            ← 음성 생성
│   ├── alert.js          ← Telegram 알림
│   ├── platform.js       ← 플랫폼 레벨 관리
│   ├── log.js            ← AI 로그
│   └── healthcheck.js    ← 상태 확인
├── scripts/
│   ├── generate_video.js ← ffmpeg 영상 합성
│   ├── analyze.js        ← 분석
│   └── nova_status.sh    ← 상태 체크
├── skills/               ← 콘텐츠 생성 스킬 (Threads/IG/YT)
├── brain/                ← 전략 문서
├── memory/               ← 기억
├── output/               ← 생성된 콘텐츠
├── CLAUDE.md
├── vercel.json
└── package.json
```

## 행동 원칙
- 실행 우선 / 짧게 보고
- 무료 API만 / 비용 발생 시 즉시 멈추고 확인
- 외부 플랫폼 제한·요금 단정 금지 → "확인해주세요"
- SNS API 연결 시 → 인증 흐름 먼저 문서화 후 진행
