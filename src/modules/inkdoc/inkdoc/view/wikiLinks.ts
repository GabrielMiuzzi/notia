// @ts-nocheck
import { App, TFile, TFolder, normalizePath } from "../../engines/platform/inkdocPlatform";

const WIKI_LINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

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

export const applyWikiLinksToElement = (
	container: HTMLElement,
	app: App,
	sourceFile: TFile | null
): void => {
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
				const link = document.createElement("a");
				link.className = "inkdoc-wikilink";
				link.href = "#";
				link.textContent = alias || target;
				link.addEventListener("pointerdown", (event) => {
					event.stopPropagation();
				});
				link.addEventListener("click", (event) => {
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
