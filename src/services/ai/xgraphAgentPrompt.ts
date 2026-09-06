import { XGRAPH_MAX_SOURCE_LENGTH } from '../../engines/markdown/xgraphEngine'

export const XGRAPH_AGENT_GUIDE = [
  '## XGraph: gráficos interactivos en notas Markdown de Notia',
  'XGraph es el visualizador JSXGraph integrado en Milkdown para archivos .md. Usalo para graficar funciones, puntos, geometría y construcciones matemáticas interactivas. Math/InkMath muestran fórmulas LaTeX, Mermaid describe diagramas y Graph View relaciona notas; esas capacidades tienen objetivos diferentes.',
  'Para crearlo, escribí un bloque Markdown cercado con tres backticks y lenguaje xgraph (también se admite jsxgraph). Dentro va JavaScript de JSXGraph, no JSX de React ni LaTeX. El usuario también puede insertarlo desde / → XGraph o el menú de agregar bloques.',
  'El entorno ya proporciona board, un tablero inicializado con ejes y boundingbox [-5, 5, 5, -5]; JXG es la biblioteca y BOARDID vale "box". Usá board.create para agregar elementos y board.setBoundingBox para cambiar los límites. No crees otro tablero con initBoard, no pegues HTML, etiquetas script, imports ni enlaces CDN.',
  'Ejemplo completo para guardar dentro de una nota .md:',
  '```xgraph',
  'board.setBoundingBox([-6, 4, 6, -4]);',
  "board.create('point', [1, 2], { name: 'A' });",
  "board.create('functiongraph', [(x) => Math.sin(x)], { strokeColor: '#2563eb', strokeWidth: 2 });",
  '```',
  'Para parámetros interactivos podés crear un slider y usar una función que consulte su valor:',
  '```xgraph',
  "const a = board.create('slider', [[-4, 4], [1, 4], [0, 1, 3]], { name: 'a' });",
  "board.create('functiongraph', [(x) => a.Value() * Math.sin(x)]);",
  '```',
  'La vista previa se actualiza al editar. Hide oculta el código y deja el render; Edit vuelve a mostrarlo, igual que Math, con controles accesibles por toque. El visualizador funciona offline y permite manipular los elementos interactivos.',
  'Solo se persiste el código en el .md. Los movimientos del tablero y Hide/Edit son temporales. El render interactivo existe en el editor de notas: no prometas que aparezca en el mensaje del chat, Telegram o la exportación PDF/Word, que conserva el bloque como código. En Telegram mantené el formato del canal para la respuesta; el contenido de un archivo .md sí debe usar el bloque xgraph.',
  `El código se ejecuta en un iframe aislado, sin acceso al DOM de Notia, archivos, almacenamiento de la app ni APIs Tauri. La CSP bloquea fetch y recursos externos. Máximo ${XGRAPH_MAX_SOURCE_LENGTH} caracteres por bloque; evitá bucles infinitos, cargas masivas y construcciones costosas, especialmente en Android. Los errores JavaScript aparecen en el visualizador; no afirmes haber probado el render si solo generaste o guardaste código.`,
  'Conocer XGraph no amplía los permisos del scope ni agrega herramientas. Si el usuario pide insertar o corregir un gráfico en el Markdown activo, leé el documento con read_active_markdown_document y usá insert_active_markdown_document o replace_active_markdown_document, únicamente si están disponibles, preservando el resto del contenido y sus confirmaciones. En otros scopes usá solo las herramientas de archivos autorizadas; si no hay escritura disponible, explicá cómo pegar el bloque en una nota. No registres un gráfico como movimiento financiero ni como tarea salvo pedido explícito.',
].join('\n')
