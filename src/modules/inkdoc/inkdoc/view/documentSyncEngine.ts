// @ts-nocheck
type DocumentSyncEngineOptions = {
	debounceMs: number;
	minimumSaveIdleMs?: number;
	isInteractionActive: () => boolean;
	save: () => Promise<void>;
	reload: () => Promise<void>;
};

export class DocumentSyncEngine {
	private debounceMs: number;
	private minimumSaveIdleMs: number;
	private isInteractionActive: () => boolean;
	private save: () => Promise<void>;
	private reload: () => Promise<void>;
	private lastActivityAt = 0;
	private pendingSave = false;
	private pendingReload = false;
	private internalModifyEvents = 0;
	private saveTimer: number | null = null;
	private reloadTimer: number | null = null;
	private isSaving = false;
	private isReloading = false;
	private disposed = false;

	constructor(options: DocumentSyncEngineOptions) {
		this.debounceMs = Math.max(0, options.debounceMs);
		this.minimumSaveIdleMs = Math.max(0, options.minimumSaveIdleMs ?? options.debounceMs);
		this.isInteractionActive = options.isInteractionActive;
		this.save = options.save;
		this.reload = options.reload;
	}

	setDebounceMs(value: number): void {
		this.debounceMs = Math.max(0, value);
		this.scheduleSave();
		this.scheduleReload();
	}

	dispose(): void {
		this.disposed = true;
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (this.reloadTimer !== null) {
			window.clearTimeout(this.reloadTimer);
			this.reloadTimer = null;
		}
	}

	noteActivity(): void {
		this.lastActivityAt = Date.now();
		this.scheduleSave();
		this.scheduleReload();
	}

	requestSaveAfterActivity(): void {
		this.pendingSave = true;
		this.noteActivity();
	}

	markNextModifyAsInternal(): void {
		this.internalModifyEvents += 1;
		window.setTimeout(() => {
			this.internalModifyEvents = Math.max(0, this.internalModifyEvents - 1);
		}, 5000);
	}

	onVaultModify(): void {
		if (this.internalModifyEvents > 0) {
			this.internalModifyEvents = Math.max(0, this.internalModifyEvents - 1);
			return;
		}
		this.pendingReload = true;
		this.scheduleReload();
	}

	private getQuietDelay(): number {
		const elapsed = Date.now() - this.lastActivityAt;
		return Math.max(0, this.debounceMs - elapsed);
	}

	private getSaveQuietDelay(): number {
		const elapsed = Date.now() - this.lastActivityAt;
		const requiredIdleMs = Math.max(this.debounceMs, this.minimumSaveIdleMs);
		return Math.max(0, requiredIdleMs - elapsed);
	}

	private scheduleSave(): void {
		if (this.disposed || !this.pendingSave) {
			return;
		}
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
		}
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.flushSave();
		}, this.getSaveQuietDelay());
	}

	private scheduleReload(): void {
		if (this.disposed || !this.pendingReload) {
			return;
		}
		if (this.reloadTimer !== null) {
			window.clearTimeout(this.reloadTimer);
		}
		this.reloadTimer = window.setTimeout(() => {
			this.reloadTimer = null;
			void this.flushReload();
		}, this.getQuietDelay());
	}

	private async flushSave(): Promise<void> {
		if (this.disposed || !this.pendingSave || this.isSaving) {
			return;
		}
		if (this.isReloading) {
			this.scheduleSave();
			return;
		}
		if (this.isInteractionActive() || this.getSaveQuietDelay() > 0) {
			this.scheduleSave();
			return;
		}
		this.isSaving = true;
		this.pendingSave = false;
		try {
			await this.save();
		} finally {
			this.isSaving = false;
		}
		if (this.pendingSave) {
			this.scheduleSave();
		}
	}

	private async flushReload(): Promise<void> {
		if (this.disposed || !this.pendingReload || this.isReloading) {
			return;
		}
		if (this.isSaving) {
			this.scheduleReload();
			return;
		}
		if (this.isInteractionActive() || this.getQuietDelay() > 0) {
			this.scheduleReload();
			return;
		}
		this.isReloading = true;
		this.pendingReload = false;
		try {
			await this.reload();
		} finally {
			this.isReloading = false;
		}
		if (this.pendingReload) {
			this.scheduleReload();
		}
	}
}
