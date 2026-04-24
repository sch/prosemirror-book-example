import { Node } from "prosemirror-model";
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

// ── Shared helpers ────────────────────────────────────────────────

export const chapterKey = new PluginKey<number>("chapter");

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

// ── Chapter plugin ────────────────────────────────────────────────
// Owns the active chapter index as plugin state, and manages the
// scoped chapter EditorView. The scoped view renders a single
// chapter; the book view's own DOM is hidden while this plugin is
// active. The TOC plugin reads and writes the active index through
// chapterKey.

export function chapterPlugin(): Plugin<number> {
  return new Plugin<number>({
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
      // Create a wrapper for the scoped editor and insert it after
      // the book view's mount. The book view's DOM is hidden while
      // this plugin is active.
      const mount = bookView.dom.parentNode! as HTMLElement;

      const editorWrapper = document.createElement("div");
      editorWrapper.id = "editor-wrapper";
      mount.appendChild(editorWrapper);

      const editorContainer = document.createElement("div");
      editorWrapper.appendChild(editorContainer);

      bookView.dom.style.display = "none";

      const activeIndex = chapterKey.getState(bookView.state)!;
      const chapter = bookView.state.doc.child(activeIndex);

      // Stashed from dispatchTransaction so update() can restore
      // the cursor after rebuilding the scoped state.
      let pendingSelection: Selection | null = null;

      let scopedView!: EditorView;
      scopedView = new EditorView(editorContainer, {
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
          editorWrapper.remove();
          bookView.dom.style.display = "";
        },
      };
    },
  });
}
