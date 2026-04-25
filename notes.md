# Notes

## Cross-Schema NodeType Identity

ProseMirror's content matching uses identity comparison (`==`) when
checking whether a node's type satisfies a content expression. This
means that `NodeType` objects from different `Schema` instances are
never interchangeable, even if they were created from the same
`NodeSpec`.

### Why it happens

`new Schema(...)` always calls `NodeType.compile()`, which calls
`new NodeType()` for every node in the spec. Each `NodeType` stores a
back-reference to its parent `Schema`. There is no caching or instance
sharing across schemas.

```ts
// prosemirror-model/src/schema.ts — NodeType.compile
static compile(nodes, schema) {
  let result = Object.create(null)
  nodes.forEach((name, spec) => result[name] = new NodeType(name, schema, spec))
  return result
}
```

So even if two schemas share the exact same `NodeSpec` objects:

```ts
const schemaA = new Schema({ nodes: { doc: { content: "heading+" }, heading: headingSpec, text: textSpec } })
const schemaB = new Schema({ nodes: { doc: { content: "chapter+" }, heading: headingSpec, text: textSpec } })

schemaA.nodes.heading === schemaB.nodes.heading  // false
schemaA.nodes.text === schemaB.nodes.text        // false
```

### How it manifests

If you create a `Step` in one schema's view and apply it to a document
from another schema (e.g., via `StepMap.offset()` remapping), the
step's `Slice` carries nodes typed under the source schema. When
ProseMirror applies the step to the target document, the `replace`
algorithm validates the result against the target schema's content
expressions. The content match walks each child and checks
`this.next[i].type == type` — an identity comparison that fails across
schemas. This surfaces as:

```
RangeError: Invalid content for node heading: <"existing text", "new text">
```

The two text nodes can't be merged because they're different `NodeType`
objects, even though both are named "text" with identical specs.

### The fix

Use a **single `Schema` instance** for all views. If different views
need different root node structures, add multiple root-level node types
to the same schema:

```ts
export const bookSchema = new Schema({
  nodes: {
    doc:     { content: "chapter+" },   // full book and scoped chapter view
    toc_doc: { content: "heading+" },   // table of contents view
    chapter: chapterSpec,
    heading: headingSpec,
    paragraph: paragraphSpec,
    text: textSpec,
  },
})
```

The scoped view uses the normal `doc` type (one chapter satisfies
`chapter+`). The TOC view uses `toc_doc` as its root. Because every
`NodeType` comes from the same `Schema` instance, content matching
succeeds and text nodes merge correctly during step application.

### Why `topNode` doesn't help

The `topNode` schema option only controls which node type becomes
`schema.topNodeType` — the default root when `EditorState.create` is
called without an explicit `doc`. It doesn't change how `NodeType`
instances are allocated. Creating a second schema with a different
`topNode` still produces entirely new `NodeType` objects.
