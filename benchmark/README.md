# Benchmarks

Unit-level benchmarks comparing `graphql-breadth` against `graphql-js` using three
adjustable query shapes.

Each benchmark validates that both executors produce equivalent output before
sampling, so a mismatch fails fast.

## Running

```bash
pnpm run bench:tree         # deep tree
pnpm run bench:list         # shallow list
pnpm run bench:tree-list    # tree-within-list
```

## Deep adjustable tree

```bash
DEPTHS=1,10,18 FIELDS=id pnpm run bench:tree
```

```graphql
query {
  widget {
    widget {
      widget {
        # ... depth x N ...
      }
      id
    }
    id
  }
}
```

## Shallow adjustable list

```bash
SIZES=1,10,100,1000,10000 FIELDS=id pnpm run bench:list
```

```graphql
query {
  widgets(first: N) {
    id
  }
}
```

## Tree x list

```bash
DEPTHS=1,18 BREADTHS=1,100,1000,10000 FIELDS=id pnpm run bench:tree-list
```

```graphql
query {
  widgets(first: B) {
    widget {
      widget {
        # ... depth x D ...
      }
      id
    }
    id
  }
}
```

## Fields

`FIELDS` selects the leaf fields queried at every level. Supported values:

| field             | resolver                                        |
| ----------------- | ----------------------------------------------- |
| `id`              | property accessor (default)                     |
| `string`          | property accessor                               |
| `integer`         | property accessor                               |
| `boolean`         | property accessor                               |
| `resolveByMethod` | dedicated resolve function                      |
| `lazy`            | batched lazy load (DataLoader / LazyLoader)     |
| `lazyThen`        | batched lazy load + `.then(upcase)` callback   |

When `FIELDS` contains `lazy` or `lazyThen`, the benchmark switches to the async
path for graphql-js (`execute` with a DataLoader). graphql-breadth stays
synchronous regardless — its lazy queue drains within the executor.
