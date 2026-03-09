// @ts-nocheck
import { App } from "../../engines/platform/inkdocPlatform";
import { openInkDocConfirmPrompt } from "./confirmPrompt";

export type InkDocCreatableObject = "text" | "latex" | "image" | "sticky";

const creationPromptByObject: Record<InkDocCreatableObject, { title: string; message: string }> = {
	text: {
		title: "Crear bloque de texto",
		message: "¿Desea crear un bloque de texto en este punto?"
	},
	latex: {
		title: "Crear bloque de LaTeX",
		message: "¿Desea crear un bloque de LaTeX en este punto?"
	},
	image: {
		title: "Insertar imagen",
		message: "¿Desea insertar una imagen en este punto?"
	},
	sticky: {
		title: "Crear sticky note",
		message: "¿Desea crear una sticky note en este punto?"
	}
};

export const confirmObjectCreation = (
	app: App,
	objectType: InkDocCreatableObject
): Promise<boolean> => {
	const prompt = creationPromptByObject[objectType];
	return openInkDocConfirmPrompt(app, {
		title: prompt.title,
		message: prompt.message,
		confirmLabel: "Aceptar",
		cancelLabel: "Cancelar"
	});
};
