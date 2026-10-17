// Chat for the hosted site. Gives the app the same `sample(input, options)` function the Claude artifact
// runtime provides, backed by your chat proxy (worker/), which calls the Claude API with your key.
// Tools run here in the page: Claude asks for one, the page runs it and sends the result back, up to 6 rounds.
window.BL_SAMPLE = (function () {
  const cfg = window.BL_CONFIG || {};
  if (!cfg.chatEndpoint) return null;
  async function call(body, signal) {
    let res;
    try { res = await fetch(cfg.chatEndpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }); }
    catch (e) { if (e && e.name === 'AbortError') throw { code: 'cancelled', message: 'Stopped' }; throw { code: 'unavailable', message: 'Could not reach the chat service' }; }
    if (res.status === 429) throw { code: 'rate_limited', message: 'Too many messages' };
    if (!res.ok) throw { code: 'error', message: 'Chat service error ' + res.status };
    return res.json();
  }
  async function sample(input, opts) {
    opts = opts || {};
    let messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(m => ({ role: m.role, content: m.content }));
    const tools = (opts.tools || []).map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }));
    let text = '';
    for (let round = 0; round < 6; round++) {
      const res = await call({ messages, tools: tools.length ? tools : undefined, tier: opts.modelTier || 'default' }, opts.signal);
      const blocks = res.content || [];
      const t = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
      if (t) { text += (text ? '\n\n' : '') + t; if (opts.onText) opts.onText({ text, delta: t }); }
      const uses = blocks.filter(b => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) return { text, truncated: res.stop_reason === 'max_tokens' };
      messages = messages.concat([{ role: 'assistant', content: blocks }]);
      const results = [];
      for (const u of uses) {
        const tool = (opts.tools || []).find(x => x.name === u.name);
        let out, isError = false;
        try { if (!tool) throw new Error('Unknown tool ' + u.name); out = await tool.execute(u.input || {}, { signal: opts.signal }); }
        catch (e) { out = String((e && e.message) || e); isError = true; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out), is_error: isError });
      }
      messages = messages.concat([{ role: 'user', content: results }]);
    }
    return { text, truncated: true };
  }
  sample.limits = async () => ({ tools: { max: 16 } });
  sample.json = async (input, opts) => JSON.parse((await sample(input, opts)).text);
  return sample;
})();
