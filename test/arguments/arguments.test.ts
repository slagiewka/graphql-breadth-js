import { buildSchema } from "graphql";
import { Executor, FieldResolver, type ResolverMap } from "../../src";
import type { ExecutionField } from "../../src/executor/execution_field";

const SDL = `
  enum Color { RED GREEN BLUE }
  input Filter { min: Int!, max: Int = 100, tag: String }
  type Query {
    echo(value: String!, count: Int = 1, color: Color): String
    bucket(filter: Filter!): [Int!]!
  }
`;

const schema = buildSchema(SDL);

class CaptureArgsResolver extends FieldResolver {
  public lastArgs: Record<string, unknown> | null = null;
  override resolve(execField: ExecutionField): unknown[] {
    this.lastArgs = execField.arguments;
    const { value, count, color } = execField.arguments as {
      value: string;
      count: number;
      color?: string | null;
    };
    return execField.mapObjects(() => {
      const suffix = color ? `-${color}` : "";
      return `${value}${suffix}`.repeat(count);
    });
  }
}

class BucketResolver extends FieldResolver {
  override resolve(execField: ExecutionField): unknown[] {
    const filter = execField.arguments["filter"] as {
      min: number;
      max: number;
      tag?: string | null;
    };
    return execField.mapObjects(() => {
      const out: number[] = [];
      for (let i = filter.min; i <= filter.max; i++) out.push(i);
      return out;
    });
  }
}

function run(query: string, variables: Record<string, unknown> = {}) {
  const echoResolver = new CaptureArgsResolver();
  const resolvers: ResolverMap = {
    Query: {
      echo: echoResolver,
      bucket: new BucketResolver(),
    },
  };
  const executor = Executor.build({
    schema,
    document: query,
    resolvers,
    variables,
  });
  return { result: executor.result, echo: echoResolver };
}

describe("argument coercion (graphql-js native)", () => {
  test("applies argument default values", () => {
    const { result, echo } = run(`{ echo(value: "hi") }`);
    expect(result).toEqual({ data: { echo: "hi" } });
    expect(echo.lastArgs).toEqual({ value: "hi", count: 1 });
  });

  test("coerces enum literals to their external values", () => {
    const { result, echo } = run(`{ echo(value: "hi", color: RED, count: 2) }`);
    expect(result).toEqual({ data: { echo: "hi-REDhi-RED" } });
    expect(echo.lastArgs).toEqual({ value: "hi", color: "RED", count: 2 });
  });

  test("substitutes variables with type coercion", () => {
    const { result, echo } = run(
      `query ($v: String!, $n: Int, $c: Color) { echo(value: $v, count: $n, color: $c) }`,
      { v: "yo", n: 3, c: "BLUE" },
    );
    expect(result).toEqual({ data: { echo: "yo-BLUEyo-BLUEyo-BLUE" } });
    expect(echo.lastArgs).toEqual({ value: "yo", count: 3, color: "BLUE" });
  });

  test("coerces input objects with nested defaults", () => {
    const { result } = run(`{ bucket(filter: { min: 3 }) }`);
    expect(result).toEqual({
      data: { bucket: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100] },
    });
  });

  test("surfaces variable coercion errors before execution", () => {
    const { result } = run(
      `query ($c: Color!) { echo(value: "x", color: $c) }`,
      { c: "MAUVE" },
    );
    expect(result.data).toBeUndefined();
    expect(result.errors?.length).toBe(1);
    expect(result.errors?.[0]?.message).toMatch(/MAUVE/);
  });

  test("surfaces invalid argument literals as field errors", () => {
    // Passing a non-existent enum literal is caught by graphql-js validation.
    const { result } = run(`{ echo(value: "x", color: PURPLE) }`);
    expect(result.errors?.length).toBeGreaterThanOrEqual(1);
    expect(result.errors?.[0]?.message).toMatch(/PURPLE|Color/);
  });
});
