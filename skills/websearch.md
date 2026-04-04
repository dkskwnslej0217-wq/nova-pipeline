# 웹서치 스킬

## 언제 쓰나
- 오늘 트렌드 조사할 때
- 최신 뉴스/데이터 필요할 때
- 콘텐츠 주제 리서치할 때

## 실행
curl -X POST https://api.tavily.com/search \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "'"$TAVILY_API_KEY"'",
    "query": "검색어",
    "max_results": 5,
    "search_depth": "basic"
  }'

## 결과 처리 규칙
- 상위 3개 결과만 사용
- 핵심 내용 3줄 요약
- 출처 URL 기록
- brain/트렌드.md에 저장
