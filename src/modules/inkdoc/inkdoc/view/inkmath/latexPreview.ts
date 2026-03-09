// @ts-nocheck
import { MarkdownRenderer, type App } from "../../../engines/platform/inkdocPlatform";

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
	try {
		await MarkdownRenderer.render(app, `$$${trimmed}$$`, container, sourcePath, owner as never);
		return true;
	} catch {
		container.textContent = trimmed;
		return false;
	}
};
