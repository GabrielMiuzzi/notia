type RuntimeDevice = 'Windows' | 'macOS' | 'Linux' | 'Android' | 'Unknown'

declare global {
  interface Window {
    __NOTIA_PUBLISHED_TASK_MANAGER__?: boolean
  }
}

export function getRuntimeDevice(): RuntimeDevice {
  if (window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
    return 'Windows'
  }
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
