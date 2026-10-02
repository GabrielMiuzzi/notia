import { useNarrowContainer } from '../../../hooks/useNarrowContainer'

/** Ancho de Gimnasio por debajo del cual se usa la versión celular del diseño. */
export const PHONE_LAYOUT_MAX_WIDTH = 600

/** Si el espacio de Gimnasio (no la ventana) es de celular. */
export function usePhoneLayout(element: HTMLElement | null): boolean {
  return useNarrowContainer(element, PHONE_LAYOUT_MAX_WIDTH)
}
