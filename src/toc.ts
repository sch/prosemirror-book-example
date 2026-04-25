import { Node } from "prosemirror-model"
import { EditorState, Transaction } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { StepMap } from "prosemirror-transform"
import { keymap } from "prosemirror-keymap"
import { baseKeymap } from "prosemirror-commands"
import { history, undo, redo } from "prosemirror-history"
import { bookSchema } from "./schema"
import {
  getFullState,
  getActiveIndex,
  setActiveIndex,
  chapterStart,
  applyToFullState,
  resyncScopedView,
} from "./scoped-view"

let tocView: EditorView | null = null

// ── Build the TOC doc from the full state ──────────────────────────
// Extracts the first child (heading) of each chapter and assembles
// them into a toc_doc node — a flat list of headings, all within
// the same bookSchema so NodeType identity is shared.

function buildTocDoc(fullDoc: Node): Node {
  const headings: Node[] = []
  fullDoc.forEach(function (chapter) {
    const heading = chapter.firstChild
    if (heading) headings.push(heading)
  })
  return bookSchema.nodes.toc_doc.create(null, headings)
}

function buildTocState(fullDoc: Node): EditorState {
  return EditorState.create({
    doc: buildTocDoc(fullDoc),
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
      keymap({ "Enter": () => true }), // prevent splitting headings
      keymap(baseKeymap),
    ],
  })
}

// ── Position math ──────────────────────────────────────────────────
// In the TOC doc, heading[i] starts at the sum of nodeSizes before it.
// In the full doc, the same heading is at chapterStart(doc, i) + 1
// (the +1 enters the chapter node to reach its first child).
//
// The offset for heading[i] = fullHeadingPos - tocHeadingPos.
// This offset is stable across multi-step transactions because
// insertions shift both docs equally.

function tocHeadingPos(tocDoc: Node, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i++) {
    pos += tocDoc.child(i).nodeSize
  }
  return pos
}

// ── The dispatch bridge ────────────────────────────────────────────
// Same idea as the chapter view's bridge, but the mapping is per-heading
// rather than a single uniform offset. For each step we:
//
// 1. Determine which heading the step falls in (via the step's from position).
// 2. Compute the offset between that heading's position in the TOC doc
//    and in the full doc.
// 3. Remap the step with StepMap.offset(delta).

function dispatchTransaction(this: EditorView, tr: Transaction): void {
  const oldDoc = this.state.doc
  this.updateState(this.state.apply(tr))

  // If the cursor moved to a different heading, switch the active chapter.
  const $head = this.state.selection.$head
  if ($head.depth > 0) {
    const headingIndex = $head.index(0)
    if (headingIndex !== getActiveIndex()) {
      console.log(`[toc-bridge] active chapter: ${getActiveIndex()} → ${headingIndex}`)
      setActiveIndex(headingIndex)
      resyncScopedView()
      highlightActive()
    }
  }

  if (!tr.docChanged) {
    highlightActive()
    return
  }

  // Remap each step into full-doc coordinates.
  const fullDoc = getFullState().doc
  const fullTr = getFullState().tr
  fullTr.setMeta("tocOrigin", true)

  for (const step of tr.steps) {
    // Find which heading this step is in.
    const stepJson = step.toJSON()
    const from: number = stepJson.from
    const $from = oldDoc.resolve(from)
    const hIndex = $from.depth > 0 ? $from.index(0) : 0

    const fullPos = chapterStart(fullDoc, hIndex) + 1
    const tocPos = tocHeadingPos(oldDoc, hIndex)
    const offset = fullPos - tocPos

    console.log(
      `[toc-bridge] heading=${hIndex}, tocPos=${tocPos}, fullPos=${fullPos}, offset=${offset}`
    )

    const mapped = step.map(StepMap.offset(offset))
    if (mapped) {
      const mappedJson = mapped.toJSON()
      console.log(
        `[toc-bridge]   ${stepJson.stepType} `
        + `toc=${stepJson.from}→${stepJson.to} `
        + `full=${mappedJson.from}→${mappedJson.to}`
      )
      const result = fullTr.maybeStep(mapped)
      if (result.failed) {
        console.warn("[toc-bridge]   step failed:", result.failed)
      }
    }
  }

  if (fullTr.docChanged) {
    applyToFullState(fullTr)
    console.log(
      `[toc-bridge] fullState updated, doc size=${getFullState().doc.content.size}`
    )
    resyncScopedView()
  }

  highlightActive()
}

// ── Active heading highlight ───────────────────────────────────────
// Direct DOM class toggle — simple and cheap.

function highlightActive(): void {
  if (!tocView) return
  const active = getActiveIndex()
  const headings = tocView.dom.querySelectorAll("h1")
  headings.forEach(function (h, i) {
    h.classList.toggle("active", i === active)
  })
}

// ── Public API ─────────────────────────────────────────────────────

export function mountTOC(container: HTMLElement): void {
  tocView = new EditorView(container, {
    state: buildTocState(getFullState().doc),
    dispatchTransaction,
  })
  highlightActive()
}

// Called by the chapter view's dispatch bridge when the full doc changes.
// Rebuilds the TOC state if any heading text differs.
export function syncTOC(): void {
  if (!tocView) return
  const fullDoc = getFullState().doc
  const tocDoc = tocView.state.doc

  // Quick check: did any heading actually change?
  let changed = tocDoc.childCount !== fullDoc.childCount
  if (!changed) {
    fullDoc.forEach(function (chapter, _offset, index) {
      if (changed) return
      const fullHeading = chapter.firstChild!
      const tocHeading = tocDoc.child(index)
      // Same schema now, so identity check works
      if (fullHeading !== tocHeading) {
        changed = true
      }
    })
  }

  if (changed) {
    tocView.updateState(buildTocState(fullDoc))
  }

  highlightActive()
}
