# 파이프라인 실행 순서
1. claude -p claude_research.md "조사해줘: {주제}"
2. claude -p claude_writer.md "작성해줘"
3. claude -p claude_editor.md "검수해줘"
4. final.md 내용 output/ 폴더에 저장
