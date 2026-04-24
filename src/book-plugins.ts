import { Node } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { StepMap } from "prosemirror-transform";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import { bookSchema } from "./schema";

// ── Shared helpers ────────────────────────────────────────────────

function chapterStart(doc: Node, targetIndex: number): number {
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
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
      keymap(baseKeymap),
    ],
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

function buildTocState(fullDoc: Node): EditorState {
  return EditorState.create({
    doc: buildTocDoc(fullDoc),
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
      keymap({ Enter: () => true }),
      keymap(baseKeymap),
    ],
  });
}

function tocHeadingPos(tocDoc: Node, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) {
    pos += tocDoc.child(i).nodeSize;
  }
  return pos;
}

// ── Chapter plugin ────────────────────────────────────────────────
// Owns the active chapter index as plugin state, and manages the
// scoped chapter EditorView. Wraps bookView.dom in an editor
// wrapper, similar to how prosemirror-menu wraps the editor with
// a menu bar. The TOC plugin reads and writes the active index
// through chapterKey.

const chapterKey = new PluginKey<number>("chapter");

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
      let skipNextUpdate = false;

      // Wrap bookView.dom's parent in a flex layout, like
      // prosemirror-menu wraps the editor with a menu bar. The book
      // view's own DOM is hidden — it exists only as a state
      // coordination point.
      const mount = bookView.dom.parentNode! as HTMLElement;
      const layout = document.createElement("div");
      layout.id = "book-layout";
      mount.parentNode!.replaceChild(layout, mount);
      layout.appendChild(mount);

      const editorWrapper = document.createElement("div");
      editorWrapper.id = "editor-wrapper";
      layout.appendChild(editorWrapper);

      const editorContainer = document.createElement("div");
      editorWrapper.appendChild(editorContainer);

      bookView.dom.style.display = "none";

      const activeIndex = chapterKey.getState(bookView.state)!;
      const chapter = bookView.state.doc.child(activeIndex);

      let scopedView!: EditorView;
      scopedView = new EditorView(editorContainer, {
        state: buildScopedState(chapter),
        dispatchTransaction(tr: Transaction) {
          // 1. Apply locally so typing feels instant.
          scopedView.updateState(scopedView.state.apply(tr));

          // 2. Nothing to bridge if the document didn't change.
          if (!tr.docChanged) return;

          // 3. Compute the offset for the active chapter in the full doc.
          const idx = chapterKey.getState(bookView.state)!;
          const offset = chapterStart(bookView.state.doc, idx);
          console.log(
            `[chapter-bridge] chapter=${idx}, offset=${offset}, steps=${tr.steps.length}`,
          );

          // 4. Remap each step from scoped to full-doc coordinates.
          const fullTr = bookView.state.tr;
          fullTr.setMeta("scopedOrigin", true);

          for (const step of tr.steps) {
            const stepJson = step.toJSON();
            const mapped = step.map(StepMap.offset(offset));
            if (mapped) {
              const mappedJson = mapped.toJSON();
              console.log(
                `[chapter-bridge]   ${stepJson.stepType} ` +
                  `scoped=${stepJson.from}→${stepJson.to} ` +
                  `full=${mappedJson.from}→${mappedJson.to}`,
              );
              const result = fullTr.maybeStep(mapped);
              if (result.failed) {
                console.warn("[chapter-bridge]   step failed:", result.failed);
              }
            } else {
              console.warn("[chapter-bridge]   mapping returned null");
            }
          }

          // 5. Commit to the book view.
          if (fullTr.docChanged) {
            skipNextUpdate = true;
            bookView.dispatch(fullTr);
            console.log(
              `[chapter-bridge] fullState updated, doc size=${bookView.state.doc.content.size}`,
            );
          }
        },
      });

      return {
        update(bookView, prevState) {
          if (skipNextUpdate) {
            skipNextUpdate = false;
            return;
          }

          const newIndex = chapterKey.getState(bookView.state);
          if (newIndex === undefined) return;

          const oldIndex = chapterKey.getState(prevState);
          if (oldIndex === undefined) return;

          if (oldIndex === newIndex && bookView.state.doc === prevState.doc) return;

          const chapter = bookView.state.doc.child(newIndex);
          scopedView.updateState(buildScopedState(chapter));
        },
        destroy() {
          scopedView.destroy();
          layout.parentNode?.replaceChild(mount, layout);
          bookView.dom.style.display = "";
        },
      };
    },
  });
}

