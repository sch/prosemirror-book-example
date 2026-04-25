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

const toggleToc = document.getElementById("toggle-toc") as HTMLInputElement;
const toggleChapter = document.getElementById("toggle-chapter") as HTMLInputElement;

let tocEnabled = toggleToc.checked;
let chapterEnabled = toggleChapter.checked;

function buildPlugins(): Plugin[] {
  const plugins: Plugin[] = [];
  if (chapterEnabled) plugins.push(chapterPlugin);
  if (tocEnabled) plugins.push(tableOfContentsPlugin);
  return plugins;
}

const view = new EditorView(editorEl, {
  state: EditorState.create({ doc, plugins: buildPlugins() }),
});

function reconfigure(): void {
  view.updateState(view.state.reconfigure({ plugins: buildPlugins() }));
}

toggleToc.addEventListener("change", function () {
  tocEnabled = toggleToc.checked;
  reconfigure();
});

toggleChapter.addEventListener("change", function () {
  chapterEnabled = toggleChapter.checked;
  reconfigure();
});
