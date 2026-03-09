// @ts-nocheck
export type ObjectHoverMenuController = {
	showMenu: (touchAutoHide?: boolean) => void;
	hideMenu: () => void;
	handleHostPointerEnter: () => void;
	handleHostPointerLeave: () => void;
	handleHostClick: () => void;
	handleHostFocusIn: () => void;
	handleHostFocusOut: () => void;
	handleMenuPointerDown: () => void;
	handleMenuPointerEnter: () => void;
	handleMenuPointerLeave: () => void;
	scheduleTouchMenuHide: (delayMs?: number) => void;
	clearTouchMenuHide: () => void;
	isMenuInteracting: () => boolean;
	dispose: () => void;
};

type ObjectHoverMenuControllerOptions = {
	setMenuVisible: (visible: boolean) => void;
	isMenuStickyOpen?: () => boolean;
	isEnabled?: () => boolean;
	hoverOpenDelayMs?: number;
	hoverCloseDelayMs?: number;
	touchVisibleMs?: number;
};

const DEFAULT_HOVER_OPEN_DELAY_MS = 500;
const DEFAULT_HOVER_CLOSE_DELAY_MS = 1500;
const DEFAULT_TOUCH_VISIBLE_MS = 2000;

export const createObjectHoverMenuController = (
	hostEl: HTMLElement,
	options: ObjectHoverMenuControllerOptions
): ObjectHoverMenuController => {
	const hoverOpenDelayMs = options.hoverOpenDelayMs ?? DEFAULT_HOVER_OPEN_DELAY_MS;
	const hoverCloseDelayMs = options.hoverCloseDelayMs ?? DEFAULT_HOVER_CLOSE_DELAY_MS;
	const touchVisibleMs = options.touchVisibleMs ?? DEFAULT_TOUCH_VISIBLE_MS;
	const isEnabled = options.isEnabled ?? (() => true);
	let hoverOpenTimer: number | null = null;
	let hoverCloseTimer: number | null = null;
	let touchMenuTimer: number | null = null;
	let menuVisible = false;
	let menuInteracting = false;
	let menuReleaseBound = false;

	const clearHoverOpenTimer = () => {
		if (hoverOpenTimer !== null) {
			window.clearTimeout(hoverOpenTimer);
			hoverOpenTimer = null;
		}
	};

	const clearHoverCloseTimer = () => {
		if (hoverCloseTimer !== null) {
			window.clearTimeout(hoverCloseTimer);
			hoverCloseTimer = null;
		}
	};

	const clearTouchMenuHide = () => {
		if (touchMenuTimer !== null) {
			window.clearTimeout(touchMenuTimer);
			touchMenuTimer = null;
		}
	};

	const showMenu = (touchAutoHide: boolean = false) => {
		if (!isEnabled()) {
			hideMenu();
			return;
		}
		menuVisible = true;
		options.setMenuVisible(true);
		if (touchAutoHide) {
			scheduleTouchMenuHide();
		}
	};

	const hideMenu = () => {
		menuVisible = false;
		options.setMenuVisible(false);
		clearHoverOpenTimer();
		clearHoverCloseTimer();
		clearTouchMenuHide();
	};

	const scheduleTouchMenuHide = (delayMs: number = touchVisibleMs) => {
		clearTouchMenuHide();
		touchMenuTimer = window.setTimeout(() => {
			touchMenuTimer = null;
			if (
				menuInteracting ||
				options.isMenuStickyOpen?.() === true ||
				hostEl.matches(":hover") ||
				hostEl.matches(":focus-within")
			) {
				scheduleTouchMenuHide(600);
				return;
			}
			hideMenu();
		}, delayMs);
	};

	const scheduleCloseMenu = () => {
		clearHoverCloseTimer();
		hoverCloseTimer = window.setTimeout(() => {
			hoverCloseTimer = null;
			if (!hostEl.matches(":hover") && !hostEl.matches(":focus-within")) {
				hideMenu();
			}
		}, hoverCloseDelayMs);
	};

	const handleHostPointerEnter = () => {
		if (!isEnabled()) {
			hideMenu();
			return;
		}
		clearHoverCloseTimer();
		clearHoverOpenTimer();
		hoverOpenTimer = window.setTimeout(() => {
			hoverOpenTimer = null;
			showMenu();
		}, hoverOpenDelayMs);
	};

	const handleHostPointerLeave = () => {
		clearHoverOpenTimer();
		scheduleCloseMenu();
	};

	const handleHostClick = () => {
		if (!isEnabled()) {
			hideMenu();
			return;
		}
		clearHoverOpenTimer();
		clearHoverCloseTimer();
		showMenu(true);
	};

	const handleHostFocusIn = () => {
		if (!isEnabled()) {
			hideMenu();
			return;
		}
		showMenu();
	};

	const handleHostFocusOut = () => {
		scheduleCloseMenu();
	};

	const handleMenuPointerDown = () => {
		menuInteracting = true;
		clearTouchMenuHide();
		if (!menuReleaseBound) {
			window.addEventListener("pointerup", releaseMenuInteraction);
			window.addEventListener("pointercancel", releaseMenuInteraction);
			menuReleaseBound = true;
		}
	};

	const releaseMenuInteraction = () => {
		if (!menuInteracting) {
			return;
		}
		menuInteracting = false;
		if (menuVisible) {
			scheduleTouchMenuHide(900);
		}
		if (menuReleaseBound) {
			window.removeEventListener("pointerup", releaseMenuInteraction);
			window.removeEventListener("pointercancel", releaseMenuInteraction);
			menuReleaseBound = false;
		}
	};

	const handleMenuPointerEnter = () => {
		if (!isEnabled()) {
			hideMenu();
			return;
		}
		clearHoverCloseTimer();
		clearTouchMenuHide();
		showMenu();
	};

	const handleMenuPointerLeave = () => {
		scheduleCloseMenu();
		scheduleTouchMenuHide(900);
	};

	return {
		showMenu,
		hideMenu,
		handleHostPointerEnter,
		handleHostPointerLeave,
		handleHostClick,
		handleHostFocusIn,
		handleHostFocusOut,
		handleMenuPointerDown,
		handleMenuPointerEnter,
		handleMenuPointerLeave,
		scheduleTouchMenuHide,
		clearTouchMenuHide,
		isMenuInteracting: () => menuInteracting,
		dispose: () => {
			clearHoverOpenTimer();
			clearHoverCloseTimer();
			clearTouchMenuHide();
			if (menuReleaseBound) {
				window.removeEventListener("pointerup", releaseMenuInteraction);
				window.removeEventListener("pointercancel", releaseMenuInteraction);
				menuReleaseBound = false;
			}
		}
	};
};

type StartPointerInteractionOptions = {
	onMove: (event: PointerEvent) => void;
	onEnd: (event: PointerEvent) => void;
};

export const startWindowPointerInteraction = (
	options: StartPointerInteractionOptions
): (() => void) => {
	const handleMove = (event: PointerEvent) => options.onMove(event);
	const handleUp = (event: PointerEvent) => {
		options.onEnd(event);
		dispose();
	};
	const dispose = () => {
		window.removeEventListener("pointermove", handleMove);
		window.removeEventListener("pointerup", handleUp);
		window.removeEventListener("pointercancel", handleUp);
	};
	window.addEventListener("pointermove", handleMove);
	window.addEventListener("pointerup", handleUp);
	window.addEventListener("pointercancel", handleUp);
	return dispose;
};
