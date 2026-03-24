// @ts-nocheck
import { App, Modal } from "../../engines/platform/inkdocPlatform";
import type { InkDocDocumentDecorations } from "../types";
import { attachInkDocModalEngine } from "./modalEngine";
import {
	INKDOC_DOCUMENT_DECORATION_MAX_HEIGHT_PERCENT,
	INKDOC_DOCUMENT_DECORATION_MIN_HEIGHT_PERCENT
} from "./documentDecorations";

type DocumentDecorationsModalValue = Pick<
	InkDocDocumentDecorations,
	"headerEnabled" | "footerEnabled" | "firstPageWithoutDecorations" | "headerHeightPercent" | "footerHeightPercent"
> & {
	headerHeightMm: number;
	footerHeightMm: number;
};

export class DocumentDecorationsModal extends Modal {
	private current: DocumentDecorationsModalValue;
	private onApply: (next: DocumentDecorationsModalValue) => void;
	private detachShell: (() => void) | null = null;

	constructor(
		app: App,
		current: DocumentDecorationsModalValue,
		onApply: (next: DocumentDecorationsModalValue) => void
	) {
		super(app);
		this.current = current;
		this.onApply = onApply;
	}

	onOpen(): void {
		this.detachShell = attachInkDocModalEngine(this, { tone: "page-setup", size: "md" });
		this.titleEl.setText("Configuración del documento");
		this.contentEl.addClass("inkdoc-document-settings-modal");
		this.contentEl.createEl("p", {
			cls: "inkdoc-background-intro",
			text: "Activa encabezado y pie repetidos para todas las páginas del documento."
		});

		const form = this.contentEl.createDiv({ cls: "inkdoc-document-settings-form" });
		const headerToggle = this.createCheckboxField(
			form,
			"Encabezado de página",
			"header-enabled",
			this.current.headerEnabled === true
		);
		const footerToggle = this.createCheckboxField(
			form,
			"Pie de página",
			"footer-enabled",
			this.current.footerEnabled === true
		);
		const firstPageToggle = this.createCheckboxField(
			form,
			"Primer página sin decoraciones",
			"first-page-clean",
			this.current.firstPageWithoutDecorations === true
		);
		const headerHeightInput = this.createHeightField(
			form,
			"Altura de encabezado",
			"header-height-percent",
			this.current.headerHeightPercent ?? 6,
			this.current.headerHeightMm
		);
		const footerHeightInput = this.createHeightField(
			form,
			"Altura de pie",
			"footer-height-percent",
			this.current.footerHeightPercent ?? 6,
			this.current.footerHeightMm
		);

		const actions = this.contentEl.createDiv({ cls: "inkdoc-document-settings-actions" });
		const cancelButton = actions.createEl("button", {
			cls: "inkdoc-document-settings-button",
			text: "Cancelar",
			attr: { type: "button" }
		});
		const applyButton = actions.createEl("button", {
			cls: "inkdoc-document-settings-button is-primary",
			text: "Aplicar",
			attr: { type: "button" }
		});

		cancelButton.addEventListener("click", () => this.close());
		applyButton.addEventListener("click", () => {
			this.onApply({
				headerEnabled: headerToggle.checked,
				footerEnabled: footerToggle.checked,
				firstPageWithoutDecorations: firstPageToggle.checked,
				headerHeightPercent: Number(headerHeightInput.value),
				footerHeightPercent: Number(footerHeightInput.value)
			});
			this.close();
		});
	}

	onClose(): void {
		this.detachShell?.();
		this.detachShell = null;
		this.contentEl.empty();
	}

	private createCheckboxField(
		container: HTMLDivElement,
		label: string,
		id: string,
		checked: boolean
	): HTMLInputElement {
		const row = container.createEl("label", {
			cls: "inkdoc-document-settings-option",
			attr: { for: id }
		});
		const input = row.createEl("input", {
			cls: "inkdoc-document-settings-checkbox",
			attr: { id, type: "checkbox" }
		});
		input.checked = checked;
		row.createEl("span", {
			cls: "inkdoc-document-settings-label",
			text: label
		});
		return input;
	}

	private createHeightField(
		container: HTMLDivElement,
		label: string,
		id: string,
		value: number,
		mmValue: number
	): HTMLInputElement {
		const row = container.createDiv({ cls: "inkdoc-document-settings-height" });
		const top = row.createDiv({ cls: "inkdoc-document-settings-height-top" });
		top.createEl("label", {
			cls: "inkdoc-document-settings-label",
			text: label,
			attr: { for: id }
		});
		top.createEl("span", {
			cls: "inkdoc-document-settings-height-meta",
			text: `${mmValue.toFixed(1)} mm en el tamaño actual`
		});
		const input = row.createEl("input", {
			cls: "inkdoc-document-settings-number",
			attr: {
				id,
				type: "number",
				min: String(INKDOC_DOCUMENT_DECORATION_MIN_HEIGHT_PERCENT),
				max: String(INKDOC_DOCUMENT_DECORATION_MAX_HEIGHT_PERCENT),
				step: "0.5"
			}
		});
		input.value = String(value);
		row.createEl("span", {
			cls: "inkdoc-document-settings-height-unit",
			text: "% de la altura de página"
		});
		return input;
	}
}
