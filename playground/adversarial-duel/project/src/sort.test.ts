import { describe, it, expect } from "vitest";
import {
  sort,
  bubbleSort,
  mergeSort,
  quickSort,
  insertionSort,
  heapSort,
} from "./sort";

// ── Test data ────────────────────────────────────────────

const unsorted = [38, 27, 43, 3, 9, 82, 10];
const sorted = [3, 9, 10, 27, 38, 43, 82];
const reversed = [82, 43, 38, 27, 10, 9, 3];
const duplicates = [5, 3, 5, 1, 3, 5, 1];
const duplicatesSorted = [1, 1, 3, 3, 5, 5, 5];
const negatives = [-3, 4, -1, 0, 7, -5, 2];
const negativesSorted = [-5, -3, -1, 0, 2, 4, 7];
const single = [42];
const empty: number[] = [];

// ── Unified sort() ───────────────────────────────────────

describe("sort (unified)", () => {
  it("sorts with default algorithm", () => {
    expect(sort([...unsorted])).toEqual(sorted);
  });

  it("sorts with explicit quick algorithm", () => {
    expect(sort([...unsorted], { algorithm: "quick" })).toEqual(sorted);
  });

  it("sorts with merge algorithm", () => {
    expect(sort([...unsorted], { algorithm: "merge" })).toEqual(sorted);
  });

  it("sorts with bubble algorithm", () => {
    expect(sort([...unsorted], { algorithm: "bubble" })).toEqual(sorted);
  });

  it("sorts with insertion algorithm", () => {
    expect(sort([...unsorted], { algorithm: "insertion" })).toEqual(sorted);
  });

  it("sorts with heap algorithm", () => {
    expect(sort([...unsorted], { algorithm: "heap" })).toEqual(sorted);
  });

  it("uses custom comparator", () => {
    const words = ["banana", "apple", "cherry"];
    const result = sort(words, {
      comparator: (a, b) => a.localeCompare(b),
    });
    expect(result).toEqual(["apple", "banana", "cherry"]);
  });

  it("does NOT mutate original by default", () => {
    const original = [...unsorted];
    const copy = [...original];
    sort(original);
    expect(original).toEqual(copy);
  });

  it("mutates original when inPlace is true", () => {
    const original = [...unsorted];
    const result = sort(original, { inPlace: true });
    expect(result).toBe(original); // same reference
    expect(result).toEqual(sorted);
  });
});

// ── Individual algorithms ────────────────────────────────

const algorithms = [
  { name: "bubbleSort", fn: bubbleSort },
  { name: "mergeSort", fn: mergeSort },
  { name: "quickSort", fn: quickSort },
  { name: "insertionSort", fn: insertionSort },
  { name: "heapSort", fn: heapSort },
] as const;

for (const { name, fn } of algorithms) {
  describe(name, () => {
    it("sorts a normal array", () => {
      expect(fn([...unsorted])).toEqual(sorted);
    });

    it("handles empty array", () => {
      expect(fn([...empty])).toEqual([]);
    });

    it("handles single element", () => {
      expect(fn([...single])).toEqual([42]);
    });

    it("handles already sorted", () => {
      expect(fn([...sorted])).toEqual(sorted);
    });

    it("handles reverse sorted", () => {
      expect(fn([...reversed])).toEqual(sorted);
    });

    it("handles duplicates", () => {
      expect(fn([...duplicates])).toEqual(duplicatesSorted);
    });

    it("handles negative numbers", () => {
      expect(fn([...negatives])).toEqual(negativesSorted);
    });

    it("handles large array (10k elements)", () => {
      const large = Array.from({ length: 10_000 }, () =>
        Math.floor(Math.random() * 100_000),
      );
      const expected = [...large].sort((a, b) => a - b);
      const start = performance.now();
      const result = fn([...large]);
      const elapsed = performance.now() - start;

      expect(result).toEqual(expected);
      expect(elapsed).toBeLessThan(1000); // < 1 second
    });
  });
}
