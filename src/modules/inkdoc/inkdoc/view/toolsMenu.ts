// @ts-nocheck
import { App, Menu } from "../../engines/platform/inkdocPlatform";
import { setInkDocMenuItemIcon } from "./iconEngine";

export const openInkDocToolsMenu = (
	app: App,
	anchor: HTMLElement,
	onExportPdf: () => void
): void => {
	const menu = new Menu();
	menu.addItem((item) => {
		item.setTitle("Exportar como PDF");
		setInkDocMenuItemIcon(item, "file-down");
		item.onClick(() => onExportPdf());
	});
	const rect = anchor.getBoundingClientRect();
	menu.showAtPosition({
		x: Math.max(8, Math.round(rect.right - 180)),
		y: Math.round(rect.bottom + 6)
	});
};

export const closeInkDocToolsMenu = (_container: HTMLElement): void => {
	// No-op: el menú nativo de Obsidian maneja su ciclo de vida.
};
