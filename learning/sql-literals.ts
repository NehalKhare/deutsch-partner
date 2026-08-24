/**
 * Rendering values into generated SQL.
 *
 * A double quote in the content would read as a quoted identifier and trip the
 * migration hygiene gate, so it is refused here where the cause is obvious
 * rather than three steps later in a failing test.
 */

export function quoteLiteral(value: string): string {
  if (value.includes('"')) {
    throw new Error(
      `generated SQL content may not contain a double quote: ${value.slice(0, 40)}`,
    );
  }

  return `'${value.replaceAll("'", "''")}'`;
}

export function textArray(values: readonly string[]): string {
  return values.length === 0
    ? "'{}'::text[]"
    : `array[${values.map(quoteLiteral).join(", ")}]::text[]`;
}

/** jsonb_build_object rather than a JSON literal, which would need quotes. */
export function jsonObject(value: Readonly<Record<string, number>>): string {
  const pairs = Object.entries(value)
    .map(([key, number]) => `${quoteLiteral(key)}, ${number}`)
    .join(", ");

  return `jsonb_build_object(${pairs})`;
}
