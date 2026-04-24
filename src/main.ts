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

// Stable plugin instances so they can be removed and re-added
// via reconfigure without losing their identity.
const chapter = chapterPlugin();
const toc = tableOfContentsPlugin();

function buildPlugins(): Plugin[] {
  const plugins: Plugin[] = [];
  if (chapterEnabled) plugins.push(chapter);
  if (tocEnabled) plugins.push(toc);
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
