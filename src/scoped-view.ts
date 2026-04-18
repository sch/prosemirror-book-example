import { Node } from "prosemirror-model";
import { EditorState, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { StepMap } from "prosemirror-transform";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import { bookSchema } from "./schema";
import { syncTOC } from "./toc";

// ── Module-level state ─────────────────────────────────────────────
// There is exactly one source of truth: fullState.
// The scoped view is always a derived projection of one chapter.

let fullState: EditorState;
let activeIndex: number = 0;
let scopedView: EditorView | null = null;

export function initFullState(doc: Node): void {
  fullState = EditorState.create({ doc, schema: bookSchema });
}

export function getFullState(): EditorState {
  return fullState;
}

export function getActiveIndex(): number {
  return activeIndex;
}

export function setActiveIndex(index: number): void {
  activeIndex = index;
}

// ── Core operations ────────────────────────────────────────────────

// Returns the absolute position of the opening token of chapter[index]
// in a bookSchema doc. doc.forEach gives content-relative offsets, which
// for the top-level doc node ARE absolute positions.
export function chapterStart(doc: Node, targetIndex: number): number {
  let result = -1;
  doc.forEach((_child, offset, index) => {
    if (index === targetIndex) result = offset;
  });
  if (result === -1) throw new Error(`No chapter at index ${targetIndex}`);
  return result;
}

// Wraps a chapter node in a bookSchema doc. Since the scoped view now
// uses the same schema as the full state, there's no cross-schema
// boundary — steps apply directly.
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

// ── The dispatch bridge ────────────────────────────────────────────
// The scoped view's dispatchTransaction:
//
// 1. Applies the transaction to the scoped view immediately (instant typing).
// 2. If the doc changed, remaps every step from scoped coordinates into
//    full-doc coordinates using StepMap.offset(), then applies them to
//    fullState.
//
// Because both docs wrap the chapter identically (doc > chapter > ...),
// every position inside the chapter differs by exactly chapterStart(doc, i).
// StepMap.offset(n) shifts all positions by n without deleting anything,
// so step.map() should always succeed for valid steps.

function dispatchTransaction(this: EditorView, tr: Transaction): void {
  // 1. Apply locally so typing feels instant.
  this.updateState(this.state.apply(tr));

  // 2. Nothing to bridge if the document didn't change.
  if (!tr.docChanged) return;

  // 3. Compute the offset: where does this chapter start in the full doc?
  const offset = chapterStart(fullState.doc, activeIndex);
  console.log(
    `[chapter-bridge] chapter=${activeIndex}, offset=${offset}, steps=${tr.steps.length}`,
  );

  // 4. Remap each step from scoped coordinates to full-doc coordinates.
  const fullTr = fullState.tr;
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

  // 5. Commit the bridged transaction to the authoritative state.
  if (fullTr.docChanged) {
    fullState = fullState.apply(fullTr);
    console.log(`[chapter-bridge] fullState updated, doc size=${fullState.doc.content.size}`);
  }

  // 6. Sync the TOC (heading text may have changed).
  syncTOC();
}

// ── Public API ─────────────────────────────────────────────────────

export function applyToFullState(tr: Transaction): void {
  fullState = fullState.apply(tr);
}

export function resyncScopedView(): void {
  if (!scopedView) return;
  const chapter = fullState.doc.child(activeIndex);
  scopedView.updateState(buildScopedState(chapter));
}

export function selectChapter(index: number): void {
  activeIndex = index;
  resyncScopedView();
  syncTOC();
}

export function mountScopedView(container: HTMLElement): void {
  const chapter = fullState.doc.child(activeIndex);
  scopedView = new EditorView(container, {
    state: buildScopedState(chapter),
    dispatchTransaction,
  });
}

// ── Known limitations (documented, not fixed) ──────────────────────
//
// - Undo/redo is per-chapter-session because history lives on the scoped
//   state. Real fix: move history to fullState and delegate undo from the
//   scoped dispatch, then rebuild the scoped state.
//
// - External edits to fullState (collaboration, TOC rename) aren't
//   reflected in the scoped view. Real fix: a syncScopedFromFull() that
//   rebuilds the scoped doc and calls scopedView.updateState() preserving
//   selection where possible.
//
// - Chapter switch resets cursor to start. Real fix: a
//   Map<chapterId, selectionRange> keyed by a stable chapter attr.
