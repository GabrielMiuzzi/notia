// @ts-nocheck
import { TFile, normalizePath, type App } from "../../engines/platform/inkdocPlatform";
import type { InkDocDocument } from "../types";

const WIKI_LINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

const collectLinkCounts = (doc: InkDocDocument): Map<string, number> => {
	const counts = new Map<string, number>();
	for (const page of doc.pages) {
		for (const block of page.textBlocks ?? []) {
			if (block.type === "latex") {
				continue;
			}
			const source = block.text ?? "";
			WIKI_LINK_PATTERN.lastIndex = 0;
			while (true) {
				const match = WIKI_LINK_PATTERN.exec(source);
				if (!match) {
					break;
				}
				const target = (match[1] ?? "").trim();
				if (!target) {
					continue;
				}
				const linkPath = target.split("#")[0]?.trim() ?? "";
				if (!linkPath) {
					continue;
				}
				counts.set(linkPath, (counts.get(linkPath) ?? 0) + 1);
			}
		}
	}
	return counts;
};

const LEGACY_INDEX_FOLDER = "_inkdoc_index";

const getLegacyGraphIndexPath = (file: TFile): string =>
	normalizePath(`${LEGACY_INDEX_FOLDER}/${file.path}.md`);

const deleteLegacyGraphIndexNote = async (app: App, file: TFile): Promise<void> => {
	const legacy = app.vault.getAbstractFileByPath(getLegacyGraphIndexPath(file));
	if (legacy instanceof TFile) {
		await app.vault.delete(legacy);
	}
};

export const syncInkDocWikiLinksToMetadata = (
	app: App,
	file: TFile | null,
	doc: InkDocDocument | null
): void => {
	if (!file || !doc) {
		return;
	}
	const linkCounts = collectLinkCounts(doc);
	const resolved: Record<string, number> = {};
	const unresolved: Record<string, number> = {};
	for (const [linkPath, count] of linkCounts) {
		const dest = app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
		if (dest) {
			resolved[dest.path] = (resolved[dest.path] ?? 0) + count;
		} else {
			unresolved[linkPath] = (unresolved[linkPath] ?? 0) + count;
		}
	}
	app.metadataCache.resolvedLinks[file.path] = resolved;
	app.metadataCache.unresolvedLinks[file.path] = unresolved;
	app.metadataCache.trigger("resolve", file);
	app.metadataCache.trigger("resolved");
	void deleteLegacyGraphIndexNote(app, file).catch((error) => {
		console.error("InkDocs: no se pudo limpiar el índice legado de grafo", error);
	});
};
