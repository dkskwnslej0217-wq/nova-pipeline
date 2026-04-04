// NOVA 자가학습 분석 스크립트
// GitHub Actions에서 실행: node scripts/analyze.js

import { appendFileSync } from 'fs';

const SUPA = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_KEY;
const GROQ = process.env.GROQ_API_KEY;
const h    = { 'apikey': KEY, 'Authorization': `Bearer ${KEY}` };

async function query(path) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { headers: h });
  if (!r.ok) throw new Error(`Supabase error: ${r.status} ${path}`);
  return r.json();
}

function setOutput(key, value) {
  appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `${key}<<EOF\n${value}\nEOF\n`);
}

async function main() {
  const [users, projects, quests] = await Promise.all([
    query('users?select=user_id,plan_type,daily_count,total_chat_count,invite_count,star_size,created_at&plan_type=neq.admin'),
    query('projects?select=user_id,primary_tag,created_at&order=created_at.desc&limit=100'),
    query('user_quests?select=user_id,quest_id'),
  ]);

  const now = Date.now();
  const DAY = 86400000;

  const totalUsers     = users.length;
  const neverChatted   = users.filter(u => !(u.total_chat_count > 0)).length;
  const paidUsers      = users.filter(u => u.plan_type !== 'free').length;
  const newUsers7d     = users.filter(u => now - new Date(u.created_at) < 7 * DAY).length;
  const activeToday    = users.filter(u => u.daily_count > 0).length;
  const avgStar        = totalUsers
    ? (users.reduce((s, u) => s + (u.star_size || 1), 0) / totalUsers).toFixed(2)
    : '1.00';
  const conversionRate = totalUsers ? Math.round(paidUsers / totalUsers * 100) : 0;

  const q1Count = quests.filter(q => q.quest_id === 'q1').length;
  const q4Count = quests.filter(q => q.quest_id === 'q4').length;
  const q1Rate  = totalUsers ? Math.round(q1Count / totalUsers * 100) : 0;
  const q4Rate  = totalUsers ? Math.round(q4Count / totalUsers * 100) : 0;

  const tagCount = {};
  for (const p of projects) tagCount[p.primary_tag] = (tagCount[p.primary_tag] || 0) + 1;
  const topTag = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0];
  const topCluster = topTag ? `${topTag[0]}(${topTag[1]}개)` : '없음';

  const summary = {
    totalUsers, neverChatted, paidUsers, newUsers7d,
    activeToday, avgStar, conversionRate, q1Rate, q4Rate, topCluster,
  };

  console.log('=== 분석 결과 ===');
  console.log(JSON.stringify(summary, null, 2));

  // Groq 인사이트
  let insights = '분석 불가 (Groq 연결 실패)';
  try {
    const gr = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `NOVA UNIVERSE SaaS 데이터를 보고 핵심 개선점 3가지를 한국어로 알려줘.

데이터:
- 전체 유저: ${totalUsers}명
- AI 미사용 유저: ${neverChatted}명 (이탈 위험)
- 유료 전환율: ${conversionRate}% (${paidUsers}명)
- 오늘 활성: ${activeToday}명
- 신규(7일): ${newUsers7d}명
- 첫 프로젝트 완료율: ${q1Rate}%
- 초대 완료율: ${q4Rate}%
- 인기 클러스터: ${topCluster}
- 평균 별 크기: ${avgStar}

형식: 숫자. 문제 → 해결책 (각 2줄 이내)`
        }]
      })
    });
    const gd = await gr.json();
    insights = gd.choices?.[0]?.message?.content?.trim() || '분석 불가';
  } catch (e) {
    console.error('Groq 오류:', e.message);
  }

  console.log('=== 인사이트 ===');
  console.log(insights);

    // GitHub Actions output 설정
  setOutput('insights', insights);
  setOutput('churn_risk', String(neverChatted));
  setOutput('conversion', String(conversionRate));
  setOutput('active_today', String(activeToday));
  setOutput('total_users', String(totalUsers));
  setOutput('summary_json', JSON.stringify(summary));

  // 이탈위험 3명 초과 → Telegram 승인 요청 후 GitHub Issue 생성
  if (neverChatted > 2) {
    const PIPELINE_SECRET = process.env.PIPELINE_SECRET;
    const BASE_URL = 'https://my-project-xi-sand-93.vercel.app';

    try {
      // 승인 요청
      const approvalRes = await fetch(`${BASE_URL}/api/request-approval`, {
        method: 'POST',
        headers: { 'x-pipeline-secret': PIPELINE_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_type: 'github-issue',
          description: `이탈위험 ${neverChatted}명 감지\n\n💡 개선 인사이트:\n${insights}\n\nGitHub Issue 자동 생성할까요?`,
          payload: { churn_risk: neverChatted, insights },
        }),
      });
      const { approval_id } = await approvalRes.json();
      console.log(`승인 요청 전송됨. approval_id: ${approval_id}`);

      // 최대 10분 폴링 (30초 간격 × 20회)
      let approved = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 30000));
        const checkRes = await fetch(`${BASE_URL}/api/check-approval?id=${approval_id}`, {
          headers: { 'x-pipeline-secret': PIPELINE_SECRET },
        });
        const { status } = await checkRes.json();
        console.log(`[${i + 1}/20] 승인 상태: ${status}`);
        if (status === 'approved') { approved = true; break; }
        if (status === 'rejected') { console.log('거부됨 — Issue 생성 취소'); break; }
      }

      setOutput('create_issue', approved ? 'true' : 'false');
    } catch (e) {
      console.error('승인 요청 실패:', e.message);
      setOutput('create_issue', 'false');
    }
  } else {
    setOutput('create_issue', 'false');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
