/**
 * Recursively deep freezes an object or array to guarantee that
 * captured request snapshots cannot be mutated by website scripts or extension code.
 */
export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Freeze the object itself
  Object.freeze(obj);

  // Recursively freeze properties
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = (obj as Record<string, unknown>)[name];
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
      if (!Object.isFrozen(value)) {
        deepFreeze(value);
      }
    }
  }

  return obj as Readonly<T>;
}
