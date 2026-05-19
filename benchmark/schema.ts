import {
  GraphQLBoolean,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";
import DataLoader from "dataloader";

// Used by both graphql-js (default resolvers + custom resolve for lazy fields)
// and graphql-breadth (resolvers passed separately). graphql-breadth ignores
// graphql-js `resolve` functions, so attaching them here is safe.

type Source = Record<string, unknown>;
type LazyKey = "lazy" | "lazyThen";

export interface BenchContext {
  loaders: Record<LazyKey, DataLoader<Source, unknown>>;
}

export function createBenchContext(): BenchContext {
  return {
    loaders: {
      lazy: makeLoader("lazy"),
      lazyThen: makeLoader("lazyThen"),
    },
  };
}

function makeLoader(key: LazyKey): DataLoader<Source, unknown> {
  return new DataLoader<Source, unknown>(
    async (sources) => sources.map((s) => s[key]),
    { cache: false },
  );
}

const WidgetType: GraphQLObjectType = new GraphQLObjectType<Source, BenchContext>({
  name: "Widget",
  fields: () => ({
    id: { type: GraphQLID },
    string: { type: GraphQLString },
    integer: { type: GraphQLInt },
    boolean: { type: GraphQLBoolean },
    widget: { type: WidgetType },
    widgets: { type: new GraphQLList(WidgetType) },
    resolveByMethod: {
      type: GraphQLString,
      resolve: (source) => source["resolveByMethod"],
    },
    lazy: {
      type: GraphQLString,
      resolve: (source, _args, context) => context.loaders.lazy.load(source),
    },
    lazyThen: {
      type: GraphQLString,
      resolve: (source, _args, context) =>
        context.loaders.lazyThen
          .load(source)
          .then((value) => (typeof value === "string" ? value.toUpperCase() : value)),
    },
  }),
});

const QueryType = new GraphQLObjectType<Source, BenchContext>({
  name: "Query",
  fields: {
    widget: { type: WidgetType },
    widgets: {
      type: new GraphQLList(WidgetType),
      args: { first: { type: GraphQLInt } },
    },
  },
});

export const schema = new GraphQLSchema({ query: QueryType });
