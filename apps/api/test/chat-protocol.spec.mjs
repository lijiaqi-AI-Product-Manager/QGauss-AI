import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatRequest, ChatProtocolDecoder, ChatSseParser, UpstreamError } from '../dist/common/llm/chat-protocol.js';
import { readChatResponse } from '../dist/common/llm/chat-stream.js';

const picture = 'data:image/png;base64,aGVsbG8=';
const messages = [{ role: 'system', content: '系统约束' }, { role: 'user', content: '上一轮提问' }, { role: 'assistant', content: '上一轮回复' }, { role: 'user', content: '查看本轮图片', images: [picture] }];
const channel = type => ({ type, baseUrl: 'https://models.qgauss.test/v1', apiKey: 'local-synthetic-key', upstreamName: 'fixture-model' });
function codec(type) { const emitted = []; const value = new ChatProtocolDecoder(type, (event, text) => emitted.push({ event, text })); return { value, emitted, push: json => value.consume(JSON.stringify(json)) }; }
const status = expected => error => error instanceof UpstreamError && error.status === expected;
const wire = (json, event = '') => (event ? 'event: ' + event + '\n' : '') + 'data: ' + JSON.stringify(json) + '\n\n';

test('Chat and custom requests preserve text, vision, context roles and bearer auth', () => {
  for (const type of ['OPENAI', 'CUSTOM']) {
    const request = buildChatRequest(channel(type), messages, { maxTokens: 123, temperature: 0.2 }); const body = JSON.parse(request.init.body);
    assert.equal(request.url, 'https://models.qgauss.test/v1/chat/completions'); assert.equal(request.init.headers.Authorization, 'Bearer local-synthetic-key');
    assert.equal(body.messages[0].role, 'system'); assert.deepEqual(body.messages.at(-1).content[1], { type: 'image_url', image_url: { url: picture } }); assert.equal(body.max_tokens, 123); assert.equal(body.stream_options.include_usage, true);
  }
});
test('Responses maps input and assistant parts, uses no server-side storage or implicit tools', () => {
  const request = buildChatRequest(channel('OPENAI_RESPONSES'), messages, { maxTokens: 123 }); const body = JSON.parse(request.init.body);
  assert.equal(request.url.endsWith('/responses'), true); assert.equal(body.max_output_tokens, 123); assert.equal(body.store, false); assert.equal(body.input[2].content[0].type, 'output_text'); assert.equal(body.input[3].content[1].image_url, picture); assert.equal('messages' in body, false); assert.equal('tools' in body, false);
});
test('Anthropic separates systems and encodes inline images with documented compatible version', () => {
  const request = buildChatRequest(channel('ANTHROPIC'), messages, { maxTokens: 123, temperature: 0.2 }); const body = JSON.parse(request.init.body);
  assert.equal(request.url.endsWith('/messages'), true); assert.equal(request.init.headers['anthropic-version'], '2023-06-01'); assert.equal(request.init.headers['x-api-key'], 'local-synthetic-key'); assert.equal('Authorization' in request.init.headers, false);
  assert.equal(body.system, '系统约束'); assert.equal(body.messages.length, 3); assert.deepEqual(body.messages.at(-1).content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }); assert.equal(body.temperature, 0.2);
});
test('Gemini uses the native model endpoint and header key without leaking credentials into URL', () => {
  const request = buildChatRequest({ ...channel('GEMINI'), baseUrl: 'https://models.qgauss.test/v1beta/', upstreamName: 'models/fixture-model' }, messages, { maxTokens: 123, temperature: 0.2 }); const body = JSON.parse(request.init.body);
  assert.equal(request.url, 'https://models.qgauss.test/v1beta/models/fixture-model:streamGenerateContent?alt=sse'); assert.equal(request.init.headers['x-goog-api-key'], 'local-synthetic-key'); assert.equal(request.url.includes('key='), false); assert.equal('Authorization' in request.init.headers, false);
  assert.equal(body.contents[1].role, 'model'); assert.equal(body.generationConfig.maxOutputTokens, 123); assert.equal(body.systemInstruction.parts[0].text, '系统约束'); assert.deepEqual(body.contents.at(-1).parts[1].inlineData, { mimeType: 'image/png', data: 'aGVsbG8=' });
});
test('administrator probes use the same native request mapping without streaming', () => {
  for (const type of ['OPENAI', 'OPENAI_RESPONSES', 'ANTHROPIC', 'GEMINI']) {
    const request = buildChatRequest(channel(type), [{ role: 'user', content: 'ping' }], { maxTokens: 16, stream: false }); const body = JSON.parse(request.init.body);
    assert.equal('stream_options' in body, false); assert.equal(request.init.headers.Accept, 'application/json');
    if (type === 'GEMINI') assert.match(request.url, /:generateContent$/); else assert.equal(body.stream, false);
  }
});
test('invalid API roots, model path traversal and unsupported image inputs fail before network I/O', () => {
  for (const url of ['https://a:b@models.qgauss.test/v1', 'https://models.qgauss.test/v1#part']) assert.throws(() => buildChatRequest({ ...channel('GEMINI'), baseUrl: url }, messages, { maxTokens: 10 }), status(400));
  for (const model of ['../admin', '/admin', 'models/../secret', 'x?key=bad']) assert.throws(() => buildChatRequest({ ...channel('GEMINI'), upstreamName: model }, messages, { maxTokens: 10 }), status(400));
  for (const type of ['GEMINI', 'ANTHROPIC']) assert.throws(() => buildChatRequest(channel(type), [{ role: 'user', content: '', images: ['https://files.qgauss.test/image.png'] }], { maxTokens: 10 }), status(400));
  assert.throws(() => buildChatRequest(channel('unknown'), messages, { maxTokens: 10 }), status(503));
});
test('existing API-version and gateway query parameters survive endpoint construction', () => {
  for (const type of ['OPENAI', 'OPENAI_RESPONSES', 'ANTHROPIC', 'GEMINI']) {
    const request = buildChatRequest({ ...channel(type), baseUrl: 'https://models.qgauss.test/v1/?api-version=2026-10-01&region=local' }, messages, { maxTokens: 20 });
    const url = new URL(request.url); assert.equal(url.searchParams.get('api-version'), '2026-10-01'); assert.equal(url.searchParams.get('region'), 'local'); assert.equal(url.pathname.includes('?'), false); assert.equal(url.pathname.endsWith('/'), false);
    if (type === 'GEMINI') assert.equal(url.searchParams.get('alt'), 'sse');
  }
});
test('Chat accumulates reasoning and content once, reads authoritative usage and supports finish without DONE', () => {
  const f = codec('OPENAI');
  f.push({ choices: [{ delta: { reasoning_content: '思考' }, index: 0 }] }); f.push({ choices: [{ delta: { content: '你好' }, index: 0 }] }); f.push({ choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] }); f.push({ choices: [], usage: { prompt_tokens: 13, completion_tokens: 7 } });
  assert.deepEqual(f.value.result(), { text: '你好', reasoning: '思考', finishReason: 'stop', usage: { promptTokens: 13, completionTokens: 7 } }); assert.equal(f.emitted.length, 2);
});
test('Responses emits only text and reasoning deltas, never duplicates completed output summaries', () => {
  const f = codec('OPENAI_RESPONSES'); f.push({ type: 'response.created' }); f.push({ type: 'response.reasoning_summary_text.delta', delta: '说明' }); f.push({ type: 'response.output_text.delta', delta: '完整回复' }); f.push({ type: 'response.output_text.done', text: '完整回复' }); f.push({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 19, output_tokens: 11 } } });
  assert.equal(f.value.result().text, '完整回复'); assert.equal(f.value.result().reasoning, '说明'); assert.deepEqual(f.value.result().usage, { promptTokens: 19, completionTokens: 11 }); assert.equal(f.value.ended, true);
});
test('Responses output limit is an explicit limited completion; other incomplete or failed results are errors', () => {
  const f = codec('OPENAI_RESPONSES'); f.push({ type: 'response.output_text.delta', delta: '保留片段' }); f.push({ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }); assert.equal(f.value.result().finishReason, 'length');
  for (const json of [{ type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } }, { type: 'response.failed' }, { type: 'response.completed', response: { status: 'failed' } }]) assert.throws(() => codec('OPENAI_RESPONSES').push(json), error => error instanceof UpstreamError);
});
test('Anthropic final token count is cumulative and includes cached input once', () => {
  const f = codec('ANTHROPIC'); f.push({ type: 'message_start', message: { usage: { input_tokens: 21, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 1 } } });
  f.push({ type: 'ping' }); f.push({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '思路' } }); f.push({ type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'opaque-not-text' } }); f.push({ type: 'content_block_delta', delta: { type: 'text_delta', text: '原生回复' } }); f.push({ type: 'message_delta', usage: { output_tokens: 4 } }); f.push({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 13 } }); f.push({ type: 'message_stop' });
  assert.deepEqual(f.value.result(), { text: '原生回复', reasoning: '思路', finishReason: 'stop', usage: { promptTokens: 26, completionTokens: 13 } });
});
test('Gemini reports candidate text and thinking separately, counts thinking tokens and ignores other candidates', () => {
  const f = codec('GEMINI'); f.push({ candidates: [{ index: 0, content: { parts: [{ thought: true, text: '想法' }, { text: '原生回复' }] } }, { index: 1, content: { parts: [{ text: '其他候选' }] } }] }); f.push({ candidates: [{ index: 0, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 23, cachedContentTokenCount: 2, candidatesTokenCount: 9, thoughtsTokenCount: 3 } });
  assert.deepEqual(f.value.result(), { text: '原生回复', reasoning: '想法', finishReason: 'stop', usage: { promptTokens: 23, completionTokens: 12 } });
});
test('provider filters, partial errors and unsupported tools cannot masquerade as a completed reply', () => {
  for (const [type, payload] of [['GEMINI', { promptFeedback: { blockReason: 'SAFETY' } }], ['GEMINI', { candidates: [{ finishReason: 'SAFETY' }] }], ['OPENAI', { choices: [{ delta: {}, finish_reason: 'content_filter' }] }], ['OPENAI', { choices: [{ delta: { tool_calls: [{}] } }] }], ['ANTHROPIC', { type: 'content_block_start', content_block: { type: 'tool_use' } }], ['GEMINI', { candidates: [{ content: { parts: [{ functionCall: {} }] } }] }], ['OPENAI_RESPONSES', { type: 'response.output_item.added', item: { type: 'function_call' } }]]) assert.throws(() => codec(type).push(payload), status(400));
  const f = codec('ANTHROPIC'); f.push({ type: 'content_block_delta', delta: { type: 'text_delta', text: '部分回复' } }); assert.throws(() => f.push({ type: 'error', error: { type: 'overloaded_error' } }), status(529)); assert.equal(f.emitted[0].text, '部分回复'); assert.throws(() => f.value.result(), status(502));
});
test('native error codes retain key-level authentication, permissions and rate-limit classification', () => {
  for (const [error, code] of [[{ type: 'authentication_error' }, 401], [{ status: 'PERMISSION_DENIED' }, 403], [{ type: 'rate_limit_error' }, 429], [{ code: 429 }, 429]]) assert.throws(() => codec('GEMINI').push({ error }), status(code));
});
test('missing or invalid usage remains unknown rather than inventing a provider count', () => {
  for (const values of [undefined, { prompt_tokens: -1, completion_tokens: 3 }, { prompt_tokens: '12', completion_tokens: 3 }, { prompt_tokens: 2147483648, completion_tokens: 2 }]) { const f = codec('OPENAI'); f.push({ choices: [{ delta: { content: '回复' }, finish_reason: 'stop' }], usage: values }); assert.equal(f.value.result().usage, null); }
});
test('EOF without semantic completion and an empty completed response are failures', () => {
  const f = codec('OPENAI'); f.push({ choices: [{ delta: { content: '中断片段' } }] }); assert.throws(() => f.value.result(), status(502));
  const empty = codec('OPENAI_RESPONSES'); empty.push({ type: 'response.completed', response: { status: 'completed' } }); assert.throws(() => empty.value.result(), status(502));
});
test('SSE accepts CRLF split across chunks, named events, multiline JSON, comments and final data without newline', () => {
  const f = codec('OPENAI_RESPONSES'), parser = new ChatSseParser((data, event) => f.value.consume(data, event));
  const input = ': heartbeat\r\ndata:\r\n\r\nevent: response.output_text.delta\r\ndata: {\r\ndata: "delta":"中文","type":"response.output_text.delta"}\r\n\r\nevent: response.completed\r\ndata: {"type":"response.completed","response":{"status":"completed"}}';
  for (const character of input) parser.push(character); parser.finish(); assert.equal(f.value.result().text, '中文');
});
test('legacy data-per-line SSE blocks preserve each delta, with a bounded single event', () => {
  const seen = [], parser = new ChatSseParser(data => seen.push(JSON.parse(data)), 64); parser.push('data: {"n":1}\r\ndata: {"n":2}\r\n\r\n'); assert.deepEqual(seen, [{ n: 1 }, { n: 2 }]);
  parser.push(Array.from({ length: 100 }, () => 'data: {"n":3}\n\n').join('')); assert.equal(seen.length, 102);
  assert.throws(() => parser.push('data: ' + 'x'.repeat(65)), status(502));
});
test('transport decodes byte-split UTF-8 and cancels a lingering connection after terminal event', async () => {
  let canceled = false; const data = new TextEncoder().encode(wire({ choices: [{ delta: { content: '中文🚀' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n');
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of data) controller.enqueue(Uint8Array.of(byte)); }, cancel() { canceled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  let received = ''; const result = await readChatResponse(response, 'OPENAI', (_event, text) => { received += text; }, new AbortController().signal, 10000); assert.equal(result.text, '中文🚀'); assert.equal(received, result.text); assert.equal(canceled, true);
});
test('transport rejects the wrong response format and malformed JSON, never treats EOF as success', async () => {
  await assert.rejects(readChatResponse(new Response('{}'), 'GEMINI', () => {}, new AbortController().signal, 10000), status(502));
  await assert.rejects(readChatResponse(new Response('data: {broken}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), 'GEMINI', () => {}, new AbortController().signal, 10000), status(502));
});
test('canceling transport closes its reader before waiting for the next provider event', async () => {
  const controller = new AbortController(); let canceled = false;
  const response = new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  const finished = readChatResponse(response, 'ANTHROPIC', () => {}, controller.signal, 10000); controller.abort(new Error('explicit local stop')); await assert.rejects(finished, /explicit local stop/); assert.equal(canceled, true);
});
test('idle timeout closes a stalled stream instead of reporting a successful empty answer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let canceled = false;
  const response = new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  const finished = readChatResponse(response, 'ANTHROPIC', () => {}, new AbortController().signal, 1000);
  t.mock.timers.tick(5001); await assert.rejects(finished, status(504)); assert.equal(canceled, true);
});
test('invalid UTF-8 cannot silently corrupt a completed answer', async () => {
  const invalid = Uint8Array.from([100, 97, 116, 97, 58, 32, 0xff, 10, 10]);
  const response = new Response(invalid, { headers: { 'Content-Type': 'text/event-stream' } });
  await assert.rejects(readChatResponse(response, 'OPENAI', () => {}, new AbortController().signal, 10000), error => error instanceof TypeError);
});
