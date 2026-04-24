import "prosemirror-view/style/prosemirror.css";
import { DOMParser } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history } from "prosemirror-history";
import { bookSchema } from "./schema";
import { chapterPlugin, tocPlugin } from "./book-plugins";

const editorEl = document.getElementById("editor")!;
const doc = DOMParser.fromSchema(bookSchema).parse(editorEl);
editorEl.textContent = "";

// The book view is the authoritative state holder. Its own DOM is
// hidden by the chapter plugin, which wraps it in the visible editor
// layout. The TOC plugin prepends a sidebar beside it.
new EditorView(editorEl, {
  state: EditorState.create({
    doc,
    plugins: [history(), chapterPlugin(), tocPlugin()],
  }),
});
