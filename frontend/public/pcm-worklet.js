// AudioWorklet: mono float32 @ context rate -> 16kHz int16 PCM chunks (~100ms)
class PcmDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.targetRate = (options.processorOptions && options.processorOptions.targetRate) || 16000
    this.ratio = sampleRate / this.targetRate
    this.inputBuffer = []
    this.inputLength = 0
    // emit ~100ms of source audio per chunk
    this.chunkSize = Math.round(sampleRate * 0.1)
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    this.inputBuffer.push(new Float32Array(channel))
    this.inputLength += channel.length
    if (this.inputLength >= this.chunkSize) {
      const merged = new Float32Array(this.inputLength)
      let offset = 0
      for (const block of this.inputBuffer) {
        merged.set(block, offset)
        offset += block.length
      }
      this.inputBuffer = []
      this.inputLength = 0

      const outLength = Math.floor(merged.length / this.ratio)
      const out = new Int16Array(outLength)
      for (let i = 0; i < outLength; i++) {
        // linear interpolation resample
        const pos = i * this.ratio
        const i0 = Math.floor(pos)
        const i1 = Math.min(i0 + 1, merged.length - 1)
        const sample = merged[i0] + (merged[i1] - merged[i0]) * (pos - i0)
        const clamped = Math.max(-1, Math.min(1, sample))
        out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
      }
      this.port.postMessage(out.buffer, [out.buffer])
    }
    return true
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler)
