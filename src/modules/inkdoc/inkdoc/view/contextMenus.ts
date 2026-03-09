// @ts-nocheck
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
	const menu = container.createDiv({ cls: `inkdoc-context-menu ${menuClass}`.trim() });
	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;

	for (const item of items) {
		const button = menu.createEl("button", {
			cls: "inkdoc-context-item",
			text: item.label
		});
		button.addEventListener("click", item.onClick);
	}

	const closeOnClick = (event: MouseEvent) => {
		const target = event.target as Node | null;
		if (!target || menu.contains(target)) {
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
	cleanupMap.set(menu, () => {
		window.removeEventListener("mousedown", closeOnClick, true);
		window.removeEventListener("keydown", closeOnEsc);
	});
	return menu;
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
