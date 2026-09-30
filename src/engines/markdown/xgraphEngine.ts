export const XGRAPH_MAX_SOURCE_LENGTH = 100_000

export function isXGraphLanguage(language: string): boolean {
  return ['xgraph', 'jsxgraph'].includes(language.trim().toLowerCase())
}

export function createXGraphPlaceholder(content: string): string {
  if (content.length > XGRAPH_MAX_SOURCE_LENGTH) {
    return '<p role="alert">XGraph: el código supera el límite de 100.000 caracteres.</p>'
  }
  return `<div class="notia-xgraph-host" data-xgraph-code="${encodeURIComponent(content)}">Cargando XGraph…</div>`
}

/**
 * Colors of the board, from the editor's theme tokens: the board sits in the
 * code block's well, as in the design canvas.
 */
export interface XGraphTheme {
  background: string
  text: string
  axis: string
  grid: string
  curve: string
  point: string
}

/** Only plain CSS color values reach the frame. */
function isCssColor(value: string): boolean {
  return /^[#\w\s(),.%-]{1,120}$/.test(value)
}

function safeTheme(theme: XGraphTheme | undefined): XGraphTheme | null {
  if (!theme) return null
  return Object.values(theme).every(isCssColor) ? theme : null
}

/** User JavaScript only runs in an opaque-origin sandbox, never in the app WebView. */
export function createXGraphDocument(content: string, runtime: string, stylesheet: string, nonce: string, theme?: XGraphTheme): string {
  const code = JSON.stringify(content).replace(/</g, '\\u003c')
  const colors = safeTheme(theme)
  const themeStyle = colors
    ? `html,body,.jxgbox{background:${colors.background};color:${colors.text}}.jxgbox{border-color:transparent;border-radius:0}`
    : ''
  const themeScript = colors
    ? `const theme = ${JSON.stringify(colors).replace(/</g, '\\u003c')};
  JXG.Options.text.strokeColor = theme.text;
  JXG.Options.axis.strokeColor = theme.axis;
  JXG.Options.axis.highlightStrokeColor = theme.axis;
  JXG.Options.ticks.strokeColor = theme.grid;
  JXG.Options.ticks.strokeOpacity = 1;
  JXG.Options.grid.strokeColor = theme.grid;
  JXG.Options.curve.strokeColor = theme.curve;
  JXG.Options.functiongraph.strokeColor = theme.curve;
  JXG.Options.point.strokeColor = theme.point;
  JXG.Options.point.fillColor = theme.point;
  JXG.Options.navbar.strokeColor = theme.text;
  JXG.Options.navbar.fillColor = 'transparent';
  const paint = (options, key, value) => { if (options && typeof options === 'object') options[key] = value; };
  paint(JXG.Options.ticks.label, 'strokeColor', theme.text);
  paint(JXG.Options.axis.label, 'strokeColor', theme.text);
  paint(JXG.Options.point.label, 'strokeColor', theme.text);
  paint(JXG.Options.slider.label, 'strokeColor', theme.text);
  paint(JXG.Options.slider.baseline, 'strokeColor', theme.grid);
  paint(JXG.Options.slider.highline, 'strokeColor', theme.curve);
  paint(JXG.Options.slider, 'strokeColor', theme.text);
  paint(JXG.Options.slider, 'fillColor', theme.text);
`
    : ''
  const runtimeIsAsset = isAssetUrl(runtime)
  const stylesheetIsAsset = isAssetUrl(stylesheet)
  const runtimeSource = runtimeIsAsset ? escapeHtmlAttribute(runtime) : ''
  const stylesheetSource = stylesheetIsAsset ? escapeHtmlAttribute(stylesheet) : ''
  const scriptPolicy = runtimeIsAsset ? ` ${escapeCspSource(runtime)}` : ''
  const stylePolicy = stylesheetIsAsset ? ` ${escapeCspSource(stylesheet)}` : ''
  const stylesheetMarkup = stylesheetIsAsset
    ? `<link rel="stylesheet" href="${stylesheetSource}">`
    : `<style>${stylesheet.replace(/<\/style/gi, '<\\/style')}</style>`
  const runtimeMarkup = runtimeIsAsset
    ? `<script nonce="${nonce}" src="${runtimeSource}"></script>`
    : `<script nonce="${nonce}">${runtime.replace(/<\/script/gi, '<\\/script')}</script>`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval'${scriptPolicy}; style-src 'unsafe-inline'${stylePolicy}; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'">
${stylesheetMarkup}
<style>
html,body{margin:0;width:100%;height:100%;font:14px system-ui;background:#fff;color:#17212b}
body{display:flex;flex-direction:column;overflow:hidden}
#box{width:100%;flex:1;min-height:0;position:relative;overflow:hidden;box-sizing:border-box}
#error{flex:none;max-height:50%;overflow:auto;box-sizing:border-box;padding:12px 16px 0;background:#fff4e5;color:#713f12;border-bottom:1px solid #d6a45b;overflow-wrap:anywhere}
#error[hidden]{display:none}#error-title{display:block;font-size:14px}#error p{margin:4px 0 0;line-height:1.45}
#error summary{display:flex;align-items:center;min-height:48px;cursor:pointer;font-weight:600;gap:8px}
#error summary::before{content:'▸'}#error details[open] summary::before{content:'▾'}#error summary:focus-visible{outline:2px solid #713f12;outline-offset:-2px}
#error-message{margin:0 0 12px;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.JXG_navigation_button{display:inline-flex;min-width:48px;min-height:48px;align-items:center;justify-content:center}
${themeStyle}
</style></head><body><section id="error" aria-label="Error de XGraph" hidden><div role="alert"><strong id="error-title">No se pudo completar el gráfico</strong><p>La vista puede estar incompleta. Corregí el código para volver a renderizar.</p></div><details><summary>Ver detalle del error</summary><pre id="error-message"></pre></details></section><div id="box" class="jxgbox" aria-label="Gráfico interactivo XGraph"></div>
${runtimeMarkup}
<script nonce="${nonce}">
const showError = (message) => { const error = document.getElementById('error'); document.getElementById('error-message').textContent = String(message); error.hidden = false; };
window.addEventListener('error', (event) => showError(event.message));
window.addEventListener('unhandledrejection', () => showError('Falló una operación del gráfico.'));
try {
  ${themeScript}const board = JXG.JSXGraph.initBoard('box', {boundingbox:[-5,5,5,-5],axis:true,showCopyright:false,showNavigation:true,resize:{enabled:true},pan:{needTwoFingers:true}});
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'notia-xgraph-export' || event.source !== window.parent) return;
    const root = board.renderer && board.renderer.svgRoot;
    window.parent.postMessage({ type: 'notia-xgraph-svg', id: String(event.data.id), svg: root ? new XMLSerializer().serializeToString(root) : '' }, '*');
  });
  new Function('board', 'JXG', 'BOARDID', ${code})(board, JXG, 'box');
} catch (error) { showError(error instanceof Error ? error.message : String(error)); }
</script></body></html>`
}

function isAssetUrl(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/(?!\*)|\.\.?\/)/i.test(value.trim())
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeCspSource(value: string): string {
  return value.replace(/[\s'";]/g, '')
}
