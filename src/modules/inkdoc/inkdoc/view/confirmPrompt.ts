// @ts-nocheck
import { App, Modal } from "../../engines/platform/inkdocPlatform";
import { attachInkDocModalEngine } from "./modalEngine";

interface InkDocConfirmPromptOptions {
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
}

class InkDocConfirmPromptModal extends Modal {
	private readonly options: InkDocConfirmPromptOptions;
	private readonly onResolve: (accepted: boolean) => void;
	private resolved = false;
	private detachShell: (() => void) | null = null;

	constructor(app: App, options: InkDocConfirmPromptOptions, onResolve: (accepted: boolean) => void) {
		super(app);
		this.options = options;
		this.onResolve = onResolve;
	}

	onOpen(): void {
		this.detachShell = attachInkDocModalEngine(this, { tone: "confirm", size: "sm" });
		this.titleEl.setText(this.options.title);
		this.contentEl.addClass("inkdoc-object-creation-modal");
		this.contentEl.createEl("p", {
			cls: "inkdoc-object-creation-modal-message",
			text: this.options.message
		});
		const actions = this.contentEl.createDiv({ cls: "inkdoc-object-creation-modal-actions" });
		const confirmButton = actions.createEl("button", {
			cls: "mod-cta",
			text: this.options.confirmLabel ?? "Aceptar"
		});
		const cancelButton = actions.createEl("button", {
			text: this.options.cancelLabel ?? "Cancelar"
		});
		confirmButton.addEventListener("click", () => this.resolve(true));
		cancelButton.addEventListener("click", () => this.resolve(false));
	}

	onClose(): void {
		this.detachShell?.();
		this.detachShell = null;
		this.contentEl.empty();
		if (!this.resolved) {
			this.resolve(false);
		}
	}

	private resolve(accepted: boolean): void {
		if (this.resolved) {
			return;
		}
		this.resolved = true;
		this.onResolve(accepted);
		this.close();
	}
}

export const openInkDocConfirmPrompt = (
	app: App,
	options: InkDocConfirmPromptOptions
): Promise<boolean> => {
	return new Promise((resolve) => {
		new InkDocConfirmPromptModal(app, options, resolve).open();
	});
};
