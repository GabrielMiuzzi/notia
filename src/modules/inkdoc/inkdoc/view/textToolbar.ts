// @ts-nocheck
import { INKDOC_ICONS, type InkDocIconName } from "./icons";
import { setInkDocIcon } from "./iconEngine";

export type TextToolbarActions = {
	onToolbarInteraction: () => void;
	applyEditorCommand: (command: string, value?: string) => void;
	applySelectionStyle: (style: string) => void;
	applyTextTransform: (value: "uppercase" | "lowercase" | "capitalize") => void;
	applyBlockStyle: (styles: Partial<CSSStyleDeclaration>) => void;
	applyParagraphStyle: (styles: Partial<CSSStyleDeclaration>) => void;
};

export const createTextToolbar = (
	root: HTMLDivElement,
	toolbarId: string,
	actions: TextToolbarActions
): HTMLDivElement => {
	const toolbar = root.createDiv({
		cls: "inkdoc-text-toolbar",
		attr: { id: toolbarId }
	});
	toolbar.addEventListener("mousedown", () => {
		actions.onToolbarInteraction();
	});

	const createToolbarButton = (
		container: HTMLDivElement,
		icon: InkDocIconName,
		label: string,
		onClick: () => void
	): void => {
		const button = container.createEl("button", {
			cls: "inkdoc-text-toolbar-btn",
			attr: { "aria-label": label, title: label }
		});
		setInkDocIcon(button, icon, label.charAt(0).toUpperCase());
		button.addEventListener("click", () => onClick());
	};

	const createToolbarTextButton = (
		container: HTMLDivElement,
		text: string,
		label: string,
		onClick: () => void
	): void => {
		const button = container.createEl("button", {
			cls: "inkdoc-text-toolbar-btn",
			text,
			attr: { "aria-label": label, title: label }
		});
		button.addEventListener("click", () => onClick());
	};

	const formatGroup = toolbar.createDiv({ cls: "inkdoc-text-toolbar-group" });
	createToolbarButton(formatGroup, INKDOC_ICONS.BOLD, "Negrita", () => actions.applyEditorCommand("bold"));
	createToolbarButton(formatGroup, INKDOC_ICONS.ITALIC, "Cursiva", () => actions.applyEditorCommand("italic"));
	createToolbarButton(formatGroup, INKDOC_ICONS.UNDERLINE, "Subrayado", () =>
		actions.applyEditorCommand("underline")
	);
	createToolbarButton(formatGroup, INKDOC_ICONS.STRIKETHROUGH, "Tachado", () =>
		actions.applyEditorCommand("strikeThrough")
	);

	const colorGroup = toolbar.createDiv({ cls: "inkdoc-text-toolbar-group" });
	const textColor = colorGroup.createEl("input", {
		type: "color",
		cls: "inkdoc-text-color"
	});
	textColor.title = "Color de texto";
	textColor.addEventListener("input", () => actions.applyEditorCommand("foreColor", textColor.value));
	const highlightColor = colorGroup.createEl("input", {
		type: "color",
		cls: "inkdoc-text-highlight"
	});
	highlightColor.title = "Resaltado";
	highlightColor.addEventListener("input", () =>
		actions.applyEditorCommand("hiliteColor", highlightColor.value)
	);

	const paletteColors = [
		"#000000",
		"#3b3b3b",
		"#ff2d2d",
		"#ff7a00",
		"#ffd400",
		"#2ecc71",
		"#2aa9ff",
		"#6c5ce7",
		"#1abc9c",
		"#00cec9",
		"#fd79a8",
		"#ffffff"
	];

	const textPalette = colorGroup.createDiv({ cls: "inkdoc-text-palette", attr: { "aria-label": "Paleta de texto" } });
	for (const color of paletteColors) {
		const swatch = textPalette.createEl("button", {
			cls: "inkdoc-text-swatch",
			attr: { "aria-label": `Color de texto ${color}`, title: `Texto: ${color}` }
		});
		swatch.style.background = color;
		swatch.addEventListener("click", () => {
			textColor.value = color;
			actions.applyEditorCommand("foreColor", color);
		});
	}

	const highlightPalette = colorGroup.createDiv({
		cls: "inkdoc-text-palette is-highlight",
		attr: { "aria-label": "Paleta de resaltado" }
	});
	for (const color of paletteColors) {
		const swatch = highlightPalette.createEl("button", {
			cls: "inkdoc-text-swatch",
			attr: { "aria-label": `Color de resaltado ${color}`, title: `Resaltado: ${color}` }
		});
		swatch.style.background = color;
		swatch.addEventListener("click", () => {
			highlightColor.value = color;
			actions.applyEditorCommand("hiliteColor", color);
		});
	}

	createToolbarButton(colorGroup, INKDOC_ICONS.HIGHLIGHTER, "Resaltado degradado", () => {
		actions.applySelectionStyle("background-image: linear-gradient(120deg, #ffeaa7 0%, #fab1a0 100%);");
	});

	const fontGroup = toolbar.createDiv({ cls: "inkdoc-text-toolbar-group" });
	const fontSelect = fontGroup.createEl("select", { cls: "inkdoc-text-font" });
	["Inter", "Georgia", "Times New Roman", "Courier New", "Verdana", "Tahoma"].forEach((font) => {
		const option = fontSelect.createEl("option", { text: font });
		option.value = font;
	});
	fontSelect.title = "Familia tipográfica";
	fontSelect.addEventListener("change", () => actions.applyEditorCommand("fontName", fontSelect.value));
	const sizeSelect = fontGroup.createEl("select", { cls: "inkdoc-text-size" });
	[
		{ label: "12", value: "12px" },
		{ label: "14", value: "14px" },
		{ label: "16", value: "16px" },
		{ label: "18", value: "18px" },
		{ label: "20", value: "20px" },
		{ label: "24", value: "24px" },
		{ label: "28", value: "28px" }
	].forEach((size) => {
		const option = sizeSelect.createEl("option", { text: size.label });
		option.value = size.value;
	});
	sizeSelect.title = "Tamaño de fuente";
	sizeSelect.addEventListener("change", () => actions.applySelectionStyle(`font-size: ${sizeSelect.value};`));

	const caseGroup = toolbar.createDiv({ cls: "inkdoc-text-toolbar-group" });
	createToolbarTextButton(caseGroup, "Mayús", "Mayúsculas", () => actions.applyTextTransform("uppercase"));
	createToolbarTextButton(caseGroup, "Min", "Minúsculas", () => actions.applyTextTransform("lowercase"));
	createToolbarTextButton(caseGroup, "Cap", "Capitalizar", () => actions.applyTextTransform("capitalize"));

	const alignGroup = toolbar.createDiv({ cls: "inkdoc-text-toolbar-group" });
	createToolbarButton(alignGroup, INKDOC_ICONS.ALIGN_LEFT, "Alinear izquierda", () =>
		actions.applyEditorCommand("justifyLeft")
	);
	createToolbarButton(alignGroup, INKDOC_ICONS.ALIGN_CENTER, "Alinear centro", () =>
		actions.applyEditorCommand("justifyCenter")
	);
	createToolbarButton(alignGroup, INKDOC_ICONS.ALIGN_RIGHT, "Alinear derecha", () =>
		actions.applyEditorCommand("justifyRight")
	);
	createToolbarButton(alignGroup, INKDOC_ICONS.ALIGN_JUSTIFY, "Justificar", () =>
		actions.applyEditorCommand("justifyFull")
	);

	const spacingGroup = toolbar.createDiv({ cls: "inkdoc-text-toolbar-group" });
	const lineHeightSelect = spacingGroup.createEl("select", { cls: "inkdoc-text-line-height" });
	["1.0", "1.15", "1.5", "2.0"].forEach((value) => {
		const option = lineHeightSelect.createEl("option", { text: value });
		option.value = value;
	});
	lineHeightSelect.title = "Interlineado";
	lineHeightSelect.addEventListener("change", () => actions.applyBlockStyle({ lineHeight: lineHeightSelect.value }));

	const beforeSelect = spacingGroup.createEl("select", { cls: "inkdoc-text-spacing-before" });
	["0", "4", "8", "12", "16"].forEach((value) => {
		const option = beforeSelect.createEl("option", { text: `${value}px` });
		option.value = value;
	});
	beforeSelect.title = "Espaciado antes";
	beforeSelect.addEventListener("change", () => actions.applyParagraphStyle({ marginTop: `${beforeSelect.value}px` }));
	const afterSelect = spacingGroup.createEl("select", { cls: "inkdoc-text-spacing-after" });
	["0", "4", "8", "12", "16"].forEach((value) => {
		const option = afterSelect.createEl("option", { text: `${value}px` });
		option.value = value;
	});
	afterSelect.title = "Espaciado después";
	afterSelect.addEventListener("change", () => actions.applyParagraphStyle({ marginBottom: `${afterSelect.value}px` }));

	const indentGroup = toolbar.createDiv({ cls: "inkdoc-text-toolbar-group" });
	createToolbarButton(indentGroup, INKDOC_ICONS.INDENT, "Aumentar sangría", () =>
		actions.applyEditorCommand("indent")
	);
	createToolbarButton(indentGroup, INKDOC_ICONS.OUTDENT, "Disminuir sangría", () =>
		actions.applyEditorCommand("outdent")
	);

	const listGroup = toolbar.createDiv({ cls: "inkdoc-text-toolbar-group" });
	createToolbarButton(listGroup, INKDOC_ICONS.LIST, "Viñetas", () =>
		actions.applyEditorCommand("insertUnorderedList")
	);
	createToolbarButton(listGroup, INKDOC_ICONS.LIST_ORDERED, "Numeradas", () =>
		actions.applyEditorCommand("insertOrderedList")
	);
	createToolbarButton(listGroup, INKDOC_ICONS.CHECK_SQUARE, "Checklist", () =>
		actions.applyEditorCommand("insertText", "☐ ")
	);
	createToolbarTextButton(listGroup, "Tab", "Tabulación", () => actions.applyEditorCommand("insertText", "    "));

	const styleGroup = toolbar.createDiv({ cls: "inkdoc-text-toolbar-group" });
	const styleSelect = styleGroup.createEl("select", { cls: "inkdoc-text-style" });
	const styles = [
		{ label: "Párrafo", value: "<p>" },
		{ label: "Título", value: "<h1>" },
		{ label: "Subtítulo", value: "<h2>" },
		{ label: "Encabezado 1", value: "<h1>" },
		{ label: "Encabezado 2", value: "<h2>" },
		{ label: "Encabezado 3", value: "<h3>" },
		{ label: "Cita", value: "<blockquote>" },
		{ label: "Código", value: "<pre>" }
	];
	styles.forEach((style) => {
		const option = styleSelect.createEl("option", { text: style.label });
		option.value = style.value;
	});
	styleSelect.title = "Estilo";
	styleSelect.addEventListener("change", () => actions.applyEditorCommand("formatBlock", styleSelect.value));

	return toolbar;
};
