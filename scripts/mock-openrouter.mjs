/**
 * Mock OpenRouter server for v2.3.12 e2e — emulates openrouter.ai's API with
 * the EXACT failure mode from the user's report: every model EXCEPT the
 * `openrouter/free` meta-router is "temporarily rate-limited upstream" (429,
 * upstream_provider_shared_pool) — which is precisely why the user saw «из
 * бесплатных доступна только openrouter/free».
 *
 *   POST /api/v1/chat/completions — 429 (user payload shape) unless
 *                                  model === 'openrouter/free' → 200/SSE
 *   GET  /api/v1/models           — OpenRouter-style list with pricing
 *                                    (free = pricing 0 / :free suffix)
 *
 * Requests are logged to mock-openrouter-log.jsonl (one JSON per line) so the
 * verify script can prove the app actually retried via openrouter/free.
 *
 * Usage: node scripts/mock-openrouter.mjs [port] [logfile]
 */
import http from 'node:http';
import * as fs from 'node:fs';

const PORT = Number(process.argv[2] || 43120);
const LOG = process.argv[3] || '/home/z/my-project/work/v2312-openrouter-log.jsonl';
try { fs.unlinkSync(LOG); } catch { /* first run */ }

const MARKER = 'MOCK-OPENROUTER-OK';
const FREE_ROUTER = 'openrouter/free';

const log = (entry) => {
  try { fs.appendFileSync(LOG, JSON.stringify({ ts: Date.now(), ...entry }) + '\n'); } catch { /* ignore */ }
};

const openRouter429 = (model) => JSON.stringify({
  error: {
    message: 'Provider returned error',
    code: 429,
    metadata: {
      raw: `${model} is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations`,
      provider_name: 'Google AI Studio',
      is_byok: false,
      provider_error_code: '429',
      limit_source: 'upstream_provider_shared_pool',
      remedy_hint: 'Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing',
    },
  },
  user_id: 'user_mock',
});

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = req.url || '';
    let parsed = {};
    try { parsed = body ? JSON.parse(body) : {}; } catch { /* ignore */ }
    const model = parsed.model ?? '';

    if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');

    if (url === '/api/v1/models') {
      const payload = { object: 'list', data: [
        { id: FREE_ROUTER, pricing: { prompt: '0', completion: '0' } },
        { id: 'google/gemma-4-31b-it:free', pricing: { prompt: '0', completion: '0' } },
        { id: 'meta-llama/llama-3.1-8b-instruct:free', pricing: { prompt: '0', completion: '0' } },
        { id: 'mistralai/mistral-small:free', pricing: { prompt: '0', completion: '0' } },
        { id: 'openai/gpt-4o-mini', pricing: { prompt: '0.000001', completion: '0.000002' } },
        { id: 'anthropic/claude-3.5-sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
      ] };
      log({ url, method: 'GET', model: '-', status: 200 });
      return send(res, 200, payload);
    }

    if (url === '/api/v1/chat/completions') {
      // The free meta-router always works; everything else is rate-limited.
      if (model !== FREE_ROUTER) {
        console.log(`${new Date().toISOString().slice(11, 19)} POST ${url} model=${model} → 429 (rate-limited pool)`);
        log({ url, method: 'POST', model, status: 429, stream: !!parsed.stream });
        return send(res, 429, openRouter429(model));
      }
      console.log(`${new Date().toISOString().slice(11, 19)} POST ${url} model=${model} → 200${parsed.stream ? ' (SSE)' : ''}`);
      log({ url, method: 'POST', model, status: 200, stream: !!parsed.stream });
      const content = `${MARKER}:ответ получен через ${FREE_ROUTER} (fallback сработал)`;
      if (parsed.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        const chunks = content.split(' ');
        let i = 0;
        const tick = () => {
          if (i >= chunks.length) { res.write('data: [DONE]\n\n'); res.end(); return; }
          const tok = (i === 0 ? '' : ' ') + chunks[i++];
          res.write(`data: ${JSON.stringify({ id: 'mock-or', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: tok }, finish_reason: null }] })}\n\n`);
          setTimeout(tick, 12);
        };
        tick();
        return;
      }
      return send(res, 200, { id: 'mock-or', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 9 } });
    }

    log({ url, method: req.method, model, status: 404 });
    send(res, 404, { error: { message: 'unknown endpoint ' + url } });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock OpenRouter listening on http://127.0.0.1:${PORT} (log: ${LOG})`));
