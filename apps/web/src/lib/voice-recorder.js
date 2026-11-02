export function encodeVoiceWav(chunks, sampleRate, targetRate = 16000) {
  const length = chunks.reduce((sum, part) => sum + part.length, 0);
  if (!length || !Number.isFinite(sampleRate) || sampleRate < targetRate) throw new Error('没有录到声音，请重新录制');
  const source = new Float32Array(length); let at = 0; for (const chunk of chunks) { source.set(chunk, at); at += chunk.length; }
  const ratio = sampleRate / targetRate, count = Math.floor(length / ratio), buffer = new ArrayBuffer(44 + count * 2), view = new DataView(buffer);
  const ascii = (offset, value) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, targetRate, true); view.setUint32(28, targetRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * ratio), end = Math.max(start + 1, Math.floor((index + 1) * ratio)); let sum = 0;
    for (let frame = start; frame < end; frame++) sum += source[frame];
    const sample = Math.max(-1, Math.min(1, sum / (end - start))); view.setInt16(44 + index * 2, sample * (sample < 0 ? 32768 : 32767), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function createVoiceRecorder({ onProgress = () => {}, onLimit = () => {}, onError = () => {}, maxSeconds = 300, signal } = {}) {
  let stream, context, source, processor, silent, timer, chunks = [], frames = 0, canceled = false, finishing = false, done, finishPromise;
  const stoppedTracks=new WeakSet(),disconnectedNodes=new WeakSet();let contextClosing;
  const close = async () => { clearTimeout(timer); for(const node of[source,processor,silent])if(node&&!disconnectedNodes.has(node)){disconnectedNodes.add(node);node.disconnect();}stream?.getTracks().forEach(track => {if(!stoppedTracks.has(track)){stoppedTracks.add(track);track.stop();}});if(context&&context.state!=='closed')await(contextClosing ||= context.close()).catch(()=>{});signal?.removeEventListener('abort',cancel); };
  const cancel = () => { canceled = true; chunks = []; done?.(); void close(); };
  const finish = () => finishPromise ||= (async () => {
    if (canceled || !processor || !context) throw new Error('录音已结束，请重新录制'); finishing = true; clearTimeout(timer);
    await new Promise(resolve => { let flushTimer; done = () => { clearTimeout(flushTimer); resolve(); }; flushTimer = setTimeout(done, 750); processor.port.postMessage('finish'); });
    await close(); if (canceled) throw new DOMException('录音已取消', 'AbortError');
    const result = encodeVoiceWav(chunks, context.sampleRate); chunks = []; return { file: new File([result], 'QGauss-voice.wav', { type: 'audio/wav' }), seconds: frames / context.sampleRate };
  })();
  return {
    cancel, finish,
    async start() {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia || !globalThis.AudioWorkletNode) throw new Error('当前浏览器无法录音，请使用安全连接和支持录音的浏览器');
      if (signal?.aborted) throw new DOMException('录音已取消', 'AbortError');
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
        if (canceled || signal?.aborted) { await close(); throw new DOMException('录音已取消', 'AbortError'); }
        context = new AudioContext(); await context.audioWorklet.addModule('/qgauss-recorder-worklet.js');
        if (canceled) { await close(); throw new DOMException('录音已取消', 'AbortError'); }
        source = context.createMediaStreamSource(stream); processor = new AudioWorkletNode(context, 'qgauss-capture'); silent = context.createGain(); silent.gain.value = 0;
        processor.port.onmessage = ({ data }) => {
          if (data.done) { done?.(); return; } if (canceled || !data.samples?.length) return;
          const remaining = Math.max(0, Math.floor(maxSeconds * context.sampleRate) - frames), part = data.samples.subarray(0, remaining); if (!part.length) return;
          chunks.push(part); frames += part.length; let power = 0; for (const sample of part) power += sample * sample;
          onProgress({ seconds: frames / context.sampleRate, level: Math.min(1, Math.sqrt(power / part.length) * 5) });
          if (frames >= maxSeconds * context.sampleRate && !finishing) { finishing = true; onLimit(); }
        };
        stream.getAudioTracks().forEach(track => { track.onended = () => { if (!finishing && !canceled) { cancel(); onError(new Error('麦克风连接已中断，请重新录音')); } }; });
        source.connect(processor); processor.connect(silent); silent.connect(context.destination); await context.resume();
        if (canceled) { await close(); throw new DOMException('录音已取消', 'AbortError'); }
        timer = setTimeout(() => { if (!finishing && !canceled) { finishing = true; onLimit(); } }, maxSeconds * 1000);
      } catch (error) { await close(); throw error; }
    },
  };
}
