# Sorting Module — Evaluation Criteria

## API Contract

### `sort(array: T[], options?: SortOptions<T>): T[]`

A unified sorting function that accepts an algorithm parameter.

```typescript
interface SortOptions<T> {
  algorithm?: 'bubble' | 'merge' | 'quick' | 'insertion' | 'heap';
  comparator?: (a: T, b: T) => number;
  inPlace?: boolean;
}
```

- `sort([3, 1, 2])` → `[1, 2, 3]`
- `sort([3, 1, 2], { algorithm: 'merge' })` → `[1, 2, 3]`
- `sort(['banana', 'apple'], { comparator: (a, b) => a.localeCompare(b) })` → `['apple', 'banana']`

### Individual algorithm exports

Each algorithm should also be exported individually:
- `bubbleSort(arr)`, `mergeSort(arr)`, `quickSort(arr)`, etc.

## Scoring Criteria (10 points each)

| Criterion        | Weight | Description                                                                                        |
|------------------|--------|----------------------------------------------------------------------------------------------------|
| **Correctness**  | 10     | All tests pass, produces correct output for all inputs                                             |
| **Performance**  | 10     | Efficient for large arrays (10k+ elements); quickSort/mergeSort should be O(n log n)               |
| **Code Clarity** | 10     | Readable, well-named variables, clear logic flow                                                   |
| **Type Safety**  | 10     | Full generics, no `any`, proper TypeScript patterns                                                |
| **Edge Cases**   | 10     | Handles: empty array, single element, already sorted, reverse sorted, duplicates, negative numbers |

**Max score per round: 50 points**

## Edge Cases (must handle)

1. Empty array → returns `[]`
2. Single element → returns `[element]`
3. Already sorted → returns sorted (no corruption)
4. All duplicates → returns array with duplicates preserved
5. Negative numbers → sorts correctly
6. Mixed types with comparator → sorts correctly
7. Very large arrays (10,000+) → completes in < 1 second
8. `inPlace: true` → mutates original, returns same reference
9. `inPlace: false` (default) → returns new array, original unchanged
