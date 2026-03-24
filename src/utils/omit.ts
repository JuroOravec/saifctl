/**
 * Shallow copy of `obj` without the listed keys (lodash-style).
 *
 * @param obj - Source object
 * @param keys - Keys to drop; use `as const` so the return type is inferred as {@link Omit}
 */
export function omit<T extends object, const K extends readonly (keyof T)[]>(
  obj: T,
  keys: K,
): Omit<T, K[number]> {
  const out = { ...obj };
  for (const key of keys) {
    delete (out as Record<PropertyKey, unknown>)[key];
  }
  return out as Omit<T, K[number]>;
}
