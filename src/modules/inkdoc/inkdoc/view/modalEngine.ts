// @ts-nocheck
import type { Modal } from "../../engines/platform/inkdocPlatform";

type InkDocModalTone = "default" | "page-setup" | "inkmath" | "confirm" | "debug";
type InkDocModalSize = "sm" | "md" | "lg" | "xl";

type InkDocModalEngineOptions = {
	tone?: InkDocModalTone;
	size?: InkDocModalSize;
};

const HOST_BASE_CLASS = "inkdoc-modal-engine-host";
const PANEL_BASE_CLASS = "inkdoc-modal-engine-panel";
const BACKDROP_BASE_CLASS = "inkdoc-modal-engine-backdrop";
const NOTIA_PANEL_BASE_CLASS = "notia-modal-engine-panel";
const NOTIA_BACKDROP_BASE_CLASS = "notia-modal-engine-backdrop";
const NOTIA_SIZE_BASE_CLASS = "notia-modal-engine-panel--";
const MODAL_ENGINE_Z_INDEX = "2147483000";

const resolveTone = (tone?: InkDocModalTone): InkDocModalTone => tone ?? "default";
const resolveSize = (size?: InkDocModalSize): InkDocModalSize => size ?? "md";

export const attachInkDocModalEngine = (
	modal: Modal,
	options: InkDocModalEngineOptions = {}
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
