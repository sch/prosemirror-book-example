import { Schema } from "prosemirror-model";

// One schema for all views. The scoped chapter view uses the normal
// `doc` type (one chapter satisfies `chapter+`). The TOC view uses
// `toc_doc` as its root — a flat list of headings. Because all views
// share a single Schema instance, every NodeType is the same object,
// so steps from one view can be applied to another without cross-schema
// type mismatches in content matching.
export const bookSchema = new Schema({
  nodes: {
    doc: { content: "chapter+" },
    toc_doc: { content: "heading+" },
    chapter: {
      content: "heading block+",
      defining: true,
      toDOM: () => ["section", 0],
      parseDOM: [{ tag: "section" }],
    },
    heading: {
      content: "text*",
      marks: "",
      defining: true,
      toDOM: () => ["h1", 0],
      parseDOM: [{ tag: "h1" }],
    },
    paragraph: {
      group: "block",
      content: "inline*",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    code_block: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      toDOM: () => ["pre", ["code", 0]],
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
    },
    text: { group: "inline" },
  },
  marks: {
    code: {
      toDOM: () => ["code", 0],
      parseDOM: [{ tag: "code" }],
    },
  },
});
