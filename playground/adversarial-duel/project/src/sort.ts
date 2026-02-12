/**
 * Sorting Module — Stub
 *
 * Both Agent α and Agent β start with this identical file.
 * Implement the sorting algorithms according to specs/SPEC.md.
 */

export interface SortOptions<T = number> {
  algorithm?: "bubble" | "merge" | "quick" | "insertion" | "heap";
  comparator?: (a: T, b: T) => number;
  inPlace?: boolean;
}

const defaultComparator = (a: number, b: number): number => a - b;

/**
 * Unified sorting function.
 * Delegates to the specified algorithm (default: quickSort).
 */
export function sort<T>(array: T[], options?: SortOptions<T>): T[] {
  // TODO: implement
  throw new Error("Not implemented");
}

// ── Individual algorithms ─────────────────────────────────

export function bubbleSort<T>(
  array: T[],
  comparator?: (a: T, b: T) => number,
): T[] {
  // TODO: implement
  throw new Error("Not implemented");
}

export function mergeSort<T>(
  array: T[],
  comparator?: (a: T, b: T) => number,
): T[] {
  // TODO: implement
  throw new Error("Not implemented");
}

export function quickSort<T>(
  array: T[],
  comparator?: (a: T, b: T) => number,
): T[] {
  // TODO: implement
  throw new Error("Not implemented");
}

export function insertionSort<T>(
  array: T[],
  comparator?: (a: T, b: T) => number,
): T[] {
  // TODO: implement
  throw new Error("Not implemented");
}

export function heapSort<T>(
  array: T[],
  comparator?: (a: T, b: T) => number,
): T[] {
  // TODO: implement
  throw new Error("Not implemented");
}
