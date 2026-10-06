// NotIA in Microsoft Teams (web): notices who is speaking in the call and
// sends it to the background worker, which passes it to Notia while Meeting
// records. Two sources, the first that works wins:
// - the live captions (Teams shows the name of whoever speaks with each
//   caption): exact names, about a second late;
// - the speaking outline of the participant tiles, when captions are off.
// Teams changes its markup often: every selector lives in TEAMS below.

(() => {
  if (window.__notiaCall) return
  window.__notiaCall = true

  const TEAMS = {
    captions: {
      // New Teams first, then the classic one.
      container: ['[data-tid="closed-caption-v2-window-wrapper"]', '[data-tid="closed-caption-renderer-wrapper"]', '[data-tid="closed-captions-renderer"]'],
      entry: ['.fui-ChatMessageCompact', '[data-tid="closed-caption-message"]', '.ui-chat__item'],
      author: ['[data-tid="author"]', '.ui-chat__message__author'],
      text: ['[data-tid="closed-caption-text"]'],
    },
    tiles: {
      tile: ['[data-cid="calling-participant-stream"]', '[data-tid="video-tile"]'],
      speaking: ['[data-tid="voice-level-stream-outline"]'],
      name: ['[data-tid="participant-name"]', '[data-tid="display-name"]', '[data-tid="participant-tile-name"]'],
    },
    // Present only while in a call.
    inCall: ['[data-tid="hangup-main-btn"]', '[data-tid="call-hangup"]', '#hangup-button', '[data-tid="call-duration"]'],
  }

  // Captions appear about this long after the words were said.
  const CAPTION_LAG_MS = 1200
  // Silence after which a person's interval closes.
  const SPEECH_GAP_MS = 1500
  const FLUSH_MS = 1000
  const TILE_SCAN_MS = 300
  const STATE_MS = 3000
  // When every tile looks like it is speaking for this long, the outline is
  // not a speaking signal in this version of Teams: the tiles are ignored.
  const TILES_NOISE_MS = 5000

  const first = (scope, selectors) => {
    for (const selector of selectors) {
      const found = scope.querySelector(selector)
      if (found) return found
    }
    return null
  }
  const all = (scope, selectors) => {
    for (const selector of selectors) {
      const found = scope.querySelectorAll(selector)
      if (found.length) return [...found]
    }
    return []
  }
  const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60)

  // ---- Who is speaking -------------------------------------------------

  /** name → { start, last } of the interval being heard. */
  const speaking = new Map()
  let source = null
  let lastSpeaker = ''

  function heard(name, at, from) {
    const who = clean(name)
    if (!who) return
    // Captions name people exactly: once they show up they replace the tiles.
    if (from === 'captions') source = 'captions'
    else source = source || from
    if (from !== source) return
    lastSpeaker = who
    const current = speaking.get(who)
    if (current && at - current.last <= SPEECH_GAP_MS) current.last = Math.max(current.last, at)
    else speaking.set(who, { start: at, last: at, sentLast: 0 })
  }

  /** Sends the intervals that grew; forgets those that closed. */
  function flush() {
    const now = Date.now()
    const items = []
    for (const [name, interval] of speaking) {
      if (interval.last > interval.sentLast) {
        items.push({ name, startedAt: interval.start, endedAt: interval.last })
        interval.sentLast = interval.last
      }
      if (now - interval.last > SPEECH_GAP_MS * 2) speaking.delete(name)
    }
    if (items.length) chrome.runtime.sendMessage({ type: 'speech', items }).catch(() => undefined)
  }

  // ---- Captions --------------------------------------------------------

  /** Text last seen in each caption entry. */
  const seenText = new WeakMap()

  function readCaptions() {
    const container = first(document, TEAMS.captions.container)
    if (!container) return
    const at = Date.now() - CAPTION_LAG_MS
    let author = ''
    for (const entry of all(container, TEAMS.captions.entry)) {
      // Consecutive captions of one person may show the name only once.
      author = clean(first(entry, TEAMS.captions.author)?.textContent) || author
      const text = clean(first(entry, TEAMS.captions.text)?.textContent || entry.textContent)
      if (!text || seenText.get(entry) === text) continue
      seenText.set(entry, text)
      heard(author, at, 'captions')
    }
  }

  let captionTimer = 0
  new MutationObserver(() => {
    if (captionTimer) return
    captionTimer = setTimeout(() => {
      captionTimer = 0
      readCaptions()
    }, 150)
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true })

  // ---- Speaking outline of the tiles -------------------------------------

  function outlineSpeaks(outline) {
    if (outline.dataset.isSpeaking === 'true') return true
    const style = getComputedStyle(outline)
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.1) return false
    return style.boxShadow !== 'none' || parseFloat(style.borderTopWidth) > 0 || style.outlineStyle !== 'none'
  }

  function tileName(tile) {
    const named = clean(first(tile, TEAMS.tiles.name)?.textContent)
    if (named) return named
    // «Ana Pérez, cámara activada…»: the name comes first.
    return clean((tile.getAttribute('aria-label') || '').split(',')[0])
  }

  let tilesNoisySince = 0
  let tilesIgnored = false

  function scanTiles() {
    if (source === 'captions' || tilesIgnored) return
    const tiles = all(document, TEAMS.tiles.tile)
    if (tiles.length === 0) return
    const now = Date.now()
    const talking = tiles.filter((tile) => {
      const outline = first(tile, TEAMS.tiles.speaking)
      return outline ? outlineSpeaks(outline) : false
    })
    if (tiles.length > 1 && talking.length === tiles.length) {
      tilesNoisySince = tilesNoisySince || now
      if (now - tilesNoisySince > TILES_NOISE_MS) tilesIgnored = true
      return
    }
    tilesNoisySince = 0
    for (const tile of talking) heard(tileName(tile), now, 'tiles')
  }

  // ---- The call ---------------------------------------------------------

  const inCall = () => Boolean(first(document, TEAMS.inCall) || first(document, TEAMS.captions.container) || first(document, TEAMS.tiles.tile))

  let wasInCall = false
  function reportState() {
    const now = inCall()
    if (!now && !wasInCall) return
    wasInCall = now
    chrome.runtime
      .sendMessage({ type: 'call-state', inCall: now, source, speaker: lastSpeaker })
      .catch(() => undefined)
    if (!now) {
      speaking.clear()
      source = null
      tilesIgnored = false
    }
  }

  setInterval(scanTiles, TILE_SCAN_MS)
  setInterval(flush, FLUSH_MS)
  setInterval(reportState, STATE_MS)
})()
