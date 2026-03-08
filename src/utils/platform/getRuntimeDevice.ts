type RuntimeDevice = 'Windows' | 'macOS' | 'Linux' | 'Android' | 'Unknown'

export function getRuntimeDevice(): RuntimeDevice {
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('android')) {
    return 'Android'
  }

  const platform = navigator.platform.toLowerCase()
  if (platform.includes('win')) {
    return 'Windows'
  }
  if (platform.includes('mac')) {
    return 'macOS'
  }
  if (platform.includes('linux')) {
    return 'Linux'
  }

  return 'Unknown'
}
