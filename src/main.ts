import "prosemirror-view/style/prosemirror.css"
import { DOMParser } from "prosemirror-model"
import { bookSchema } from "./schema"
import { initFullState, mountScopedView, selectChapter } from "./scoped-view"
import { mountTOC } from "./toc"

const editorEl = document.getElementById("editor")!
const doc = DOMParser.fromSchema(bookSchema).parse(editorEl)
editorEl.textContent = ""
initFullState(doc)
mountTOC(document.getElementById("toc-editor")!)
mountScopedView(editorEl)
selectChapter(0)
