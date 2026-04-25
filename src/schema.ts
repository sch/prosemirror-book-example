import { Schema, type NodeSpec } from "prosemirror-model"

const chapterSpec: NodeSpec = {
  content: "heading paragraph+",
  defining: true,
  toDOM() { return ["section", 0] },
  parseDOM: [{ tag: "section" }],
}

const headingSpec: NodeSpec = {
  content: "text*",
  defining: true,
  toDOM() { return ["h1", 0] },
  parseDOM: [{ tag: "h1" }],
}

const paragraphSpec: NodeSpec = {
  content: "text*",
  toDOM() { return ["p", 0] },
  parseDOM: [{ tag: "p" }],
}

const textSpec: NodeSpec = {}

// One schema for everything. The scoped chapter view uses the normal
// `doc` type (one chapter satisfies `chapter+`). The TOC view uses
// `toc_doc` as its root — a flat list of headings. Because all views
// share a single Schema instance, every NodeType is the same object,
// so steps from one view can be applied to another without cross-schema
// type mismatches in content matching.
export const bookSchema = new Schema({
  nodes: {
    doc: { content: "chapter+" },
    toc_doc: { content: "heading+" },
    chapter: chapterSpec,
    heading: headingSpec,
    paragraph: paragraphSpec,
    text: textSpec,
  },
})
