// Plays a stream of raw 16kHz pcm_s16le frames via Web Audio

export class PcmPlayer {
  private ctx = new AudioContext()
  private nextTime = 0

  async resume() {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  play(buf: ArrayBuffer) {
    const i16 = new Int16Array(buf)
    if (i16.length === 0) return
    const f32 = new Float32Array(i16.length)
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768
    const audioBuf = this.ctx.createBuffer(1, f32.length, 16000)
    audioBuf.copyToChannel(f32, 0)
    const src = this.ctx.createBufferSource()
    src.buffer = audioBuf
    src.connect(this.ctx.destination)
    const t = Math.max(this.ctx.currentTime + 0.06, this.nextTime)
    src.start(t)
    this.nextTime = t + audioBuf.duration
  }

  close() {
    void this.ctx.close()
  }
}
