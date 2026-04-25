import { DOMSerializer, Node } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, Selection, TextSelection } from "prosemirror-state";
import type { PluginView } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { StepMap } from "prosemirror-transform";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { bookSchema } from "./schema";

const renderSpec = DOMSerializer.renderSpec.bind(null, document);

export const chapterKey = new PluginKey<number>("chapter");

// Renders a single chapter in a scoped EditorView. The book view's DOM is
// hidden; this view is the lens. Edits are remapped to full-doc coordinates via
// a uniform offset (chapterStart). The TOC plugin drives chapter switching
// through chapterKey
export const chapterPlugin = new Plugin<number>({
  key: chapterKey,
  state: {
    init() {
      return 0;
    },
    apply(tr, value) {
      const newIndex = tr.getMeta(chapterKey);
      return newIndex != null ? newIndex : value;
    },
  },
  view(editorView) {
    return new ChapterView(editorView);
  },
});

class ChapterView implements PluginView {
  private editorWrapper: HTMLElement;
  private scopedView: EditorView;
  private pendingSelection: Selection | null = null;

  constructor(private editorView: EditorView) {
    const mount = editorView.dom.parentNode!;

    const { dom: editorWrapper, contentDOM } = renderSpec([
      "div",
      { id: "editor-wrapper" },
      ["div", 0],
    ]);
    this.editorWrapper = editorWrapper as HTMLElement;
    mount.appendChild(editorWrapper);

    editorView.dom.style.display = "none";

    const activeIndex = chapterKey.getState(editorView.state)!;
    const chapter = editorView.state.doc.child(activeIndex);

    // Selection can't survive a state rebuild (ResolvedPos is bound to a
    // specific doc). Stash raw positions here, recreate in update() via
    // TextSelection.create
    this.scopedView = new EditorView(contentDOM!, {
      state: buildScopedState(chapter),
      dispatchTransaction: (tr) => {
        if (!tr.docChanged) {
          this.scopedView.updateState(this.scopedView.state.apply(tr));
          return;
        }

        this.pendingSelection = tr.selection;

        const idx = chapterKey.getState(this.editorView.state)!;
        const offset = chapterStart(this.editorView.state.doc, idx);

        const fullTr = this.editorView.state.tr;
        for (const step of tr.steps) {
          const mapped = step.map(StepMap.offset(offset));
          if (mapped) {
            const result = fullTr.maybeStep(mapped);
            if (result.failed) {
              console.warn("[chapter-bridge] step failed:", result.failed);
            }
          }
        }

        if (fullTr.docChanged) {
          this.editorView.dispatch(fullTr);
        }
      },
    });
  }

  update(bookView: EditorView, prevState: EditorState) {
    this.editorView = bookView;

    const newIndex = chapterKey.getState(bookView.state);
    if (newIndex === undefined) return;

    const oldIndex = chapterKey.getState(prevState);
    if (oldIndex === undefined) return;

    if (oldIndex === newIndex && bookView.state.doc === prevState.doc) return;

    const chapter = bookView.state.doc.child(newIndex);
    const doc = buildScopedDoc(chapter);

    let selection: Selection;
    if (this.pendingSelection) {
      selection = TextSelection.create(
        doc,
        this.pendingSelection.anchor,
        this.pendingSelection.head,
      );
      this.pendingSelection = null;
    } else {
      selection = Selection.atStart(doc);
    }

    this.scopedView.updateState(
      EditorState.create({
        doc,
        selection,
        plugins: this.scopedView.state.plugins,
      }),
    );
  }

  destroy() {
    this.scopedView.destroy();
    (this.editorWrapper as HTMLElement).remove();
    this.editorView.dom.style.display = "";
  }
}

export function chapterStart(doc: Node, targetIndex: number) {
  let result = -1;
  doc.forEach((_child, offset, index) => {
    if (index === targetIndex) result = offset;
  });
  if (result === -1) throw new Error(`No chapter at index ${targetIndex}`);
  return result;
}

function buildScopedDoc(fullChapter: Node) {
  return bookSchema.node("doc", null, fullChapter);
}

function buildScopedState(fullChapter: Node) {
  return EditorState.create({
    doc: buildScopedDoc(fullChapter),
    plugins: [keymap(baseKeymap)],
  });
}
