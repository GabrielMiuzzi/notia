// @ts-nocheck
import { App, Modal } from "../../engines/platform/inkdocPlatform";
import type { InkDocPageBackground, InkDocPageColors } from "../types";
import { PAGE_COLOR_PRESETS, resolvePageColors } from "./backgrounds";
import { attachInkDocModalEngine } from "./modalEngine";

type Rgb = { r: number; g: number; b: number };

const clampRgb = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const parseColorToRgb = (value: string): Rgb => {
	const rgbMatch = value.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
	if (rgbMatch) {
		return {
			r: clampRgb(Number(rgbMatch[1])),
			g: clampRgb(Number(rgbMatch[2])),
			b: clampRgb(Number(rgbMatch[3]))
		};
	}
	const hexMatch = value.match(/^#([0-9a-f]{6})$/i);
	if (hexMatch) {
		const hex = hexMatch[1] ?? "ffffff";
		return {
			r: parseInt(hex.slice(0, 2), 16),
			g: parseInt(hex.slice(2, 4), 16),
			b: parseInt(hex.slice(4, 6), 16)
		};
	}
	return { r: 255, g: 255, b: 255 };
};

const rgbToCss = (rgb: Rgb): string => `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

export class PagePaletteModal extends Modal {
	private background: InkDocPageBackground;
	private current: InkDocPageColors;
	private onSelect: (next: InkDocPageColors) => void;
	private detachShell: (() => void) | null = null;

	constructor(
		app: App,
		background: InkDocPageBackground,
		current: InkDocPageColors,
		onSelect: (next: InkDocPageColors) => void
	) {
		super(app);
		this.background = background;
		this.current = resolvePageColors(current);
		this.onSelect = onSelect;
	}

	onOpen(): void {
		this.detachShell = attachInkDocModalEngine(this, { tone: "page-setup", size: "xl" });
		this.titleEl.setText("Paleta de página");
		this.contentEl.addClass("inkdoc-palette-modal");
		this.contentEl.createEl("p", {
			cls: "inkdoc-background-intro",
			text: "Selecciona una paleta predeterminada o ajusta RGB manualmente."
		});

		const presets = this.contentEl.createDiv({ cls: "inkdoc-palette-presets" });
		for (const preset of PAGE_COLOR_PRESETS) {
			const card = presets.createEl("button", {
				cls: "inkdoc-palette-card",
				attr: { title: preset.label, "aria-label": preset.label }
			});
			const isSelected =
				this.current.background === preset.colors.background &&
				this.current.line === preset.colors.line &&
				this.current.margin === preset.colors.margin;
			card.classList.toggle("is-selected", isSelected);
			card.createDiv({ cls: "inkdoc-palette-card-title", text: preset.label });
			const body = card.createDiv({ cls: "inkdoc-palette-card-body" });
			createPresetColorSet(body, "Fondo", preset.colors.background);
			createPresetColorSet(body, "Líneas", preset.colors.line);
			createPresetColorSet(body, "Márgenes", preset.colors.margin);
			card.addEventListener("click", () => {
				this.onSelect(preset.colors);
				this.close();
			});
		}

		const manual = this.contentEl.createDiv({ cls: "inkdoc-palette-manual" });
		manual.createEl("h4", { cls: "inkdoc-palette-manual-title", text: "Ajuste manual RGB" });
		const manualGrid = manual.createDiv({ cls: "inkdoc-palette-manual-grid" });
		const rows = [
			{ key: "background" as const, label: "Fondo" },
			{ key: "line" as const, label: "Líneas" },
			{ key: "margin" as const, label: "Márgenes" }
		];
		for (const row of rows) {
			const rgb = parseColorToRgb(this.current[row.key]);
			const card = manualGrid.createDiv({ cls: "inkdoc-palette-rgb-card" });
			card.createDiv({ cls: "inkdoc-palette-rgb-card-title", text: row.label });
			const body = card.createDiv({ cls: "inkdoc-palette-rgb-card-body" });
			const preview = body.createDiv({ cls: "inkdoc-palette-rgb-preview" });
			const fields = card.createDiv({ cls: "inkdoc-palette-rgb-fields" });
			const r = createRgbInput(fields, "R", rgb.r);
			const g = createRgbInput(fields, "G", rgb.g);
			const b = createRgbInput(fields, "B", rgb.b);
			const update = () => {
				const value = rgbToCss({
					r: clampRgb(Number(r.value)),
					g: clampRgb(Number(g.value)),
					b: clampRgb(Number(b.value))
				});
				preview.style.background = value;
				this.current = { ...this.current, [row.key]: value };
			};
			r.addEventListener("input", update);
			g.addEventListener("input", update);
			b.addEventListener("input", update);
			update();
		}

		const actions = this.contentEl.createDiv({ cls: "inkdoc-palette-actions" });
		const applyButton = actions.createEl("button", {
			cls: "inkdoc-palette-action is-primary",
			text: "Aplicar"
		});
		const cancelButton = actions.createEl("button", {
			cls: "inkdoc-palette-action",
			text: "Cancelar"
		});
		applyButton.addEventListener("click", () => {
			this.onSelect(this.current);
			this.close();
		});
		cancelButton.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.detachShell?.();
		this.detachShell = null;
		this.contentEl.empty();
	}
}

const createRgbInput = (container: HTMLDivElement, label: string, value: number): HTMLInputElement => {
	const field = container.createDiv({ cls: "inkdoc-palette-rgb-field" });
	field.createDiv({ cls: "inkdoc-palette-rgb-field-label", text: label });
	const input = field.createEl("input", { cls: "inkdoc-palette-rgb-input", type: "number" });
	input.min = "0";
	input.max = "255";
	input.step = "1";
	input.value = String(value);
	return input;
};

const createPresetColorSet = (container: HTMLDivElement, title: string, color: string): void => {
	const item = container.createDiv({ cls: "inkdoc-palette-color-set" });
	item.createDiv({ cls: "inkdoc-palette-color-set-title", text: title });
	const swatch = item.createDiv({ cls: "inkdoc-palette-color-set-swatch" });
	swatch.style.background = color;
};
