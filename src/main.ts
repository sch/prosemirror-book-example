import "prosemirror-view/style/prosemirror.css";
import { DOMParser } from "prosemirror-model";
import { EditorState, Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { bookSchema } from "./schema";
import { chapterPlugin } from "./chapter-plugin";
import { tableOfContentsPlugin } from "./table-of-contents-plugin";

const editorEl = document.getElementById("editor")!;
const doc = DOMParser.fromSchema(bookSchema).parse(editorEl);
editorEl.textContent = "";

const contentsCheckbox = getInputById("toggle-toc");
const chapterCheckbox = getInputById("toggle-chapter");

let tocEnabled = contentsCheckbox.checked;
let chapterEnabled = chapterCheckbox.checked;

contentsCheckbox.addEventListener("change", function () {
  tocEnabled = contentsCheckbox.checked;
  reconfigure();
});

chapterCheckbox.addEventListener("change", function () {
  chapterEnabled = chapterCheckbox.checked;
  reconfigure();
});

const view = new EditorView(editorEl, {
  state: EditorState.create({ doc, plugins: buildPlugins() }),
});

function reconfigure(): void {
  view.updateState(view.state.reconfigure({ plugins: buildPlugins() }));
}

function buildPlugins(): Plugin[] {
  const plugins: Plugin[] = [];
  if (chapterEnabled) plugins.push(chapterPlugin);
  if (tocEnabled) plugins.push(tableOfContentsPlugin);
  return plugins;
}

function getInputById(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(id + " not present in the dom");
  if (!(el instanceof HTMLInputElement)) throw new Error(id + " is not an input");
  return el;
}
