// @ts-nocheck
import type { App } from "../../../engines/platform/inkdocPlatform";
import { renderLatexSegments } from "../latexRenderer";

export const renderInkMathLatexPreview = async (
	app: App,
	container: HTMLElement,
	sourcePath: string,
	owner: unknown,
	latex: string
): Promise<boolean> => {
	const trimmed = latex.trim();
	if (!trimmed) {
		return false;
	}
	container.empty();
	void app;
	void sourcePath;
	void owner;
	return renderLatexSegments(container, trimmed);
};
