// @ts-nocheck
import { createInkDocSubmenuEngine } from "./submenuEngine";

type MenuItem = {
	label: string;
	onClick: () => void;
};

const cleanupMap = new WeakMap<HTMLElement, () => void>();

export const openManagedMenu = (
	container: HTMLElement,
	menuClass: string,
	left: number,
	top: number,
	items: MenuItem[],
	onClose: () => void
): HTMLDivElement => {
	const host = container.createDiv({ cls: `inkdoc-context-menu-host ${menuClass}`.trim() });
	host.style.left = `${left}px`;
	host.style.top = `${top}px`;
	const trigger = host.createEl("button", {
		cls: "inkdoc-context-menu-trigger",
		attr: { type: "button", "aria-hidden": "true", tabindex: "-1" }
	});
	const menu = host.createDiv({ cls: "inkdoc-context-menu-panel" });
	const submenuEngine = createInkDocSubmenuEngine(host);
	submenuEngine.register("context", trigger, menu);
	submenuEngine.setActive("context");

	for (const item of items) {
		const button = menu.createEl("button", {
			cls: "inkdoc-context-item",
			text: item.label
		});
		button.addEventListener("click", item.onClick);
	}

	const closeOnClick = (event: MouseEvent) => {
		const target = event.target as Node | null;
		if (!target || host.contains(target)) {
			return;
		}
		onClose();
	};
	const closeOnEsc = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			onClose();
		}
	};

	window.addEventListener("mousedown", closeOnClick, { capture: true });
	window.addEventListener("keydown", closeOnEsc);
	cleanupMap.set(host, () => {
		window.removeEventListener("mousedown", closeOnClick, true);
		window.removeEventListener("keydown", closeOnEsc);
		submenuEngine.dispose();
	});
	return host;
};

export const closeManagedMenu = (container: HTMLElement, selector: string): void => {
	const existing = container.querySelector<HTMLElement>(selector);
	if (!existing) {
		return;
	}
	const cleanup = cleanupMap.get(existing);
	if (cleanup) {
		cleanup();
		cleanupMap.delete(existing);
	}
	existing.remove();
};
