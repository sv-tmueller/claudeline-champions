/**
 * The JSON text of `sample` with the fields at the dot paths replaced; the value `undefined` removes
 * the field. A numeric segment indexes an array. The sample itself is not changed.
 */
export function edit(sample: unknown, ...edits: [path: string, value: unknown][]): string {
  const copy: unknown = JSON.parse(JSON.stringify(sample));
  for (const [path, value] of edits) {
    const parts = path.split('.');
    const last = parts.pop();
    if (last === undefined) throw new Error('empty path');
    let node = copy as Record<string, unknown>;
    for (const part of parts) node = node[part] as Record<string, unknown>;
    if (value === undefined) delete node[last];
    else node[last] = value;
  }
  return JSON.stringify(copy);
}

/** The valid sample of one type, typed as that message, so a row can name the message it edits. */
export function byType<T extends { t: string }, K extends T['t']>(
  messages: readonly T[],
  t: K,
): Extract<T, { t: K }> {
  const found = messages.find((m) => m.t === t);
  if (found === undefined) throw new Error(`no sample of type ${t}`);
  return found as Extract<T, { t: K }>;
}