// ── TOC plugin ────────────────────────────────────────────────────
// Manages the table-of-contents EditorView. Creates its own sidebar
// DOM and inserts it before bookView.dom, similar to how
// prosemirror-menu prepends a menu bar. Reads and writes the active
// chapter index owned by chapterPlugin via chapterKey.

export function tocPlugin(): Plugin {
  return new Plugin({
    view(bookView) {
      let skipNextUpdate = false;

      // Build the sidebar DOM — the plugin owns this entirely.
      const sidebar = document.createElement("div");
      sidebar.id = "toc";

      const heading = document.createElement("h2");
      heading.textContent = "Table of Contents";
      sidebar.appendChild(heading);

      // Insert the sidebar as the first child of the flex layout
      // created by chapterPlugin. bookView.dom sits inside mount,
      // which sits inside the layout container.
      const mount = bookView.dom.parentNode! as HTMLElement;
      mount.parentNode!.insertBefore(sidebar, mount);

      function highlightActive(): void {
        const active = chapterKey.getState(bookView.state)!;
        const headings = tocView.dom.querySelectorAll("h1");
        headings.forEach(function (h, i) {
          h.classList.toggle("active", i === active);
        });
      }

      let tocView!: EditorView;
      tocView = new EditorView(sidebar, {
        state: buildTocState(bookView.state.doc),
        dispatchTransaction(tr: Transaction) {
          const oldDoc = tocView.state.doc;
          tocView.updateState(tocView.state.apply(tr));

          // If the cursor moved to a different heading, switch chapter.
          const $head = tocView.state.selection.$head;
          if ($head.depth > 0) {
            const headingIndex = $head.index(0);
            const currentIndex = chapterKey.getState(bookView.state)!;
            if (headingIndex !== currentIndex) {
              console.log(`[toc-bridge] active chapter: ${currentIndex} → ${headingIndex}`);
              bookView.dispatch(bookView.state.tr.setMeta(chapterKey, headingIndex));
            }
          }

          if (!tr.docChanged) {
            highlightActive();
            return;
          }

          // Remap each step into full-doc coordinates.
          const fullDoc = bookView.state.doc;
          const fullTr = bookView.state.tr;
          fullTr.setMeta("tocOrigin", true);

          for (const step of tr.steps) {
            const stepJson = step.toJSON();
            const from: number = stepJson.from;
            const $from = oldDoc.resolve(from);
            const hIndex = $from.depth > 0 ? $from.index(0) : 0;

            const fullPos = chapterStart(fullDoc, hIndex) + 1;
            const tocPos = tocHeadingPos(oldDoc, hIndex);
            const offset = fullPos - tocPos;

            console.log(
              `[toc-bridge] heading=${hIndex}, tocPos=${tocPos}, fullPos=${fullPos}, offset=${offset}`,
            );

            const mapped = step.map(StepMap.offset(offset));
            if (mapped) {
              const mappedJson = mapped.toJSON();
              console.log(
                `[toc-bridge]   ${stepJson.stepType} ` +
                  `toc=${stepJson.from}→${stepJson.to} ` +
                  `full=${mappedJson.from}→${mappedJson.to}`,
              );
              const result = fullTr.maybeStep(mapped);
              if (result.failed) {
                console.warn("[toc-bridge]   step failed:", result.failed);
              }
            }
          }

          if (fullTr.docChanged) {
            skipNextUpdate = true;
            bookView.dispatch(fullTr);
            console.log(
              `[toc-bridge] fullState updated, doc size=${bookView.state.doc.content.size}`,
            );
          }

          highlightActive();
        },
      });

      highlightActive();

      return {
        update(bookView, _prevState) {
          if (skipNextUpdate) {
            skipNextUpdate = false;
            highlightActive();
            return;
          }

          const fullDoc = bookView.state.doc;
          const tocDoc = tocView.state.doc;

          let changed = tocDoc.childCount !== fullDoc.childCount;
          if (!changed) {
            fullDoc.forEach(function (chapter, _offset, index) {
              if (changed) return;
              const fullHeading = chapter.firstChild!;
              const tocHeading = tocDoc.child(index);
              if (fullHeading !== tocHeading) {
                changed = true;
              }
            });
          }

          if (changed) {
            tocView.updateState(buildTocState(fullDoc));
          }

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
