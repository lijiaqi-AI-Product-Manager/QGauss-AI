/** Controlled loopback protocols. All keys/prompts are synthetic, with no external provider. */
const seen = [], active = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const packet = (res, value, event = '') => res.write((event ? 'event: ' + event + '\n' : '') + 'data: ' + JSON.stringify(value) + '\n\n');

export async function nativeUpstreamFixture(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/native/stats') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ requests: seen, active: Object.fromEntries(active) })); return true; }
  const match = /^\/native\/(openai|responses|anthropic|gemini)\//.exec(url.pathname);
  if (!match) return false;
  const type = match[1];
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2_000_000) { res.writeHead(413).end(); return true; } }
  let body; try { body = JSON.parse(raw); } catch { res.writeHead(400).end(); return true; }
  const geminiModel = /\/models\/([^/]+):(?:streamGenerateContent|generateContent)$/.exec(url.pathname)?.[1];
  const model = type === 'gemini' ? decodeURIComponent(geminiModel || '') : body.model;
  const key = req.headers.authorization?.replace(/^Bearer /, '') || req.headers['x-api-key'] || req.headers['x-goog-api-key'] || '';
  seen.push({ type, path: url.pathname, query: Object.fromEntries(url.searchParams), model, body,
    auth: { bearer: req.headers.authorization || '', anthropic: req.headers['x-api-key'] || '', google: req.headers['x-goog-api-key'] || '', version: req.headers['anthropic-version'] || '' } });
  if (seen.length > 300) seen.shift();
  const pathMatches = type === 'gemini' ? !!geminiModel && url.pathname.includes('/v1beta/models/') : url.pathname.endsWith('/v1/' + ({ openai: 'chat/completions', responses: 'responses', anthropic: 'messages' })[type]);
  const authMatches = type === 'anthropic' ? req.headers['anthropic-version'] === '2023-06-01' && !!req.headers['x-api-key'] && !req.headers.authorization : type === 'gemini' ? !!req.headers['x-goog-api-key'] && !req.headers.authorization && !url.searchParams.has('key') : !!req.headers.authorization;
  if (!pathMatches || !authMatches || !model) { res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"native request shape mismatch"}'); return true; }
  if (key.endsWith('-bad')) { res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"synthetic invalid key"}'); return true; }
  if (key.endsWith('-limited')) { res.writeHead(429).end(); return true; }
  if (model.includes('-pre-error-')) { res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"synthetic before output failure"}'); return true; }
  const stream = type === 'gemini' ? url.pathname.endsWith(':streamGenerateContent') : body.stream === true;
  if (!stream && model.includes('-probe-error-')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"error":{"message":"synthetic error under 200"}}'); return true; }
  if (!stream && model.includes('-probe-html-')) { res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>synthetic wrong root</html>'); return true; }
  if (!stream) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(type === 'gemini' ? { candidates: [{ content: { parts: [{ text: 'probe' }] } }] } : type === 'anthropic' ? { content: [{ type: 'text', text: 'probe' }] } : type === 'responses' ? { status: 'completed', output: [] } : { choices: [{ message: { content: 'probe' } }] })); return true; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  active.set(model, (active.get(model) || 0) + 1);
  res.once('close', () => active.set(model, Math.max(0, (active.get(model) || 1) - 1)));
  const noUsage = model.includes('-no-usage-'), limited = model.includes('-length-');
  const delta = text => type === 'openai' ? packet(res, { choices: [{ index: 0, delta: { content: text } }] }) : type === 'responses' ? packet(res, { type: 'response.output_text.delta', delta: text }, 'response.output_text.delta') : type === 'anthropic' ? packet(res, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, 'content_block_delta') : packet(res, { candidates: [{ index: 0, content: { role: 'model', parts: [{ text }] } }] });
  if (model.includes('-web-')) {
    const enabled = body.tools?.some(tool => type === 'responses' ? tool.type === 'web_search' : type === 'anthropic' ? tool.type === 'web_search_20250305' : tool.type === 'retrieval');
    const noSources = model.includes('-no-sources-');
    const source = { url: 'https://sources.qgauss.test/guide', title: 'QGauss 合成检索资料', encrypted_content: 'QGAUSS_PRIVATE_SEARCH_RESULT' };
    if (type === 'anthropic') packet(res, { type: 'message_start', message: { usage: { input_tokens: 21 } } });
    if (enabled && !noSources) {
      if (type === 'responses') packet(res, { type: 'response.output_item.added', item: { type: 'web_search_call', status: 'in_progress' } });
      else if (type === 'anthropic') {
        packet(res, { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', name: 'web_search' } });
        packet(res, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"QGAUSS_PRIVATE_SEARCH_QUERY"}' } });
      } else packet(res, { choices: [], citations: [source] });
      await pause(30);
      if (model.includes('-cut-')) { res.end(); return true; }
      if (model.includes('-hold-')) { const timer = setInterval(() => res.write(': keepalive\n\n'), 50); res.once('close', () => clearInterval(timer)); return true; }
      if (type === 'responses') packet(res, { type: 'response.output_item.done', item: { type: 'web_search_call', status: 'completed', action: { sources: [source, { url: 'javascript:alert(1)', title: 'unsafe' }] } } });
      if (type === 'anthropic') packet(res, { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', content: [{ type: 'web_search_result', ...source }] } });
    }
    delta('这是合成检索的回答。');
    if (enabled && !noSources) {
      const annotation = { type: 'url_citation', ...source, start_index: 10, end_index: 10 };
      if (type === 'responses') packet(res, { type: 'response.output_text.annotation.added', content_index: 0, annotation });
      else if (type === 'anthropic') packet(res, { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', ...source, encrypted_index: 'QGAUSS_PRIVATE_SEARCH_RESULT' } } });
      else packet(res, { choices: [{ delta: { annotations: [{ type: 'url_citation', url_citation: annotation }] } }], citations: [source.url] });
    }
    if (type === 'responses') packet(res, { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 19, output_tokens: 11 } } });
    else if (type === 'anthropic') { packet(res, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 13 } }); packet(res, { type: 'message_stop' }); }
    else { packet(res, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 17, completion_tokens: 7 } }); res.write('data: [DONE]\n\n'); }
    res.end(); return true;
  }
  if (type === 'anthropic') packet(res, { type: 'message_start', message: { usage: noUsage ? {} : { input_tokens: 21, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 1 } } }, 'message_start');
  if (model.includes('-bad-json-')) { res.write('data: {broken}\n\n'); res.end(); return true; }
  if (!model.includes('-empty-')) {
    if (type === 'responses') packet(res, { type: 'response.reasoning_summary_text.delta', delta: '公开思路' }, 'response.reasoning_summary_text.delta');
    if (type === 'anthropic') packet(res, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '公开思路' } }, 'content_block_delta');
    if (type === 'gemini') packet(res, { candidates: [{ index: 0, content: { parts: [{ thought: true, text: '公开思路' }] } }] });
    delta('原生协议的中文回复🚀');
  }
  if (model.includes('-hold-')) { const timer = setInterval(() => res.write(': keepalive\n\n'), 100); res.once('close', () => clearInterval(timer)); return true; }
  await pause(15);
  if (res.destroyed) return true;
  if (model.includes('-cut-')) { res.end(); return true; }
  if (model.includes('-tools-')) {
    if (type === 'responses') packet(res, { type: 'response.output_item.added', item: { type: 'function_call', name: 'must-not-run' } });
    else if (type === 'anthropic') packet(res, { type: 'content_block_start', content_block: { type: 'tool_use', name: 'must-not-run' } });
    else if (type === 'gemini') packet(res, { candidates: [{ content: { parts: [{ functionCall: { name: 'must-not-run' } }] } }] });
    else packet(res, { choices: [{ delta: { tool_calls: [{ name: 'must-not-run' }] } }] });
    res.end(); return true;
  }
  if (model.includes('-mid-error-')) { packet(res, { type: 'error', error: { type: 'overloaded_error', message: 'synthetic after text error' } }, 'error'); res.end(); return true; }
  if (type === 'openai') {
    packet(res, { choices: [{ index: 0, delta: {}, finish_reason: limited ? 'length' : 'stop' }] });
    if (!noUsage) packet(res, { choices: [], usage: { prompt_tokens: 17, completion_tokens: 7 } });
    res.write('data: [DONE]\n\n');
  } else if (type === 'responses') {
    const name = limited ? 'response.incomplete' : 'response.completed';
    packet(res, { type: name, response: { status: limited ? 'incomplete' : 'completed', ...(limited ? { incomplete_details: { reason: 'max_output_tokens' } } : {}), ...(noUsage ? {} : { usage: { input_tokens: 19, output_tokens: 11 } }) } }, name);
  } else if (type === 'anthropic') {
    packet(res, { type: 'message_delta', delta: { stop_reason: limited ? 'max_tokens' : 'end_turn' }, usage: noUsage ? {} : { output_tokens: 13 } }, 'message_delta'); packet(res, { type: 'message_stop' }, 'message_stop');
  } else packet(res, { candidates: [{ index: 0, finishReason: limited ? 'MAX_TOKENS' : 'STOP' }], ...(noUsage ? {} : { usageMetadata: { promptTokenCount: 23, candidatesTokenCount: 9, thoughtsTokenCount: 3 } }) });
  res.end(); return true;
}
