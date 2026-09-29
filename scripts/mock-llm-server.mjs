/**
 * Mock LLM server for AI-assistant diagnostics/e2e — OpenAI-compatible +
 * Anthropic + Ollama endpoints on one port:
 *   POST /v1/chat/completions   (JSON + SSE stream)
 *   GET  /v1/models
 *   POST /v1/messages           (Anthropic, JSON + stream)
 *   GET  /api/tags              (Ollama model list)
 *   POST /api/chat              (Ollama chat, stream)
 * Every response body includes a marker so tests can prove the REAL app
 * talked to THIS server.
 *
 * Usage: node scripts/mock-llm-server.mjs [port]   (default 43112)
 */
import http from 'node:http';

const PORT = Number(process.argv[2] || 43112);
const MARKER = 'MOCK-LLM-OK';

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
    console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${url} model=${parsed.model ?? '-'} body=${body.slice(0, 300)}`);

    if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');

    if (url === '/v1/models') {
      return send(res, 200, { object: 'list', data: [
        { id: 'mock-gpt-mini' }, { id: 'mock-gpt-pro' }, { id: 'mock-llama3' },
      ] });
    }

    if (url === '/api/tags') {
      return send(res, 200, { models: [
        { name: 'mock-llama3:8b', size: 4e9 },
        { name: 'mock-qwen2.5:7b', size: 4.4e9 },
      ] });
    }

    if (url === '/v1/chat/completions') {
      const content = `${MARKER}:feat(mock): сгенерировано моком для «${(parsed.messages?.[1]?.content ?? '').slice(0, 40).replace(/\n/g, ' ')}»`;
      if (parsed.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        const chunks = content.split(' ');
        let i = 0;
        const tick = () => {
          if (i >= chunks.length) {
            res.write(`data: [DONE]\n\n`);
            res.end();
            return;
          }
          const tok = (i === 0 ? '' : ' ') + chunks[i++];
          res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: tok }, finish_reason: null }] })}\n\n`);
          setTimeout(tick, 15);
        };
        tick();
        return;
      }
      return send(res, 200, { id: 'mock', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
    }

    if (url === '/v1/messages') {
      const content = `${MARKER} anthropic answer`;
      if (parsed.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
        res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start' })}\n\n`);
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: content } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        res.end();
        return;
      }
      return send(res, 200, { id: 'mock', type: 'message', role: 'assistant', content: [{ type: 'text', text: content }] });
    }

    if (url === '/api/chat') {
      const content = `${MARKER} ollama answer`;
      if (parsed.stream) {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Access-Control-Allow-Origin': '*' });
        const parts = content.split(' ');
        let i = 0;
        const tick = () => {
          if (i >= parts.length) { res.end(); return; }
          const tok = (i === 0 ? '' : ' ') + parts[i++];
          res.write(JSON.stringify({ model: parsed.model, message: { role: 'assistant', content: tok }, done: false }) + '\n');
          setTimeout(tick, 15);
        };
        tick();
        return;
      }
      return send(res, 200, { model: parsed.model, message: { role: 'assistant', content }, done: true });
    }

    if (url === '/api/generate') {
      return send(res, 200, { model: parsed.model, response: `${MARKER} ollama generate`, done: true });
    }

    send(res, 404, { error: 'unknown endpoint ' + url });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock LLM listening on http://127.0.0.1:${PORT}`));
