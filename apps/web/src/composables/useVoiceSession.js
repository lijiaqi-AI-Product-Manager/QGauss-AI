import { computed, onUnmounted, reactive, watch } from 'vue';
import { api, fetchBlob, uploadVoiceRecording } from '../api/client.js';
import { createVoiceRecorder } from '../lib/voice-recorder.js';
import { voiceTerminal } from '../lib/voice-presentation.js';

/** Every callback belongs to one identity and one visible conversation. */
export function useVoiceSession({ auth, context, disabled, insert, refreshBalance = () => {} }) {
  const state = reactive({ open: false, tab: 'record', options: null, loading: false, busy: false, error: '', voice: 'fable', autoplay: false, recording: false, requestingMic: false, seconds: 0, level: 0, recordingUrl: '', hasRecording: false, transcript: '', task: null, confirmation: null, player: null, playing: false, playbackSeconds: 0, playbackDuration: 0, audioPart: 0, reconnectable: false, resubmittable:false });
  let epoch = 0, alive = true, read, recorder, micSignal, file, uploadId, player, audioUrl, pending, pollTimer;
  const autoSeen = new Set(), active = () => alive && auth.isLoggedIn;
  const storageKey = () => `qg:voice:${auth.user?.id || 'guest'}:${context.value}`;
  const prefKey = () => `qg:voice-prefs:${auth.user?.id || 'guest'}`;
  const current = revision => active() && revision === epoch;
  const savePending = value => { pending = value; try { value ? sessionStorage.setItem(storageKey(), JSON.stringify(value)) : sessionStorage.removeItem(storageKey()); } catch { /* Resume remains available until this page closes. */ } };
  const readPending = () => { try { return JSON.parse(sessionStorage.getItem(storageKey()) || 'null'); } catch { return null; } };
  function stopPlayback() {
    if (player) { player.pause(); player.onended = player.ontimeupdate = player.onloadedmetadata = player.onerror = null; player.removeAttribute('src'); player.load?.(); player = null; }
    if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = null; state.playing = false;
  }
  function clearRecording() { recorder?.cancel(); recorder = null; micSignal?.abort(); micSignal = null; file = null; uploadId = null; if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl); state.recordingUrl = ''; state.hasRecording = false; state.recording = false; state.requestingMic = false; state.seconds = 0; state.level = 0; }
  function detach() {
    epoch++; read?.abort(); clearTimeout(pollTimer); stopPlayback(); clearRecording(); state.task = null; state.confirmation = null; state.player = null; state.transcript = ''; state.error = ''; state.busy = false; state.loading = false; state.reconnectable = false;state.resubmittable=false; state.open = false; pending = null; autoSeen.clear();
  }
  const notifyError = error => { state.error = error?.name === 'NotAllowedError' ? '没有获得麦克风权限，请允许录音后再试' : error?.name === 'NotFoundError' ? '没有找到麦克风，请连接后再试' : error?.message || '暂时没有完成，请稍后再试'; };
  async function loadOptions() {
    if (!active()) return; const revision = epoch; read?.abort(); read = new AbortController(); state.loading = true;
    try { const options = await api.get('/voice/options', { signal: read.signal }); if (current(revision)) state.options = options; }
    catch (error) { if (current(revision) && error.name !== 'AbortError') notifyError(error); }
    finally { if (current(revision)) state.loading = false; }
  }
  async function open(tab = 'record') { if (!active()) return false; state.tab = tab; state.open = true; state.error = '';if(!state.task&&!state.busy&&readPending())await reconnect(); if (!state.options && !state.busy) await loadOptions(); return true; }
  async function record() {
    if (!active() || disabled.value || state.busy || state.requestingMic || state.recording || !state.options?.transcription?.ready) return;
    stopPlayback(); clearRecording(); state.transcript = ''; state.task = null; state.error = ''; state.requestingMic = true; const revision = epoch; micSignal = new AbortController();
    recorder = createVoiceRecorder({ signal: micSignal.signal, maxSeconds: state.options.maxRecordingSeconds || 300,
      onProgress(value) { if (current(revision)) Object.assign(state, value); }, onLimit() { if (current(revision)) void finishRecording(); }, onError(error) { if (current(revision)) { clearRecording(); notifyError(error); } },
    });
    try { await recorder.start(); if (current(revision)) state.recording = true; }
    catch (error) { if (current(revision) && error.name !== 'AbortError') { clearRecording(); notifyError(error); } }
    finally { if (current(revision)) state.requestingMic = false; }
  }
  async function finishRecording() {
    if (!recorder || !state.recording) return; state.recording = false; state.busy = true; const revision = epoch, ownedRecorder = recorder;
    try { const result = await ownedRecorder.finish(); if (!current(revision)) return; if (result.seconds < .5) throw new Error('录音太短，请至少录制半秒'); file = result.file; state.seconds = result.seconds; state.recordingUrl = URL.createObjectURL(file); state.hasRecording = true; }
    catch (error) { if (current(revision) && error.name !== 'AbortError') notifyError(error); }
    finally { if (current(revision)) { state.busy = false; recorder = null; } }
  }
  async function playPart(index = 0) {
    if (!state.task?.audio?.[index] || !active()) return; const revision = epoch, taskId = state.task.id; stopPlayback(); state.audioPart = index; state.error = ''; read?.abort(); read = new AbortController();
    try {
      const blob = await fetchBlob(state.task.audio[index].url, { signal: read.signal }); if (!current(revision) || state.task?.id !== taskId) return;
      audioUrl = URL.createObjectURL(blob); player = new Audio(audioUrl); const owned = player;
      owned.onloadedmetadata = () => { if (current(revision) && player === owned) state.playbackDuration = Number.isFinite(owned.duration) ? owned.duration : 0; };
      owned.ontimeupdate = () => { if (current(revision) && player === owned) state.playbackSeconds = owned.currentTime; };
      owned.onended = () => { if (!current(revision) || player !== owned) return; if (state.task.audio[index + 1]) void playPart(index + 1); else { stopPlayback(); state.playbackSeconds = 0; } };
      owned.onerror = () => { if (current(revision) && player === owned) { stopPlayback(); state.error = '音频暂时无法播放，可再次点击播放；不会重新生成'; } };
      await owned.play(); if (current(revision) && player === owned) state.playing = true;
    } catch (error) { if (current(revision) && error.name !== 'AbortError') { stopPlayback(); state.error = error.name === 'NotAllowedError' ? '声音已准备好，请点击播放' : error.message || '暂时无法播放，请再次点击'; } }
  }
  async function play() {
    if (state.playing && player) { player.pause(); state.playing = false; return; }
    if (player) { try { await player.play(); state.playing = true; } catch { state.error = '请再次点击播放'; } return; }
    await playPart(state.audioPart || 0);
  }
  function seek(seconds) { if (player && Number.isFinite(seconds)) { player.currentTime = Math.max(0, Math.min(seconds, state.playbackDuration || 0)); state.playbackSeconds = player.currentTime; } }
  async function receive(task, shouldPlay = false) {
    state.task = task; state.busy = !voiceTerminal(task); state.reconnectable = false;
    if (!voiceTerminal(task)) return;
    savePending(null); void refreshBalance();
    if (task.status === 'FAILED') state.error = task.errorMessage || '服务没有完成本次请求，可明确重试';
    if (task.status === 'CANCELED') state.error = task.errorMessage || '已停止生成；外部服务可能仍计费';
    if (task.status === 'COMPLETED' && task.kind === 'transcription') { state.transcript = task.transcript || ''; state.open = true; state.tab = 'record';if(!state.options)await loadOptions(); }
    if (task.status === 'COMPLETED' && task.kind === 'speech') { state.player = { id: task.id, title: task.sample ? '音色试听' : '回答朗读' }; if (shouldPlay) await playPart(0); }
  }
  async function poll(id, shouldPlay, revision) {
    if (!current(revision)) return;
    read?.abort(); read = new AbortController();
    try { const task = await api.get(`/voice/tasks/${encodeURIComponent(id)}`, { signal: read.signal }); if (!current(revision)) return; await receive(task, shouldPlay); if (!voiceTerminal(task)) pollTimer = setTimeout(() => void poll(id, shouldPlay, revision), 1000); }
    catch (error) { if (current(revision) && error.name !== 'AbortError') { notifyError(error); state.busy = false; state.reconnectable = true; } }
  }
  async function submit(intent) {
    if (!active() || disabled.value) return; const revision = epoch; state.confirmation = null; state.busy = true; state.error = ''; state.reconnectable = false; state.resubmittable=false; stopPlayback(); state.task=null;state.player=null;state.audioPart=0;state.playbackSeconds=state.playbackDuration=0; clearTimeout(pollTimer); read?.abort(); read = new AbortController();
    savePending(intent);
    try { const task = await api.post('/voice/tasks', { ...intent.payload, requestKey: intent.requestKey, quoteRevision: intent.quoteRevision }, { signal: read.signal }); if (!current(revision)) return; savePending({ ...intent, taskId: task.id }); await receive(task, true); if (!voiceTerminal(task)) pollTimer = setTimeout(() => void poll(task.id, true, revision), 500); }
    catch (error) { if (current(revision) && error.name !== 'AbortError') { notifyError(error); state.busy = false; if(error.status>=400 && error.status<500 && ![408,429].includes(error.status)){savePending(null);state.reconnectable=false;}else state.reconnectable = true; } }
  }
  async function request(payload, automatic = false) {
    if (!active() || disabled.value || state.busy || state.recording || state.requestingMic || state.confirmation || state.reconnectable) return;
    const revision = epoch; state.busy = true; state.error = ''; read?.abort(); read = new AbortController();
    try {
      const quote = await api.post('/voice/quote', payload, { signal: read.signal }); if (!current(revision)) return;
      const intent = { payload, requestKey: crypto.randomUUID(), quoteRevision: quote.revision };
      if (quote.cost > 0) { state.confirmation = { quote, intent, automatic }; state.open = true; state.tab = 'confirm'; state.busy = false; }
      else await submit(intent);
    } catch (error) { if (current(revision) && error.name !== 'AbortError') notifyError(error); }
    finally { if (current(revision) && !pending) state.busy = false; }
  }
  async function transcribe() {
    if (!file || !active() || state.busy || disabled.value || state.confirmation || state.reconnectable) return; const revision = epoch; state.busy = true; state.error = ''; read?.abort(); read = new AbortController();
    try { if (!uploadId) { const uploaded = await uploadVoiceRecording(file, { signal: read.signal }); if (!current(revision)) return; uploadId = uploaded.id; } state.busy = false; await request({ kind: 'transcription', fileId: uploadId }); }
    catch (error) { if (current(revision) && error.name !== 'AbortError') { notifyError(error); state.busy = false; } }
  }
  async function speak(message, automatic = false) {
    if (!message?.serverId || message.status !== 'COMPLETED' || !message.content?.trim()) return;
    if (state.player && state.task?.messageId === message.serverId && state.task?.voice === state.voice) { await play(); return; }
    await request({ kind: 'speech', messageId: message.serverId, voice: state.voice }, automatic);
  }
  async function reconnect() {
    const intent = pending || readPending(); if (!intent || !active() || state.busy) return; pending = intent; const revision = epoch; state.busy = true; state.error = ''; read?.abort(); read = new AbortController();
    try { const task = await api.get(intent.taskId ? `/voice/tasks/${encodeURIComponent(intent.taskId)}` : `/voice/tasks/by-request/${encodeURIComponent(intent.requestKey)}`, { signal: read.signal }); if (!current(revision)) return; await receive(task, false); if (!voiceTerminal(task)) pollTimer = setTimeout(() => void poll(task.id, false, revision), 500); }
    catch (error) { if (current(revision) && error.name !== 'AbortError') { state.busy = false; if (error.status === 404 && !intent.taskId) { state.resubmittable=true;state.reconnectable=true;state.error = '暂未查到接收回执。可使用同一次提交重新连接，避免重复生成。'; } else if(error.status===404){savePending(null);state.reconnectable=false;state.error='语音源内容已移除，无法继续读取。';}else { notifyError(error); state.reconnectable = true; } } }
  }
  async function cancelTask() {
    const id = state.task?.id || pending?.taskId; if (!id || !active() || state.task?.status === 'SETTLING') return; const revision = epoch; read?.abort(); clearTimeout(pollTimer); read = new AbortController(); state.busy = true;
    try { const task = await api.post(`/voice/tasks/${encodeURIComponent(id)}/cancel`, {}, { signal: read.signal }); if (!current(revision)) return; await receive(task, false); if (!voiceTerminal(task)) pollTimer = setTimeout(() => void poll(id, false, revision), 500); }
    catch (error) { if (current(revision) && error.name !== 'AbortError') { notifyError(error); state.busy = false; state.reconnectable = true; } }
  }
  function confirm() { if (state.confirmation) void submit(state.confirmation.intent); }
  function close() { if (state.recording || state.requestingMic) clearRecording(); state.confirmation = null; state.open = false; }
  function useTranscript() { if (!state.transcript.trim() || disabled.value || !active()) return; insert(state.transcript.trim()); state.transcript = ''; state.open = false; clearRecording(); }
  function onReply(message) { if (!state.autoplay || autoSeen.has(message?.serverId) || !active()) return; autoSeen.add(message.serverId); void speak(message, true); }
  function setVoice(id) { state.voice = id; stopPlayback(); }
  watch([() => auth.user?.id || '', () => auth.identityRevision, () => context.value], () => {
    detach(); state.options = null; state.autoplay = false; state.voice = 'fable';
    if (!active()) return;
    try { const prefs = JSON.parse(localStorage.getItem(prefKey()) || '{}'); if (['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer'].includes(prefs.voice)) state.voice = prefs.voice; state.autoplay = prefs.autoplay === true; } catch { /* Defaults stay local to this user. */ }
    if (readPending()) { state.reconnectable = true; void reconnect(); }
  }, { immediate: true, flush: 'sync' });
  watch([() => state.voice, () => state.autoplay], () => { if (active()) try { localStorage.setItem(prefKey(), JSON.stringify({ voice: state.voice, autoplay: state.autoplay })); } catch { /* In-memory preferences still work. */ } });
  onUnmounted(() => { detach(); alive = false; });
  return Object.assign(state, { show: open, loadOptions, record, finishRecording, clearRecording, transcribe, speak, preview: () => request({ kind: 'speech', sample: true, voice: state.voice }), play, seek, stopPlayback, reconnect, resubmit:()=>pending&&submit(pending), reset:detach, cancelTask, confirm, close, useTranscript, onReply, setVoice, cancelConfirmation: () => { state.confirmation = null; state.tab = 'record'; }, canRecord: computed(() => active() && !disabled.value && !!state.options?.transcription?.ready) });
}
