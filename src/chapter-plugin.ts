import { DOMSerializer, Node } from "prosemirror-model";
import {
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  Transaction,
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { StepMap } from "prosemirror-transform";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { bookSchema } from "./schema";

export const chapterKey = new PluginKey<number>("chapter");

const renderSpec = DOMSerializer.renderSpec.bind(null, document);

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
  view(bookView) {
    // The book view's DOM is hidden. This wrapper holds the scoped view that
    // actually renders
    const mount = bookView.dom.parentNode! as HTMLElement;

    const { dom: editorWrapper, contentDOM } = renderSpec([
      "div",
      { id: "editor-wrapper" },
      ["div", 0],
    ]);
    mount.appendChild(editorWrapper);

    bookView.dom.style.display = "none";

    const activeIndex = chapterKey.getState(bookView.state)!;
    const chapter = bookView.state.doc.child(activeIndex);

    // Selection can't survive a state rebuild (ResolvedPos is bound to a
    // specific doc). Stash raw positions here, recreate in update() via
    // TextSelection.create
    let pendingSelection: Selection | null = null;

    const scopedView = new EditorView(contentDOM!, {
      state: buildScopedState(chapter),
      dispatchTransaction(tr: Transaction) {
        if (!tr.docChanged) {
          scopedView.updateState(scopedView.state.apply(tr));
          return;
        }

        pendingSelection = tr.selection;

        const idx = chapterKey.getState(bookView.state)!;
        const offset = chapterStart(bookView.state.doc, idx);

        const fullTr = bookView.state.tr;
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
          bookView.dispatch(fullTr);
        }
      },
    });

    return {
      update(bookView, prevState) {
        const newIndex = chapterKey.getState(bookView.state);
        if (newIndex === undefined) return;

        const oldIndex = chapterKey.getState(prevState);
        if (oldIndex === undefined) return;

        if (oldIndex === newIndex && bookView.state.doc === prevState.doc) return;

        const chapter = bookView.state.doc.child(newIndex);
        const doc = buildScopedDoc(chapter);

        let selection: Selection;
        if (pendingSelection) {
          selection = TextSelection.create(doc, pendingSelection.anchor, pendingSelection.head);
          pendingSelection = null;
        } else {
          selection = Selection.atStart(doc);
        }

        scopedView.updateState(
          EditorState.create({
            doc,
            selection,
            plugins: scopedView.state.plugins,
          }),
        );
      },
      destroy() {
        scopedView.destroy();
        (editorWrapper as HTMLElement).remove();
        bookView.dom.style.display = "";
      },
    };
  },
});

export function chapterStart(doc: Node, targetIndex: number): number {
  let result = -1;
  doc.forEach((_child, offset, index) => {
    if (index === targetIndex) result = offset;
  });
  if (result === -1) throw new Error(`No chapter at index ${targetIndex}`);
  return result;
}

function buildScopedDoc(fullChapter: Node): Node {
  return bookSchema.node("doc", null, fullChapter);
}

function buildScopedState(fullChapter: Node): EditorState {
  return EditorState.create({
    doc: buildScopedDoc(fullChapter),
    plugins: [keymap(baseKeymap)],
  });
}
