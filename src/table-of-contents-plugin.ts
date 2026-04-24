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
import { chapterKey, chapterStart } from "./chapter-plugin";

// ── Helpers ──────────────────────────────────────────────────────

function buildTocDoc(fullDoc: Node): Node {
  const headings: Node[] = [];
  fullDoc.forEach(function (chapter) {
    const heading = chapter.firstChild;
    if (heading) headings.push(heading);
  });
  return bookSchema.nodes.toc_doc.create(null, headings);
}

function buildTocState(fullDoc: Node): EditorState {
  return EditorState.create({
    doc: buildTocDoc(fullDoc),
    plugins: [keymap({ Enter: () => true }), keymap(baseKeymap)],
  });
}

function tocHeadingPos(tocDoc: Node, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) {
    pos += tocDoc.child(i).nodeSize;
  }
  return pos;
}

// ── Table of contents plugin ─────────────────────────────────────
// Manages the table-of-contents EditorView. Renders an editable
// flat list of chapter headings into the provided sidebar element.
// Reads and writes the active chapter index owned by chapterPlugin
// via chapterKey.

export const tableOfContentsKey = new PluginKey("tableOfContents");

export function tableOfContentsPlugin(): Plugin {
  return new Plugin({
    key: tableOfContentsKey,
    view(bookView) {
      // Insert the sidebar before the editor mount. CSS grid on
      // body uses :has(#toc) to switch to a two-column layout.
      const mount = bookView.dom.parentNode! as HTMLElement;

      const sidebar = document.createElement("div");
      sidebar.id = "toc";
      mount.parentNode!.insertBefore(sidebar, mount);

      const heading = document.createElement("h2");
      heading.textContent = "Table of Contents";
      sidebar.appendChild(heading);

      function highlightActive(): void {
        const active = chapterKey.getState(bookView.state) ?? 0;
        const headings = tocView.dom.querySelectorAll("h1");
        headings.forEach(function (h, i) {
          h.classList.toggle("active", i === active);
        });
      }

      let pendingSelection: Selection | null = null;

      let tocView!: EditorView;
      tocView = new EditorView(sidebar, {
        state: buildTocState(bookView.state.doc),
        dispatchTransaction(tr: Transaction) {
          if (!tr.docChanged) {
            tocView.updateState(tocView.state.apply(tr));

            const $head = tocView.state.selection.$head;
            if ($head.depth > 0) {
              const headingIndex = $head.index(0);
              const currentIndex = chapterKey.getState(bookView.state) ?? 0;
              if (headingIndex !== currentIndex) {
                bookView.dispatch(bookView.state.tr.setMeta(chapterKey, headingIndex));
              }
            }

            highlightActive();
            return;
          }

          pendingSelection = tr.selection;

          const oldDoc = tocView.state.doc;
          const fullTr = bookView.state.tr;

          for (const step of tr.steps) {
            const stepJson = step.toJSON();
            const from: number = stepJson.from;
            const $from = oldDoc.resolve(from);
            const hIndex = $from.depth > 0 ? $from.index(0) : 0;

            const fullPos = chapterStart(bookView.state.doc, hIndex) + 1;
            const tocPos = tocHeadingPos(oldDoc, hIndex);
            const offset = fullPos - tocPos;

            const mapped = step.map(StepMap.offset(offset));
            if (mapped) {
              const result = fullTr.maybeStep(mapped);
              if (result.failed) {
                console.warn("[toc-bridge] step failed:", result.failed);
              }
            }
          }

          if (fullTr.docChanged) {
            bookView.dispatch(fullTr);
          }
        },
      });

      highlightActive();

      return {
        update(bookView, prevState) {
          if (bookView.state.doc === prevState.doc) {
            highlightActive();
            return;
          }

          const doc = buildTocDoc(bookView.state.doc);

          let selection: Selection;
          if (pendingSelection) {
            selection = TextSelection.create(doc, pendingSelection.anchor, pendingSelection.head);
            pendingSelection = null;
          } else {
            selection = Selection.atStart(doc);
          }

          tocView.updateState(
            EditorState.create({
              doc,
              selection,
              plugins: tocView.state.plugins,
            }),
          );

          highlightActive();
        },
        destroy() {
          tocView.destroy();
          sidebar.remove();
        },
      };
    },
  });
}
