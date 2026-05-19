export type WidgetSource = Record<string, unknown>;

const MAX_DEPTH = 18;

export function addFields(obj: WidgetSource, fields: string[]): WidgetSource {
  for (const field of fields) {
    switch (field) {
      case "id":
        obj[field] = "gid://owner/Widget/1";
        break;
      case "string":
      case "resolveByMethod":
        obj[field] = "Yo";
        break;
      case "integer":
        obj[field] = 1;
        break;
      case "boolean":
        obj[field] = true;
        break;
      case "lazy":
      case "lazyThen":
        obj[field] = "Lazy";
        break;
    }
  }
  return obj;
}

export function buildTree(
  depth: number,
  fields: string[],
): { query: string; source: WidgetSource } {
  if (depth > MAX_DEPTH) {
    throw new Error(`Maximum allowed depth is ${MAX_DEPTH}`);
  }

  let query = fields.join(" ");
  let source: WidgetSource = addFields({}, fields);

  for (let i = 0; i < depth; i++) {
    query = `widget { ${query} ${fields.join(" ")} }`;
    source = addFields({ widget: source }, fields);
  }

  return { query, source };
}

export function buildList(
  size: number,
  fields: string[],
): { query: string; source: WidgetSource } {
  const widget = addFields({}, fields);
  const source: WidgetSource = { widgets: new Array(size).fill(widget) };
  const query = `widgets(first: ${size}) { ${fields.join(" ")} }`;
  return { query, source };
}

export function buildBreadthTree(
  depth: number,
  breadth: number,
  fields: string[],
): { query: string; source: WidgetSource } {
  const { query: treeQuery, source: treeSource } = buildTree(depth, fields);
  const source: WidgetSource = {
    widgets: new Array(breadth).fill(treeSource),
  };
  const query = `widgets(first: ${breadth}) { ${treeQuery} }`;
  return { query, source };
}
