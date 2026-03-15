// @ts-nocheck
import { App, TFile, TFolder, normalizePath } from "../../engines/platform/inkdocPlatform";

const WIKI_LINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const WIKI_LINK_SELECTOR = ".inkdoc-wikilink[data-wikilink-target]";

const ensureParentFolders = async (app: App, filePath: string): Promise<void> => {
	const folderParts = filePath.split("/").slice(0, -1).filter((part) => part.length > 0);
	let current = "";
	for (const part of folderParts) {
		current = current ? `${current}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(current);
		if (!existing) {
			await app.vault.createFolder(current);
			continue;
		}
		if (!(existing instanceof TFolder)) {
			throw new Error(`La ruta ${current} ya existe y no es una carpeta.`);
		}
	}
};

const openOrCreateWikiLink = async (
	app: App,
	sourceFile: TFile | null,
	target: string
): Promise<void> => {
	const cleanTarget = target.trim();
	if (!cleanTarget) {
		return;
	}
	const linkPath = cleanTarget.split("#")[0]?.trim() ?? "";
	if (!linkPath) {
		return;
	}
	const sourcePath = sourceFile?.path ?? "";
	const existing = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
	if (existing) {
		await app.workspace.getLeaf(true).openFile(existing);
		return;
	}
	const normalizedPath = normalizePath(linkPath.endsWith(".md") ? linkPath : `${linkPath}.md`);
	const byPath = app.vault.getAbstractFileByPath(normalizedPath);
	if (byPath instanceof TFile) {
		await app.workspace.getLeaf(true).openFile(byPath);
		return;
	}
	await ensureParentFolders(app, normalizedPath);
	const basename = normalizedPath.split("/").pop()?.replace(/\.md$/i, "") ?? "Nueva nota";
	const created = await app.vault.create(normalizedPath, `# ${basename}\n`);
	await app.workspace.getLeaf(true).openFile(created);
};

const buildWikiLinkSource = (target: string, alias?: string): string => {
	const cleanTarget = target.trim();
	const cleanAlias = alias?.trim() ?? "";
	if (!cleanTarget) {
		return "";
	}
	return cleanAlias && cleanAlias !== cleanTarget
		? `[[${cleanTarget}|${cleanAlias}]]`
		: `[[${cleanTarget}]]`;
};

const buildVisibleWikiLinkLabel = (target: string, alias?: string): string => {
	const cleanTarget = target.trim();
	const cleanAlias = alias?.trim() ?? "";
	const visibleLabel = cleanAlias || cleanTarget;
	if (!visibleLabel) {
		return "";
	}
	return `[[${visibleLabel}]]`;
};

const replaceWikiLinkAnchorsWithSource = (container: HTMLElement): void => {
	const links = Array.from(container.querySelectorAll<HTMLElement>(WIKI_LINK_SELECTOR));
	for (const link of links) {
		const target = link.dataset.wikilinkTarget?.trim() ?? "";
		const alias = link.dataset.wikilinkAlias?.trim() ?? "";
		const fallbackText = link.textContent?.trim() ?? "";
		const source = buildWikiLinkSource(target || fallbackText, alias);
		link.replaceWith(document.createTextNode(source || fallbackText));
	}
};

export const restoreWikiLinkSourceForEditing = (html: string): string => {
	if (!html.trim()) {
		return html;
	}
	const container = document.createElement("div");
	container.innerHTML = html;
	replaceWikiLinkAnchorsWithSource(container);
	return container.innerHTML;
};

export const applyWikiLinksToElement = (
	container: HTMLElement,
	app: App,
	sourceFile: TFile | null
): void => {
	replaceWikiLinkAnchorsWithSource(container);
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	while (true) {
		const current = walker.nextNode();
		if (!(current instanceof Text)) {
			break;
		}
		if (!current.nodeValue?.includes("[[")) {
			continue;
		}
		if (current.parentElement?.closest("a,code,pre")) {
			continue;
		}
		nodes.push(current);
	}
	for (const node of nodes) {
		const text = node.nodeValue ?? "";
		WIKI_LINK_PATTERN.lastIndex = 0;
		let lastIndex = 0;
		let changed = false;
		const fragment = document.createDocumentFragment();
		while (true) {
			const match = WIKI_LINK_PATTERN.exec(text);
			if (!match) {
				break;
			}
			changed = true;
			const raw = match[0] ?? "";
			const target = (match[1] ?? "").trim();
			const alias = (match[2] ?? "").trim();
			if (match.index > lastIndex) {
				fragment.append(text.slice(lastIndex, match.index));
			}
			if (!target) {
				fragment.append(raw);
			} else {
				const link = document.createElement("span");
				link.className = "inkdoc-wikilink";
				link.textContent = buildVisibleWikiLinkLabel(target, alias);
				link.tabIndex = 0;
				link.setAttribute("role", "link");
				link.dataset.wikilinkTarget = target;
				link.dataset.wikilinkAlias = alias;
				link.addEventListener("pointerdown", (event) => {
					event.stopPropagation();
				});
				link.addEventListener("click", (event) => {
					event.stopPropagation();
					void openOrCreateWikiLink(app, sourceFile, target);
				});
				link.addEventListener("keydown", (event) => {
					if (event.key !== "Enter" && event.key !== " ") {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					void openOrCreateWikiLink(app, sourceFile, target);
				});
				fragment.append(link);
			}
			lastIndex = match.index + raw.length;
		}
		if (!changed) {
			continue;
		}
		if (lastIndex < text.length) {
			fragment.append(text.slice(lastIndex));
		}
		node.replaceWith(fragment);
	}
};
