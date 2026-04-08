---
paths:
  - "**/*"
---

# 커밋 & 배포 규칙

## 배포 방식
git push → GitHub → Vercel 자동 빌드 (수동 배포 불필요)

## 커밋 전 체크
- [ ] node --check api/*.js (문법 오류 없음)
- [ ] .env 파일이 커밋에 포함되지 않음
- [ ] 새 환경변수는 junho에게 Vercel 추가 안내

## 커밋 메시지 형식
feat: 새 기능
fix: 버그 수정
refactor: 리팩토링
chore: 설정 변경

## 절대 하면 안 되는 것
- git push --force (main 브랜치)
- .env 커밋
- node_modules 커밋
- API 키 하드코딩
