import { DOMSerializer, Node } from "prosemirror-model";
import {
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { StepMap } from "prosemirror-transform";
import { keymap } from "prosemirror-keymap";
import { bookSchema } from "./schema";
import { chapterKey, chapterStart } from "./chapter-plugin";

export const tableOfContentsKey = new PluginKey("tableOfContents");

const renderSpec = DOMSerializer.renderSpec.bind(null, document);

// Editable flat list of chapter headings. Same dispatch bridge pattern as the
// chapter plugin, but the offset calculation is per-heading (each heading sits
// at a different position in the full doc). Selection changes drive chapter
// switching via chapterKey
export function tableOfContentsPlugin(): Plugin {
  return new Plugin({
    key: tableOfContentsKey,
    view(bookView) {
      // Insert the sidebar before the editor mount
      const mount = bookView.dom.parentNode! as HTMLElement;

      const { dom: sidebar, contentDOM } = renderSpec([
        "div",
        { id: "toc" },
        ["h2", "Table of Contents"],
        ["div", 0],
      ]);
      mount.parentNode!.insertBefore(sidebar, mount);

      let activeIndex = chapterKey.getState(bookView.state) ?? 0;
      let pendingSelection: Selection | null = null;

      const tocView = new EditorView(contentDOM!, {
        state: EditorState.create({
          doc: buildTocDoc(bookView.state.doc),
          plugins: [keymap({ Enter: () => true })],
        }),
        decorations(state) {
          const decorations: Decoration[] = [];
          state.doc.forEach(function (node, offset, index) {
            if (index === activeIndex) {
              decorations.push(
                Decoration.node(offset, offset + node.nodeSize, {
                  class: "active",
                }),
              );
            }
          });
          return DecorationSet.create(state.doc, decorations);
        },
        dispatchTransaction(tr: Transaction) {
          if (!tr.docChanged) {
            tocView.updateState(tocView.state.apply(tr));

            const $head = tocView.state.selection.$head;
            if ($head.depth > 0) {
              const headingIndex = $head.index(0);
              const currentIndex = chapterKey.getState(bookView.state) ?? 0;
              if (headingIndex !== currentIndex) {
                bookView.dispatch(
                  bookView.state.tr.setMeta(chapterKey, headingIndex),
                );
              }
            }

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

      return {
        update(bookView, prevState) {
          activeIndex = chapterKey.getState(bookView.state) ?? 0;

          if (bookView.state.doc === prevState.doc) {
            // Active chapter changed but doc didn't. Rebuild state so the
            // decoration plugin re-evaluates
            tocView.updateState(
              EditorState.create({
                doc: tocView.state.doc,
                selection: tocView.state.selection,
                plugins: tocView.state.plugins,
              }),
            );
            return;
          }

          // If no heading node changed (user typed in a chapter body), skip the
          // rebuild. But if pendingSelection is set, the TOC itself initiated
          // the edit and needs its cursor back
          if (
            !pendingSelection &&
            headingsUnchanged(prevState.doc, bookView.state.doc)
          ) {
            return;
          }

          const doc = buildTocDoc(bookView.state.doc);

          let selection: Selection;
          if (pendingSelection) {
            const { anchor, head } = pendingSelection;
            selection = TextSelection.create(doc, anchor, head);
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
        },
        destroy() {
          tocView.destroy();
          (sidebar as HTMLElement).remove();
        },
      };
    },
  });
}

function buildTocDoc(fullDoc: Node): Node {
  const headings: Node[] = [];
  fullDoc.forEach(function (chapter) {
    const heading = chapter.firstChild;
    if (heading) headings.push(heading);
  });
  return bookSchema.nodes.toc_doc.create(null, headings);
}

function tocHeadingPos(tocDoc: Node, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) {
    pos += tocDoc.child(i).nodeSize;
  }
  return pos;
}

function headingsUnchanged(oldDoc: Node, newDoc: Node): boolean {
  if (oldDoc.childCount !== newDoc.childCount) return false;
  for (let i = 0; i < oldDoc.childCount; i++) {
    if (oldDoc.child(i).firstChild !== newDoc.child(i).firstChild) return false;
  }
  return true;
}
