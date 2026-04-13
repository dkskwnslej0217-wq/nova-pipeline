// api/trigger.js — 수동 파이프라인 트리거 (인스타 + 유튜브 즉시 실행)
export const config = { runtime: 'nodejs', maxDuration: 30 };

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'dkskwnslej0217-wq/nova-pipeline';
const SECRET       = process.env.PIPELINE_SECRET;

export default async function handler(req, res) {
  // 시크릿 확인
  const key = req.query.key ?? '';
  if (!SECRET || key !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN 없음' });
  }

  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/create-video.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'nova-pipeline',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (r.status === 204) {
      return res.json({ ok: true, msg: '✅ GitHub Actions 실행 시작됨 — 텔레그램 알림 기다려봐' });
    } else {
      const d = await r.json().catch(() => ({}));
      return res.status(500).json({ ok: false, msg: `GitHub 오류 ${r.status}`, detail: d });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, msg: e.message });
  }
}
