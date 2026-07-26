// Mic capture -> 16kHz mono pcm_s16le chunks via AudioWorklet

export interface AudioCapture {
  stop: () => void
}

export async function startAudioCapture(
  onChunk: (pcm: ArrayBuffer) => void,
): Promise<AudioCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  const ctx = new AudioContext()
  await ctx.audioWorklet.addModule('/pcm-worklet.js')
  const source = ctx.createMediaStreamSource(stream)
  const worklet = new AudioWorkletNode(ctx, 'pcm-downsampler', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: { targetRate: 16000 },
  })
  worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data)
  source.connect(worklet)

  // iOS/Safari can start suspended until a user gesture resumes it
  if (ctx.state === 'suspended') await ctx.resume()

  return {
    stop() {
      worklet.port.onmessage = null
      source.disconnect()
      worklet.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    },
  }
}
