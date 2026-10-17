// Blueline Desk chat proxy (Cloudflare Worker). The site's chat sends its conversation here; this adds your
// Claude API key and forwards it to the Messages API, so the key never reaches the browser.
//
// Settings (Cloudflare dashboard > Workers > your worker > Settings > Variables):
//   ANTHROPIC_API_KEY  (secret)  your Claude API key
//   ALLOWED_ORIGINS              comma-separated site origins, e.g. https://you.github.io
//   MODEL                        optional, defaults to claude-sonnet-5-5
//   DAILY_LIMIT                  optional, max requests per visitor IP per day (needs the RATE KV binding)
const SYSTEM = 'You are the analyst inside Blueline Desk, an NHL betting dashboard. Be brief, plain-spoken and honest about uncertainty. Use only the data and tool results you are given. You cannot place bets. This tool is for adults of legal betting age; if gambling seems to be causing problems, mention 1-800-GAMBLER.';

export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const ok = allowed.length === 0 || allowed.includes(origin);
    const cors = { 'access-control-allow-origin': ok ? origin || '*' : 'null', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return new Response('Use POST', { status: 405, headers: cors });
    if (!ok) return new Response('This site is not allowed to use the chat.', { status: 403, headers: cors });
    if (!env.ANTHROPIC_API_KEY) return new Response('ANTHROPIC_API_KEY is not set', { status: 500, headers: cors });

    if (env.RATE && env.DAILY_LIMIT) { // simple per-visitor daily cap
      const ip = req.headers.get('cf-connecting-ip') || 'unknown', day = new Date().toISOString().slice(0, 10), k = `${day}:${ip}`;
      const n = Number(await env.RATE.get(k)) || 0;
      if (n >= Number(env.DAILY_LIMIT)) return new Response('Daily chat limit reached', { status: 429, headers: cors });
      await env.RATE.put(k, String(n + 1), { expirationTtl: 90000 });
    }

    let body;
    try { body = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400, headers: cors }); }
    if (!Array.isArray(body.messages) || body.messages.length > 40) return new Response('Bad request', { status: 400, headers: cors });
    const payload = {
      model: env.MODEL || 'claude-sonnet-5-5',
      max_tokens: 1200,
      system: SYSTEM,
      messages: body.messages
    };
    if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools.slice(0, 16);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return new Response(await r.text(), { status: r.status, headers: Object.assign({ 'content-type': 'application/json' }, cors) });
  }
};
