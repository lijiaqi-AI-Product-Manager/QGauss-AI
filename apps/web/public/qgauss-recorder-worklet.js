/* Mono PCM capture. Nothing leaves this page until the user confirms transcription. */
class QGaussCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.block = new Float32Array(4096); this.used = 0; this.closed = false;
    this.port.onmessage = event => { if (event.data === 'finish') { this.flush(); this.closed = true; this.port.postMessage({ done: true }); } };
  }
  flush() { if (this.used) { const samples = this.block.slice(0, this.used); this.port.postMessage({ samples }, [samples.buffer]); this.used = 0; } }
  process(inputs) {
    if (this.closed) return false;
    const channels = inputs[0]; if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index++) {
      let sample = 0; for (const channel of channels) sample += channel[index] || 0;
      this.block[this.used++] = sample / channels.length; if (this.used === this.block.length) this.flush();
    }
    return true;
  }
}
registerProcessor('qgauss-capture', QGaussCapture);
