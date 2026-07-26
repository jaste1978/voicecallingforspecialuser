// Synthesized Indian-style double-ring (400+450Hz), looped while ringing.
// No audio asset needed; stops cleanly on accept/decline/end.

export class Ringtone {
  private ctx: AudioContext | null = null
  private timer: number | null = null

  start() {
    if (this.ctx) return
    try {
      const ctx = new AudioContext()
      this.ctx = ctx
      void ctx.resume()

      const ringOnce = () => {
        const t = ctx.currentTime + 0.05
        for (const offset of [0, 0.6]) {
          const gain = ctx.createGain()
          gain.gain.setValueAtTime(0.0001, t + offset)
          gain.gain.exponentialRampToValueAtTime(0.5, t + offset + 0.04)
          gain.gain.setValueAtTime(0.5, t + offset + 0.32)
          gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.4)
          gain.connect(ctx.destination)
          for (const freq of [400, 450]) {
            const osc = ctx.createOscillator()
            osc.frequency.value = freq
            osc.connect(gain)
            osc.start(t + offset)
            osc.stop(t + offset + 0.42)
          }
        }
      }

      ringOnce()
      this.timer = window.setInterval(ringOnce, 3000)
    } catch {
      // autoplay blocked — vibration still signals the call
      this.stop()
    }
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.ctx) {
      void this.ctx.close()
      this.ctx = null
    }
  }
}
