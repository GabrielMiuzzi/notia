// @ts-nocheck
import { App, Modal } from "../../engines/platform/inkdocPlatform";
import type { InkDocPageBackground } from "../types";
import { PAGE_BACKGROUND_OPTIONS } from "./backgrounds";
import { attachInkDocModalEngine } from "./modalEngine";

export class PageBackgroundModal extends Modal {
	private current: InkDocPageBackground;
	private onSelect: (next: InkDocPageBackground) => void;
	private detachShell: (() => void) | null = null;

	constructor(
		app: App,
		current: InkDocPageBackground,
		onSelect: (next: InkDocPageBackground) => void
	) {
		super(app);
		this.current = current;
		this.onSelect = onSelect;
	}

	onOpen(): void {
		this.detachShell = attachInkDocModalEngine(this, { tone: "page-setup", size: "xl" });
		this.titleEl.setText("Fondo de página");
		this.contentEl.addClass("inkdoc-background-modal");
		const intro = this.contentEl.createEl("p", {
			cls: "inkdoc-background-intro",
			text: "Selecciona el tipo de fondo para esta página."
		});
		intro.setAttr("role", "note");

		const list = this.contentEl.createDiv({ cls: "inkdoc-background-options" });
		for (const option of PAGE_BACKGROUND_OPTIONS) {
			const card = list.createEl("button", {
				cls: "inkdoc-background-card",
				attr: { "aria-label": option.label, title: option.label }
			});
			if (option.id === this.current) {
				card.classList.add("is-selected");
			}
			const preview = card.createDiv({ cls: "inkdoc-background-preview" });
			preview.dataset.inkdocBackground = option.id;
			const title = card.createDiv({ cls: "inkdoc-background-card-title" });
			title.textContent = option.label;

			card.addEventListener("click", () => {
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
}
