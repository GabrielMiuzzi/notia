// @ts-nocheck
declare const __INKDOC_BUILD_STAMP__: string;
declare const __INKDOC_PLUGIN_VERSION__: string;

export type InkDocBuildInfo = {
	version: string;
	stamp: string;
};

export const getInkDocBuildInfo = (): InkDocBuildInfo => {
	const version =
		typeof __INKDOC_PLUGIN_VERSION__ === "string" && __INKDOC_PLUGIN_VERSION__.trim().length > 0
			? __INKDOC_PLUGIN_VERSION__
			: "0.0.0";
	const stamp =
		typeof __INKDOC_BUILD_STAMP__ === "string" && __INKDOC_BUILD_STAMP__.trim().length > 0
			? __INKDOC_BUILD_STAMP__
			: `${version} | unknown-build`;
	return { version, stamp };
};
