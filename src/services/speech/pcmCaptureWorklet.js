// Audio worklet of the remote dictation: forwards each block of the first
// channel to the page. Served as a file of the bundle (same origin), so the
// content security policy does not have to allow blob: scripts.
class NotiaPcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}

registerProcessor('notia-pcm-capture', NotiaPcmCapture)
