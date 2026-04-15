// api/privacy.js — Privacy Policy (Google OAuth 심사용)
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — NOVA Pipeline</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 60px auto; padding: 0 24px; color: #222; line-height: 1.7; }
    h1 { font-size: 2rem; margin-bottom: 8px; }
    h2 { font-size: 1.2rem; margin-top: 40px; color: #444; }
    p, li { color: #555; }
    a { color: #0070f3; }
    .updated { color: #999; font-size: 0.9rem; margin-bottom: 40px; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated: April 15, 2026</p>

  <h2>1. Overview</h2>
  <p>NOVA Pipeline ("the App") is a personal automation tool that publishes AI trend analysis videos to a single YouTube channel owned and operated by the app developer. The App does not serve external users.</p>

  <h2>2. Data We Access</h2>
  <p>The App requests access to the following Google API scope:</p>
  <ul>
    <li><strong>youtube.upload</strong> — Used solely to upload videos to the developer's own YouTube channel.</li>
  </ul>

  <h2>3. How We Use Your Data</h2>
  <p>The App uses YouTube API access exclusively to:</p>
  <ul>
    <li>Upload pre-generated video files to the developer's personal YouTube channel.</li>
    <li>Set video titles, descriptions, and tags automatically.</li>
  </ul>
  <p>No data is stored, sold, shared, or used for any purpose other than the above.</p>

  <h2>4. Data Retention</h2>
  <p>The App does not store any YouTube user data. OAuth tokens are stored securely as environment variables on Vercel and are never logged or exposed.</p>

  <h2>5. Third Parties</h2>
  <p>The App does not share any data with third parties. The App uses the following services:</p>
  <ul>
    <li>YouTube Data API v3 (Google LLC) — for video uploads</li>
    <li>Vercel — for serverless hosting</li>
    <li>Supabase — for internal pipeline state management</li>
  </ul>

  <h2>6. User Rights</h2>
  <p>As this App is operated solely by the developer for personal use, no external user data is collected. If you have questions, contact us at the email below.</p>

  <h2>7. Contact</h2>
  <p>Developer: NOVA Pipeline<br>
  Email: <a href="mailto:dkskwnslej0217@gmail.com">dkskwnslej0217@gmail.com</a><br>
  Website: <a href="https://nova-pipeline-two.vercel.app">https://nova-pipeline-two.vercel.app</a></p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
