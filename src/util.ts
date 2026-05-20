import {
  GraphQLList,
  GraphQLNonNull,
  isListType,
  isNonNullType,
  isWrappingType,
  type GraphQLOutputType,
  type GraphQLType,
} from "graphql";

export function unwrapNonNull<T extends GraphQLType>(type: T): T {
  let t: GraphQLType = type;
  while (isNonNullType(t)) {
    t = t.ofType;
  }
  return t as T;
}

export function unwrapType(type: GraphQLType): GraphQLType {
  let t = type;
  while (isWrappingType(t)) {
    t = t.ofType;
  }
  return t;
}

export function isListLike(type: GraphQLType): type is GraphQLList<GraphQLOutputType> | GraphQLNonNull<GraphQLList<GraphQLOutputType>> {
  return isListType(type) || (isNonNullType(type) && isListType(type.ofType));
}

// Sentinel marking "no value installed" — never appears in result.
// Compared with `===` only.
export const UNDEFINED: unique symbol = Symbol("undefined");

export function isThenable<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
