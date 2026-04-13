#!/usr/bin/env python3
# 멀티모델 파이프라인 테스트
import os, json, urllib.request, sys

GROQ_KEY = os.environ.get('GROQ_API_KEY', '')

def groq(prompt, max_tokens=300):
    data = {
        'model': 'llama-3.3-70b-versatile',
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': max_tokens
    }
    req = urllib.request.Request(
        'https://api.groq.com/openai/v1/chat/completions',
        data=json.dumps(data, ensure_ascii=False).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {GROQ_KEY}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        result = json.loads(res.read().decode('utf-8'))
        return result['choices'][0]['message']['content']

print("=== 1단계: 키워드 추출 (Groq) ===")
keywords = groq("2026년 한국 SNS에서 핫한 AI 자동화 키워드만 5개. 반드시 단어만. 예시: AI글쓰기, 자동화수익, 챗봇창업, 무인운영, 콘텐츠AI")
print(keywords)

print("\n=== 2단계: 훅 초안 3개 (Groq) ===")
hooks = groq(f"주제: {keywords}\n\n스레드 첫 줄 훅 3개 만들어줘. 각 40자 이내. 번호 붙여서. 한국어만.")
print(hooks)

print("\n=== 3단계: 최종 콘텐츠 완성 (Claude가 할 부분 — 시뮬레이션) ===")
final = groq(f"""
훅 후보:
{hooks}

위 3개 중 가장 강한 훅 1개 골라서
스레드용 콘텐츠 완성해줘. 형식:
- 훅 (1줄)
- 본문 (3~5줄, 각 줄 짧게)
- 마무리 (행동 유도 1줄)
""", max_tokens=500)
print(final)

print("\n✅ 파이프라인 테스트 완료")
