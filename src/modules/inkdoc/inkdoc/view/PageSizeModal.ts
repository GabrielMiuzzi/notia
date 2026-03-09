// @ts-nocheck
import { App, Modal } from "../../engines/platform/inkdocPlatform";
import type { InkDocPageSize } from "../types";
import { PAGE_SIZE_OPTIONS } from "./pageSizes";
import { attachInkDocModalEngine } from "./modalEngine";

export class PageSizeModal extends Modal {
	private current: InkDocPageSize;
	private onSelect: (next: InkDocPageSize) => void;
	private detachShell: (() => void) | null = null;

	constructor(app: App, current: InkDocPageSize, onSelect: (next: InkDocPageSize) => void) {
		super(app);
		this.current = current;
		this.onSelect = onSelect;
	}

	onOpen(): void {
		this.detachShell = attachInkDocModalEngine(this, { tone: "page-setup", size: "lg" });
		this.titleEl.setText("Tamaño de página");
		this.contentEl.addClass("inkdoc-size-modal");
		this.contentEl.createEl("p", {
			cls: "inkdoc-background-intro",
			text: "Selecciona el tamaño para todas las páginas del documento."
		});
		this.buildNestedPreview();

		const options = this.contentEl.createDiv({ cls: "inkdoc-size-options" });
		for (const option of PAGE_SIZE_OPTIONS) {
			const button = options.createEl("button", {
				cls: "inkdoc-size-option",
				attr: { "aria-label": option.label, title: option.label }
			});
			button.classList.toggle("is-selected", option.id === this.current);
			button.createDiv({ cls: "inkdoc-size-option-title", text: option.label });
			button.createDiv({
				cls: "inkdoc-size-option-subtitle",
				text: `${option.widthMm} x ${option.heightMm} mm`
			});
			button.addEventListener("click", () => {
				this.onSelect(option.id);
				this.close();
			});
		}
	}

	onClose(): void {
		this.detachShell?.();
		this.detachShell = null;
		this.contentEl.empty();
	}

	private buildNestedPreview(): void {
		const visual = this.contentEl.createDiv({ cls: "inkdoc-size-visual" });
		const canvas = visual.createDiv({ cls: "inkdoc-size-visual-canvas" });
		const sorted = [...PAGE_SIZE_OPTIONS].sort(
			(a, b) => b.widthMm * b.heightMm - a.widthMm * a.heightMm
		);
		const maxWidth = Math.max(...sorted.map((entry) => entry.widthMm));
		const maxHeight = Math.max(...sorted.map((entry) => entry.heightMm));
		const pixelWidth = 260;
		const pixelHeight = 220;
		const scale = Math.min(pixelWidth / maxWidth, pixelHeight / maxHeight);
		for (const option of sorted) {
			const layer = canvas.createDiv({ cls: "inkdoc-size-layer" });
			layer.dataset.size = option.id;
			layer.classList.toggle("is-current", option.id === this.current);
			layer.style.width = `${option.widthMm * scale}px`;
			layer.style.height = `${option.heightMm * scale}px`;
			const label = layer.createDiv({ cls: "inkdoc-size-layer-label", text: option.label });
			label.setAttr("title", `${option.label} · ${option.widthMm} x ${option.heightMm} mm`);
		}
	}
}
