# Runtime nativo de voz

Este directorio reserva los runtimes empaquetados de sherpa-onnx. Los binarios no se
descargan durante la ejecución y no deben obtenerse desde rutas elegidas por el
frontend.

Para Windows x86_64, la distribución debe colocar aquí:

`windows-x86_64/sherpa-onnx-c-api.dll`

La DLL y todas sus dependencias deben corresponder a sherpa-onnx `1.13.4`. Antes de
incorporarlas al repositorio hay que verificar su origen, hashes, licencia
Apache-2.0, licencia de ONNX Runtime y funcionamiento en una instalación limpia.
La presencia de este README no habilita el micrófono.
