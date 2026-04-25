import { DOMSerializer, Node, type DOMOutputSpec } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, Selection, TextSelection } from "prosemirror-state";
import type { PluginView } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { StepMap } from "prosemirror-transform";
import { bookSchema } from "./schema";
import { chapterKey, chapterStart } from "./chapter-plugin";

// Editable flat list of chapter headings. Same dispatch bridge pattern as the
// chapter plugin, but the offset calculation is per-heading (each heading sits
// at a different position in the full doc). Selection changes drive chapter
// switching via chapterKey
export const tableOfContentsPlugin = new Plugin({
  key: new PluginKey("tableOfContents"),
  view(editorView) {
    return new TableOfContentsView(editorView);
  },
});

class TableOfContentsView implements PluginView {
  private sidebar: HTMLElement;
  private tocView: EditorView;
  private activeIndex: number;
  private pendingSelection: Selection | null = null;

  private spec: DOMOutputSpec = ["nav", ["h2", "Table of Contents"], ["div", 0]];

  constructor(private editorView: EditorView) {
    const mount = editorView.dom.parentNode!;
    const { dom: sidebar, contentDOM } = DOMSerializer.renderSpec(document, this.spec);
    if (!(sidebar instanceof HTMLElement)) throw new Error("spec can't be a string");
    if (!contentDOM) throw new Error("spec property lacks and output region");
    this.sidebar = sidebar;
    mount.parentNode!.insertBefore(sidebar, mount);
    const place = { mount: contentDOM };

    this.activeIndex = resolveActiveIndex(editorView);

    this.tocView = new EditorView(place, {
      state: EditorState.create({
        doc: buildTocDoc(editorView.state.doc),
      }),
      decorations: (state) => {
        const decorations: Decoration[] = [];
        state.doc.forEach((node, offset, index) => {
          if (index === this.activeIndex) {
            decorations.push(
              Decoration.node(offset, offset + node.nodeSize, {
                class: "active",
              }),
            );
          }
        });
        return DecorationSet.create(state.doc, decorations);
      },
      dispatchTransaction: (tr) => {
        if (!tr.docChanged) {
          this.tocView.updateState(this.tocView.state.apply(tr));

          const { $head } = this.tocView.state.selection;
          if ($head.depth > 0) {
            const headingIndex = $head.index(0);
            const currentIndex = chapterKey.getState(this.editorView.state) ?? 0;
            if (headingIndex !== currentIndex) {
              this.editorView.dispatch(this.editorView.state.tr.setMeta(chapterKey, headingIndex));
            }
          }

          return;
        }

        this.pendingSelection = tr.selection;

        const { $head } = this.tocView.state.selection;
        const hIndex = $head.depth > 0 ? $head.index(0) : 0;
        const bookOffset = chapterStart(this.editorView.state.doc, hIndex);
        const headerOffset = tocHeadingPos(this.tocView.state.doc, hIndex);
        const offset = bookOffset + 1 - headerOffset;

        const outerTr = this.editorView.state.tr;
        for (const step of tr.steps) {
          const mapped = step.map(StepMap.offset(offset));
          if (mapped) {
            const result = outerTr.maybeStep(mapped);
            if (result.failed) {
              console.warn("[toc-bridge] step failed:", result.failed);
            }
          }
        }

        if (outerTr.docChanged) {
          this.editorView.dispatch(outerTr);
        }
      },
    });
  }

  update(outerView: EditorView, prevState: EditorState) {
    this.editorView = outerView;
    const prevActiveIndex = this.activeIndex;
    this.activeIndex = resolveActiveIndex(outerView);

    if (outerView.state.doc === prevState.doc) {
      if (this.activeIndex !== prevActiveIndex) {
        // Active chapter changed but doc didn't
        forceRedraw(this.tocView);
      }
      return;
    }

    // If no heading node changed (user typed in a chapter body), skip the
    // rebuild. But if pendingSelection is set, the TOC itself initiated the
    // edit and needs its cursor back
    if (!this.pendingSelection && headingsUnchanged(prevState.doc, outerView.state.doc)) {
      if (this.activeIndex !== prevActiveIndex) {
        forceRedraw(this.tocView);
      }
      return;
    }

    const doc = buildTocDoc(outerView.state.doc);

    let selection: Selection;
    if (this.pendingSelection) {
      const { anchor, head } = this.pendingSelection;
      selection = TextSelection.create(doc, anchor, head);
      this.pendingSelection = null;
    } else {
      selection = Selection.atStart(doc);
    }

    this.tocView.updateState(
      EditorState.create({
        doc,
        selection,
        plugins: this.tocView.state.plugins,
      }),
    );
  }

  destroy() {
    this.tocView.destroy();
    (this.sidebar as HTMLElement).remove();
  }
}

function buildTocDoc(fullDoc: Node) {
  const headings: Node[] = [];
  fullDoc.forEach(function (chapter) {
    const heading = chapter.firstChild;
    if (heading) headings.push(heading);
  });
  return bookSchema.nodes.toc_doc.create(null, headings);
}

function tocHeadingPos(tocDoc: Node, index: number) {
  let pos = 0;
  for (let i = 0; i < index; i++) {
    pos += tocDoc.child(i).nodeSize;
  }
  return pos;
}

// The selected chapter node's index. Either comes from the chapter plugin's
// focued node or the active selection in the parent doc
function resolveActiveIndex(view: EditorView) {
  const chapterState = chapterKey.getState(view.state);
  if (chapterState != null) return chapterState;
  return view.state.selection.$head.index(0);
}

// Apply an empty transaction so the decorations function re-evaluates
function forceRedraw(view: EditorView) {
  view.updateState(view.state.apply(view.state.tr));
}

function headingsUnchanged(oldDoc: Node, newDoc: Node) {
  if (oldDoc.childCount !== newDoc.childCount) return false;
  for (let i = 0; i < oldDoc.childCount; i++) {
    if (oldDoc.child(i).firstChild !== newDoc.child(i).firstChild) return false;
  }
  return true;
}
