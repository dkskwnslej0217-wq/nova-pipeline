// api/tts.js — Google TTS (무료, 월100만자)
// POST { text } → MP3 스트림 반환 / PIPELINE_SECRET 인증

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  if (req.headers.get('x-pipeline-secret') !== process.env.PIPELINE_SECRET)
    return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: '잘못된 요청' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const text = (body.text ?? '').trim().slice(0, 2500);
  if (!text) return new Response(JSON.stringify({ error: 'text 필요' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const apiKey = process.env.GOOGLE_TTS_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'GOOGLE_TTS_KEY 미설정' }), { status: 503, headers: { 'Content-Type': 'application/json' } });

  try {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-C', ssmlGender: 'FEMALE' },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Google TTS ${res.status}`);
    const data = await res.json();
    const binary = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0));
    return new Response(binary, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'attachment; filename="nova_tts.mp3"',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
