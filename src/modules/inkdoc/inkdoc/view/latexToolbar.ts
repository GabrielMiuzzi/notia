// @ts-nocheck
import { INKDOC_LATEX_PALETTE } from "./constants";

export type LatexToolbarActions = {
	onToolbarInteraction: () => void;
	applyLatexColor: (color: string) => void;
};

type CreateLatexToolbarOptions = {
	initialColor: string;
};

export const createLatexToolbar = (
	root: HTMLDivElement,
	toolbarId: string,
	options: CreateLatexToolbarOptions,
	actions: LatexToolbarActions
): HTMLDivElement => {
	const toolbar = root.createDiv({
		cls: "inkdoc-latex-toolbar",
		attr: { id: toolbarId }
	});
	toolbar.addEventListener("mousedown", () => {
		actions.onToolbarInteraction();
	});

	const group = toolbar.createDiv({ cls: "inkdoc-latex-toolbar-group" });
	const colorInput = group.createEl("input", {
		type: "color",
		cls: "inkdoc-latex-color"
	});
	colorInput.title = "Color de fórmula";
	colorInput.value = options.initialColor;
	colorInput.addEventListener("input", () => actions.applyLatexColor(colorInput.value));

	const palette = group.createDiv({
		cls: "inkdoc-latex-palette",
		attr: { "aria-label": "Paleta de LaTeX" }
	});
	for (const color of INKDOC_LATEX_PALETTE) {
		const swatch = palette.createEl("button", {
			cls: "inkdoc-latex-swatch",
			attr: {
				"aria-label": `Color de fórmula ${color}`,
				title: `Fórmula: ${color}`
			}
		});
		swatch.style.background = color;
		swatch.dataset.color = color;
		swatch.addEventListener("click", () => {
			colorInput.value = color;
			actions.applyLatexColor(color);
		});
	}

	return toolbar;
};
