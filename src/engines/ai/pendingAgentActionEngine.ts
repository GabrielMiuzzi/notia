/** Only inspect the assistant's own prose, not quoted text or generated code. */
export function hasPendingAgentAction(answer: string): boolean {
  const prose = answer
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g, '')
    .split('\n').filter((line) => !/^\s*>/.test(line)).join('\n')
    .replace(/`[^`]*`/g, '')
    .replace(/\*\*|__/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const action = '(?:insertar|agregar|anadir|reemplazar|modificar|actualizar|guardar|crear|eliminar|borrar|mover|renombrar|registrar|aplicar|buscar|consultar|leer|revisar|analizar)'
  const future = '(?:insertare|agregare|anadire|reemplazare|modificare|actualizare|guardare|creare|eliminare|borrare|movere|renombrare|registrare|aplicare|buscare|consultare|leere|revisare|analizare)'
  const sentence = '(?:^|[.!?:;\\n])\\s*(?:[-*]\\s*)?(?:(?:ahora|a continuacion|primero|luego|despues)[,:]?\\s+)?(?:yo\\s+)?'
  return new RegExp(`${sentence}(?:voy a\\s+${action}\\b|(?:comenzare|empezare|procedere|continuare)\\s+(?:por|a)\\s+${action}\\b|${future}\\b)`, 'm').test(prose)
}
