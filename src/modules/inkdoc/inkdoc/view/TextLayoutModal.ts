// @ts-nocheck
import { App, Modal } from "../../engines/platform/inkdocPlatform";
import type { InkDocTextLayoutPadding } from "../types";
import { attachInkDocModalEngine } from "./modalEngine";
import {
	DEFAULT_TEXT_LAYOUT_PADDING,
	resolveInkDocTextLayoutPadding
} from "./textLayout";

const TEXT_LAYOUT_PRESETS: Array<{ label: string; value: InkDocTextLayoutPadding }> = [
	{
		label: "Compacto",
		value: { top: 16, right: 16, bottom: 24, left: 16 }
	},
	{
		label: "Normal",
		value: { ...DEFAULT_TEXT_LAYOUT_PADDING }
	},
	{
		label: "Margen izquierdo",
		value: { top: 24, right: 24, bottom: 38, left: 56 }
	}
];

export class TextLayoutModal extends Modal {
	private readonly current: InkDocTextLayoutPadding;
	private readonly onApply: (next: InkDocTextLayoutPadding) => void;
	private detachShell: (() => void) | null = null;

	constructor(
		app: App,
		current: InkDocTextLayoutPadding,
		onApply: (next: InkDocTextLayoutPadding) => void
	) {
		super(app);
		this.current = resolveInkDocTextLayoutPadding(current);
		this.onApply = onApply;
	}

	onOpen(): void {
		this.detachShell = attachInkDocModalEngine(this, { tone: "page-setup", size: "md" });
		this.titleEl.setText("Espaciado de texto");
		this.contentEl.addClass("inkdoc-text-layout-modal");
		this.contentEl.createEl("p", {
			cls: "inkdoc-background-intro",
			text: "Ajusta el padding de contenido para la capa de texto (Milkdown)."
		});

		const presets = this.contentEl.createDiv({ cls: "inkdoc-text-layout-presets" });
		const form = this.contentEl.createDiv({ cls: "inkdoc-text-layout-grid" });
		const topInput = this.createPaddingField(form, "Superior", this.current.top);
		const rightInput = this.createPaddingField(form, "Derecho", this.current.right);
		const bottomInput = this.createPaddingField(form, "Inferior", this.current.bottom);
		const leftInput = this.createPaddingField(form, "Izquierdo", this.current.left);
		const setInputs = (padding: InkDocTextLayoutPadding): void => {
			topInput.value = String(padding.top);
			rightInput.value = String(padding.right);
			bottomInput.value = String(padding.bottom);
			leftInput.value = String(padding.left);
		};
		TEXT_LAYOUT_PRESETS.forEach((preset) => {
			const button = presets.createEl("button", {
				cls: "inkdoc-text-layout-preset",
				text: preset.label
			});
			button.addEventListener("click", () => {
				setInputs(preset.value);
			});
		});

		const actions = this.contentEl.createDiv({ cls: "inkdoc-text-layout-actions" });
		const resetButton = actions.createEl("button", {
			cls: "inkdoc-size-option",
			text: "Reset"
		});
		const cancelButton = actions.createEl("button", {
			cls: "inkdoc-size-option",
			text: "Cancelar"
		});
		const applyButton = actions.createEl("button", {
			cls: "inkdoc-size-option is-selected",
			text: "Aplicar"
		});

		resetButton.addEventListener("click", () => {
			setInputs(DEFAULT_TEXT_LAYOUT_PADDING);
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});
		applyButton.addEventListener("click", () => {
			const next = resolveInkDocTextLayoutPadding({
				top: Number(topInput.value),
				right: Number(rightInput.value),
				bottom: Number(bottomInput.value),
				left: Number(leftInput.value)
			});
			this.onApply(next);
			this.close();
		});
	}

	onClose(): void {
		this.detachShell?.();
		this.detachShell = null;
		this.contentEl.empty();
	}

	private createPaddingField(
		parent: HTMLDivElement,
		label: string,
		value: number
	): HTMLInputElement {
		const row = parent.createDiv({ cls: "inkdoc-text-layout-field" });
		row.createEl("span", { cls: "inkdoc-text-layout-label", text: label });
		const input = row.createEl("input", { cls: "inkdoc-text-layout-input", type: "number" });
		input.min = "0";
		input.max = "240";
		input.step = "1";
		input.value = String(value);
		return input;
	}
}
