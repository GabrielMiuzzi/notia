// @ts-nocheck
type PickerHandle = { getFile: () => Promise<File> };
type PickerWindow = Window & {
	showOpenFilePicker?: (options?: {
		multiple?: boolean;
		excludeAcceptAllOption?: boolean;
		types?: Array<{ description?: string; accept: Record<string, string[]> }>;
	}) => Promise<PickerHandle[]>;
};

export const pickImageFile = async (): Promise<File | null> => {
	const pickerWindow = window as PickerWindow;
	if (typeof pickerWindow.showOpenFilePicker === "function") {
		try {
			const handles = await pickerWindow.showOpenFilePicker({
				multiple: false,
				excludeAcceptAllOption: false,
				types: [
					{
						description: "Images",
						accept: { "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"] }
					}
				]
			});
			const handle = handles[0];
			if (!handle) {
				return null;
			}
			return await handle.getFile();
		} catch {
			return null;
		}
	}
	return await new Promise<File | null>((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.onchange = () => {
			resolve(input.files?.[0] ?? null);
		};
		input.click();
	});
};

export const readFileAsDataUrl = (file: File): Promise<string | null> => {
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(file);
	});
};

export const loadImageSize = (src: string): Promise<{ width: number; height: number } | null> => {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
		img.onerror = () => resolve(null);
		img.src = src;
	});
};

export const isImageFile = (file: File): boolean => {
	if (file.type.startsWith("image/")) {
		return true;
	}
	return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
};

export const getImageFileFromDragEvent = (event: DragEvent): File | null => {
	const files = Array.from(event.dataTransfer?.files ?? []);
	return files.find((file) => isImageFile(file)) ?? null;
};

export const hasFileDragData = (event: DragEvent): boolean => {
	const types = event.dataTransfer?.types as unknown;
	if (!types) {
		return false;
	}
	if (Array.isArray(types)) {
		return types.includes("Files");
	}
	const maybeList = types as { contains?: (value: string) => boolean; length?: number; [index: number]: string };
	if (typeof maybeList.contains === "function") {
		return maybeList.contains("Files");
	}
	if (typeof maybeList.length === "number") {
		return Array.from({ length: maybeList.length }, (_, index) => maybeList[index]).includes("Files");
	}
	return false;
};
