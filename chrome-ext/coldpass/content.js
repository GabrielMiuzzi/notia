// Notia ColdPass on web pages: finds sign-in fields, fills the credentials
// Notia has for this page, opens a menu with them and «Generar contraseña»
// when a password field is clicked, and, after a sign-in Notia does not
// know, asks whether to save it. Everything the extension draws lives in a
// closed shadow root so the page can neither style nor read it.

(() => {
  if (window.__notiaColdPass) return
  window.__notiaColdPass = true

  const USER_TYPES = new Set(['text', 'email', 'tel'])
  const USER_HINT = /user|usuario|email|e-mail|mail|login|account|cuenta|identifier|dni|documento/i
  const SCAN_DELAY_MS = 300
  const CAPTURE_REPEAT_MS = 4000
  const NOTICE_MS = 3200

  const send = (type, data = {}) =>
    chrome.runtime.sendMessage({ type, ...data }).catch(() => ({ error: 'La extensión se actualizó: recargá la página.' }))

  // ---- Fields ----------------------------------------------------------

  function isVisible(input) {
    if (!input.isConnected || input.disabled || input.readOnly) return false
    const box = input.getBoundingClientRect()
    if (box.width < 2 || box.height < 2) return false
    const style = getComputedStyle(input)
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
  }

  const passwordFields = (scope = document) =>
    [...scope.querySelectorAll('input[type="password"]')].filter(isVisible)

  const isUserLike = (input) =>
    USER_TYPES.has((input.getAttribute('type') || 'text').toLowerCase()) && isVisible(input)

  /** The user field that goes with a password field: a tagged one, else the last text field before it. */
  function userFieldFor(password) {
    const scope = password.form || document
    const candidates = [...scope.querySelectorAll('input')].filter(isUserLike)
    const tagged = candidates.find((input) => /username|email/.test(input.autocomplete || ''))
    if (tagged) return tagged
    let before = null
    for (const input of candidates) {
      if (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) before = input
    }
    return before
  }

  /** A user field of a first step that asks only for the user (no password yet). */
  function identifierField() {
    if (passwordFields().length > 0) return null
    return (
      [...document.querySelectorAll('input')].find(
        (input) =>
          isUserLike(input) &&
          (/username/.test(input.autocomplete || '') ||
            ((input.type === 'email' || USER_HINT.test(`${input.name} ${input.id}`)) && Boolean(input.form))),
      ) || null
    )
  }

  /** Sets a value as typing would, so pages built with React or Vue notice it. */
  function setValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function fill(credential, password) {
    const target = password || passwordFields()[0] || null
    const user = target ? userFieldFor(target) : identifierField()
    if (user && credential.username) setValue(user, credential.username)
    if (target) setValue(target, credential.password)
  }

  // ---- What Notia has for this page -----------------------------------

  let known = null // { locked } | { credentials } once asked
  let asking = null

  async function credentials(fresh = false) {
    if (known && !fresh && !known.locked) return known
    if (!asking) {
      asking = send('credentials').then((result) => {
        asking = null
        if (result?.data) known = { credentials: result.data.credentials || [] }
        else if (result?.locked) known = { locked: true }
        else known = { error: result?.unreachable ? 'No se pudo conectar con Notia.' : result?.error || 'ColdPass no respondió.' }
        return known
      })
    }
    return asking
  }

  const autofilled = new WeakSet()

  /**
   * A password field of a sign-in, where a saved password goes. A new or
   * repeated password (sign-up, change of password) is left for the generator,
   * as Chrome does.
   */
  const isSignInPassword = (field) =>
    !/new-password/.test(field.autocomplete || '') && passwordFields(field.form || document).length === 1

  /** Fills the first credential into empty sign-in fields once per field. */
  async function autofill() {
    const passwords = passwordFields().filter(isSignInPassword)
    const identifier = passwordFields().length === 0 ? identifierField() : null
    if (passwords.length === 0 && !identifier) return
    const pending = passwords.filter((field) => !autofilled.has(field) && !field.value)
    if (pending.length === 0 && (!identifier || autofilled.has(identifier) || identifier.value)) return
    const answer = await credentials()
    const first = answer.credentials?.[0]
    if (!first) {
      // Locked or nothing saved: do not ask again for these fields on every change of the page.
      for (const field of [...pending, identifier].filter(Boolean)) autofilled.add(field)
      return
    }
    if (identifier) {
      autofilled.add(identifier)
      if (!identifier.value && first.username) setValue(identifier, first.username)
      return
    }
    for (const password of pending) {
      autofilled.add(password)
      const user = userFieldFor(password)
      if (user && !user.value && first.username) setValue(user, first.username)
      if (!password.value) setValue(password, first.password)
    }
  }

  let scanTimer = 0
  const scheduleScan = () => {
    clearTimeout(scanTimer)
    scanTimer = setTimeout(() => void autofill(), SCAN_DELAY_MS)
  }

  // ---- Shadow root for everything drawn --------------------------------

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; }
    .menu, .card {
      position: fixed; z-index: 2147483647; min-width: 240px; max-width: 340px;
      background: #161D2E; color: #EDF0F5; border: 1px solid #29334A; border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); font-size: 14px; line-height: 1.35;
    }
    .menu { padding: 6px; display: flex; flex-direction: column; gap: 2px; }
    .head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 8px; color: #8892A6; font-size: 12px; }
    .mark { width: 18px; height: 18px; border-radius: 5px; background: #4FD1C5; color: #0F1420;
      display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; }
    button { all: unset; box-sizing: border-box; cursor: pointer; border-radius: 8px; }
    .item { display: flex; flex-direction: column; gap: 1px; min-height: 40px; padding: 8px 10px; }
    .item:hover, .item:focus-visible { background: #1B2438; }
    .item:focus-visible, .action:focus-visible { outline: 2px solid #4FD1C5; outline-offset: 1px; }
    .item strong { font-weight: 600; }
    .item span, .note { color: #8892A6; font-size: 12px; }
    .generate { flex-direction: row; align-items: center; gap: 10px; color: #4FD1C5; font-weight: 600; }
    .note { padding: 8px 10px; }
    .line { height: 1px; background: #29334A; margin: 4px 2px; }
    .card { top: 16px; right: 16px; width: 320px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .card h2 { margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .card p { margin: 0; color: #8892A6; font-size: 13px; overflow-wrap: anywhere; }
    .card p b { color: #EDF0F5; font-weight: 600; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
    .action { min-height: 36px; padding: 0 14px; display: inline-flex; align-items: center; font-weight: 600; font-size: 13px; }
    .primary { background: #4FD1C5; color: #0F1420; }
    .primary:hover { background: #72DDD3; }
    .ghost { border: 1px solid #29334A; color: #EDF0F5; }
    .ghost:hover { background: #1B2438; }
    .action:disabled { opacity: 0.6; cursor: default; }
  `

  let root = null
  let shadowHost = null
  /** Whether an event happened inside what the extension draws (the root is closed: only its host shows). */
  const insideExtension = (event) => Boolean(shadowHost) && event.composedPath().includes(shadowHost)

  function shadow() {
    if (shadowHost?.isConnected) return root
    const host = document.createElement('notia-coldpass')
    shadowHost = host
    root = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = STYLE
    root.append(style)
    document.documentElement.append(host)
    return root
  }

  function element(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function heading(text) {
    const head = element('div', 'head')
    head.append(element('span', 'mark', 'N'), element('span', '', text))
    return head
  }

  // ---- Menu of a sign-in field -----------------------------------------

  let menu = null
  let menuField = null
  let dismissedField = null

  function closeMenu() {
    menu?.remove()
    menu = null
    menuField = null
  }

  function placeMenu() {
    if (!menu || !menuField?.isConnected) return closeMenu()
    const box = menuField.getBoundingClientRect()
    const width = Math.max(240, Math.min(340, box.width))
    const left = Math.min(Math.max(8, box.left), window.innerWidth - width - 8)
    const below = box.bottom + 6
    const height = menu.offsetHeight
    const top = below + height > window.innerHeight - 8 && box.top - height - 6 > 8 ? box.top - height - 6 : below
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    menu.style.width = `${width}px`
  }

  async function openMenu(field) {
    const isPassword = field.type === 'password'
    const password = isPassword ? field : passwordFields(field.form || document)[0] || null
    closeMenu()
    menuField = field
    menu = element('div', 'menu')
    menu.setAttribute('role', 'menu')
    menu.addEventListener('pointerdown', (event) => event.preventDefault())
    menu.append(heading('ColdPass'))
    shadow().append(menu)
    placeMenu()

    const answer = await credentials(true)
    if (menuField !== field) return
    if (answer.locked) {
      menu.append(element('div', 'note', 'ColdPass está bloqueado. Desbloquealo desde el ícono de Notia ColdPass.'))
    } else if (answer.error) {
      menu.append(element('div', 'note', answer.error))
    } else {
      for (const credential of answer.credentials) {
        const item = element('button', 'item')
        item.setAttribute('role', 'menuitem')
        item.append(element('strong', '', credential.username || 'Sin usuario'), element('span', '', credential.name))
        item.addEventListener('click', () => {
          fill(credential, password)
          closeMenu()
        })
        menu.append(item)
      }
      if (isPassword) {
        if (answer.credentials.length > 0) menu.append(element('div', 'line'))
        const generate = element('button', 'item generate', 'Generar contraseña')
        generate.setAttribute('role', 'menuitem')
        generate.addEventListener('click', () => void generateInto(field))
        menu.append(generate)
      }
      if (!isPassword && answer.credentials.length === 0) {
        menu.append(element('div', 'note', 'ColdPass no tiene credenciales para este sitio.'))
      }
    }
    placeMenu()
  }

  async function generateInto(field) {
    const result = await send('generate')
    closeMenu()
    if (!result?.data?.password) {
      notice(result?.locked ? 'ColdPass está bloqueado.' : result?.error || 'No se pudo generar la contraseña.')
      return
    }
    // The new password and its confirmation: the form's empty or new-password fields.
    const others = passwordFields(field.form || document).filter(
      (other) => !other.value || /new-password/.test(other.autocomplete || ''),
    )
    const targets = new Set([field, ...others])
    for (const target of targets) setValue(target, result.data.password)
    notice('Contraseña generada con ColdPass. Al enviar el formulario te va a ofrecer guardarla.')
  }

  const menuFieldFor = (target) => {
    if (!(target instanceof HTMLInputElement)) return null
    if (target.type === 'password') return isVisible(target) ? target : null
    if (!isUserLike(target)) return null
    const password = passwordFields(target.form || document)[0]
    if (password && userFieldFor(password) === target) return target
    return identifierField() === target ? target : null
  }

  document.addEventListener(
    'click',
    (event) => {
      const field = menuFieldFor(event.composedPath()[0])
      if (!field || field === menuField) return
      dismissedField = null
      void openMenu(field)
    },
    true,
  )
  document.addEventListener(
    'focusin',
    (event) => {
      const field = menuFieldFor(event.target)
      if (field && field !== menuField && field !== dismissedField && field.type === 'password') void openMenu(field)
    },
    true,
  )
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (menu && !insideExtension(event) && event.composedPath()[0] !== menuField) closeMenu()
    },
    true,
  )
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && menu) {
        dismissedField = menuField
        closeMenu()
      }
    },
    true,
  )
  document.addEventListener(
    'input',
    (event) => {
      if (event.isTrusted && event.composedPath()[0] === menuField) closeMenu()
    },
    true,
  )
  window.addEventListener('scroll', placeMenu, true)
  window.addEventListener('resize', placeMenu)

  // ---- Sign-ins the person uses ----------------------------------------

  let lastCapture = { key: '', at: 0 }

  function capture(scope) {
    const password = passwordFields(scope).find((field) => field.value) || passwordFields().find((field) => field.value)
    if (!password) {
      const identifier = identifierField()
      if (identifier?.value) void send('identifier', { username: identifier.value })
      return
    }
    const username = userFieldFor(password)?.value || ''
    const key = `${username}\u0000${password.value}`
    if (key === lastCapture.key && Date.now() - lastCapture.at < CAPTURE_REPEAT_MS) return
    lastCapture = { key, at: Date.now() }
    void send('captured', { username, password: password.value })
  }

  document.addEventListener('submit', (event) => capture(event.target instanceof HTMLFormElement ? event.target : document), true)
  const SUBMIT_IN_FORM = 'button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]'
  const SIGN_IN_WORDS =
    /ingresar|iniciar|entrar|acceder|continuar|siguiente|registr|crear cuenta|log ?in|sign ?in|sign ?up|next|continue|submit|enviar|aceptar/i

  /** Whether a clicked control sends the sign-in: a form's submit, or a loose button that says so. */
  function sendsSignIn(button) {
    if (button.closest('form') && button.matches(SUBMIT_IN_FORM)) return true
    const label = `${button.textContent || ''} ${button.getAttribute('aria-label') || ''} ${button.value || ''}`
    return SIGN_IN_WORDS.test(label)
  }

  document.addEventListener(
    'click',
    (event) => {
      if (insideExtension(event)) return
      const button = event.composedPath().find(
        (node) => node instanceof HTMLElement && node.matches('button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]'),
      )
      if (button && sendsSignIn(button)) capture(button.closest('form') || document)
    },
    true,
  )
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && (event.target.type === 'password' || menuFieldFor(event.target))) {
        capture(event.target.form || document)
      }
    },
    true,
  )

  // ---- «¿Guardar en ColdPass?» -----------------------------------------

  let card = null
  let noticeTimer = 0

  function notice(text) {
    if (window.top !== window) return
    clearTimeout(noticeTimer)
    card?.remove()
    card = element('div', 'card')
    card.setAttribute('role', 'status')
    const title = element('h2')
    title.append(element('span', 'mark', 'N'), element('span', '', text))
    card.append(title)
    shadow().append(card)
    noticeTimer = setTimeout(() => {
      card?.remove()
      card = null
    }, NOTICE_MS)
  }

  async function showOffer() {
    if (window.top !== window) return
    const result = await send('pending-offer')
    const offer = result?.data
    if (!offer) return
    clearTimeout(noticeTimer)
    card?.remove()
    card = element('div', 'card')
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-label', 'Guardar en ColdPass')
    const title = element('h2')
    title.append(element('span', 'mark', 'N'), element('span', '', '¿Guardar en ColdPass?'))
    const site = element('p')
    site.append('Sitio: ', element('b', '', offer.host))
    const user = element('p')
    user.append('Usuario: ', element('b', '', offer.username || 'sin usuario'))
    const actions = element('div', 'actions')
    const later = element('button', 'action ghost', 'Ahora no')
    const save = element('button', 'action primary', 'Guardar')
    const answer = async (shouldSave) => {
      later.disabled = true
      save.disabled = true
      const reply = await send('answer-offer', { save: shouldSave })
      card?.remove()
      card = null
      if (!shouldSave) return
      if (reply?.data?.saved) {
        known = null
        notice('Guardada en ColdPass.')
      } else {
        notice(reply?.locked ? 'ColdPass está bloqueado: no se guardó.' : reply?.error || 'No se pudo guardar.')
      }
    }
    later.addEventListener('click', () => void answer(false))
    save.addEventListener('click', () => void answer(true))
    actions.append(later, save)
    card.append(title, site, user, actions)
    shadow().append(card)
    save.focus({ preventScroll: true })
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'show-offer') void showOffer()
  })

  // ---- Start -------------------------------------------------------------

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true })
  scheduleScan()
  void showOffer()
})()
