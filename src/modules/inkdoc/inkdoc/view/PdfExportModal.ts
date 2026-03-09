// @ts-nocheck
import { App, Modal, Notice, normalizePath, type TFile } from "../../engines/platform/inkdocPlatform";
import type { InkDocDocument } from "../types";
import { exportInkDocToPdfBytes, resolvePdfName } from "./pdfExport";
import { attachInkDocModalEngine } from "./modalEngine";

export class PdfExportModal extends Modal {
	private readonly doc: InkDocDocument;
	private readonly file: TFile | null;
	private exportButtonEl: HTMLButtonElement | null = null;
	private loaderEl: HTMLDivElement | null = null;
	private loadingLabelEl: HTMLParagraphElement | null = null;
	private detachShell: (() => void) | null = null;

	constructor(app: App, doc: InkDocDocument, file: TFile | null) {
		super(app);
		this.doc = doc;
		this.file = file;
	}

	onOpen(): void {
		this.detachShell = attachInkDocModalEngine(this, { tone: "default", size: "sm" });
		this.titleEl.setText("Exportar PDF");
		this.contentEl.addClass("inkdoc-pdf-export-modal");
		this.contentEl.createEl("p", {
			cls: "inkdoc-background-intro",
			text: "Exporta el documento completo en PDF dentro de la carpeta PDFExports, junto al .inkdoc."
		});
		const actions = this.contentEl.createDiv({ cls: "inkdoc-pdf-export-actions" });
		const button = actions.createEl("button", {
			cls: "mod-cta",
			text: "Exportar PDF"
		});
		button.addEventListener("click", () => {
			void this.handleExportClick();
		});
		this.exportButtonEl = button;
		const loadingWrap = this.contentEl.createDiv({ cls: "inkdoc-pdf-export-loading" });
		loadingWrap.createDiv({ cls: "inkdoc-pdf-export-spinner" });
		const loadingLabel = loadingWrap.createEl("p", {
			cls: "inkdoc-pdf-export-loading-text",
			text: "Exportando PDF..."
		});
		this.loaderEl = loadingWrap;
		this.loadingLabelEl = loadingLabel;
	}

	onClose(): void {
		this.detachShell?.();
		this.detachShell = null;
		this.contentEl.empty();
	}

	private async handleExportClick(): Promise<void> {
		if (!this.exportButtonEl || !this.loaderEl) {
			return;
		}
		this.setLoading(true);
		try {
			const baseName = (this.file?.basename ?? this.doc.title ?? "InkDoc").trim() || "InkDoc";
			const fileName = resolvePdfName(`${baseName}.pdf`);
			const pdfBytes = await exportInkDocToPdfBytes(this.app, this.doc, this.file);
			const targetPath = await this.buildExportTargetPath(fileName);
			await this.writePdfToVault(targetPath, pdfBytes);
			new Notice(`PDF exportado: ${targetPath}`);
			this.close();
		} catch (error) {
			console.error("Error al exportar PDF:", error);
			new Notice("No se pudo exportar el PDF.");
		} finally {
			this.setLoading(false);
		}
	}

	private setLoading(isLoading: boolean): void {
		if (!this.exportButtonEl || !this.loaderEl) {
			return;
		}
		this.exportButtonEl.disabled = isLoading;
		this.loaderEl.classList.toggle("is-visible", isLoading);
		if (this.loadingLabelEl) {
			this.loadingLabelEl.setText(isLoading ? "Armando y guardando PDF..." : "Exportando PDF...");
		}
	}

	private async buildExportTargetPath(fileName: string): Promise<string> {
		const parentPath = this.file?.parent?.path?.trim() ?? "";
		const exportDir = parentPath ? normalizePath(`${parentPath}/PDFExports`) : "PDFExports";
		const exists = await this.app.vault.adapter.exists(exportDir);
		if (!exists) {
			await this.app.vault.adapter.mkdir(exportDir);
		}
		return normalizePath(`${exportDir}/${fileName}`);
	}

	private async writePdfToVault(path: string, pdfBytes: Uint8Array): Promise<void> {
		const data = pdfBytes.buffer.slice(
			pdfBytes.byteOffset,
			pdfBytes.byteOffset + pdfBytes.byteLength
		);
		await this.app.vault.adapter.writeBinary(path, data);
	}
}
