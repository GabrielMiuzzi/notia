import type { Modal } from "../platform/inkmathPlatform";

type InkMathModalTone = "default" | "page-setup" | "inkmath" | "confirm" | "debug";
type InkMathModalSize = "sm" | "md" | "lg" | "xl";

type InkMathModalEngineOptions = {
	tone?: InkMathModalTone;
	size?: InkMathModalSize;
};

const HOST_BASE_CLASS = "inkmath-modal-engine-host";
const PANEL_BASE_CLASS = "inkmath-modal-engine-panel";
const BACKDROP_BASE_CLASS = "inkmath-modal-engine-backdrop";
const NOTIA_PANEL_BASE_CLASS = "notia-modal-engine-panel";
const NOTIA_BACKDROP_BASE_CLASS = "notia-modal-engine-backdrop";
const NOTIA_SIZE_BASE_CLASS = "notia-modal-engine-panel--";
const MODAL_ENGINE_Z_INDEX = "2147483000";

const resolveTone = (tone?: InkMathModalTone): InkMathModalTone => tone ?? "default";
const resolveSize = (size?: InkMathModalSize): InkMathModalSize => size ?? "md";

export const attachInkMathModalEngine = (
	modal: Modal,
	options: InkMathModalEngineOptions = {}
): (() => void) => {
	const tone = resolveTone(options.tone);
	const size = resolveSize(options.size);
	const toneClass = `${PANEL_BASE_CLASS}--tone-${tone}`;
	const sizeClass = `${PANEL_BASE_CLASS}--size-${size}`;
	const notiaSizeClass = `${NOTIA_SIZE_BASE_CLASS}${size}`;
	modal.modalEl.addClass(HOST_BASE_CLASS);
	modal.modalEl.style.zIndex = MODAL_ENGINE_Z_INDEX;

	const backdrop = modal.modalEl.querySelector<HTMLElement>(".modal-bg");
	const panel = modal.modalEl.querySelector<HTMLElement>(".modal");
	if (backdrop) {
		backdrop.classList.add(BACKDROP_BASE_CLASS, NOTIA_BACKDROP_BASE_CLASS);
	}
	if (panel) {
		panel.classList.add(PANEL_BASE_CLASS, NOTIA_PANEL_BASE_CLASS, toneClass, sizeClass, notiaSizeClass);
	}

	return () => {
		modal.modalEl.removeClass(HOST_BASE_CLASS);
		if (backdrop) {
			backdrop.classList.remove(BACKDROP_BASE_CLASS, NOTIA_BACKDROP_BASE_CLASS);
		}
		if (panel) {
			panel.classList.remove(
				PANEL_BASE_CLASS,
				NOTIA_PANEL_BASE_CLASS,
				toneClass,
				sizeClass,
				notiaSizeClass
			);
		}
	};
};
