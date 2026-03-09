// @ts-nocheck

export interface InkDocSubmenuEngine {
	register: (submenuId: string, triggerEl: HTMLButtonElement, panelEl: HTMLDivElement) => void;
	setActive: (submenuId: string | null) => void;
	toggle: (submenuId: string) => void;
	getActive: () => string | null;
	containsTarget: (target: Node | null) => boolean;
	dispose: () => void;
}

export const createInkDocSubmenuEngine = (rootEl: HTMLDivElement): InkDocSubmenuEngine => {
	const triggerMap = new Map<string, HTMLButtonElement>();
	const panelMap = new Map<string, HTMLDivElement>();
	let activeSubmenu: string | null = null;

	rootEl.classList.add("inkdoc-submenu-engine");

	const applyState = () => {
		const hasOpenSubmenu = Boolean(activeSubmenu);
		rootEl.classList.toggle("has-open-submenu", hasOpenSubmenu);
		for (const [submenuId, trigger] of triggerMap.entries()) {
			const isActive = submenuId === activeSubmenu;
			trigger.classList.toggle("is-active", isActive);
		}
		for (const [submenuId, panel] of panelMap.entries()) {
			const isOpen = submenuId === activeSubmenu;
			panel.classList.toggle("is-open", isOpen);
			panel.setAttr("aria-hidden", isOpen ? "false" : "true");
		}
	};

	return {
		register: (submenuId, triggerEl, panelEl) => {
			triggerMap.set(submenuId, triggerEl);
			panelMap.set(submenuId, panelEl);
			triggerEl.classList.add("inkdoc-submenu-engine-trigger");
			panelEl.classList.add("inkdoc-submenu-engine-panel");
			panelEl.setAttr("aria-hidden", "true");
			applyState();
		},
		setActive: (submenuId) => {
			activeSubmenu = submenuId && panelMap.has(submenuId) ? submenuId : null;
			applyState();
		},
		toggle: (submenuId) => {
			if (!panelMap.has(submenuId)) {
				return;
			}
			activeSubmenu = activeSubmenu === submenuId ? null : submenuId;
			applyState();
		},
		getActive: () => activeSubmenu,
		containsTarget: (target) => Boolean(target) && rootEl.contains(target),
		dispose: () => {
			activeSubmenu = null;
			triggerMap.clear();
			panelMap.clear();
			rootEl.classList.remove("inkdoc-submenu-engine", "has-open-submenu");
		}
	};
};
