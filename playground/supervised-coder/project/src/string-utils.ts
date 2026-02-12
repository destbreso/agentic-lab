/**
 * String Utilities Module
 *
 * A collection of common string manipulation functions.
 * NOTE: This module contains intentional bugs that need to be fixed.
 */

/**
 * Reverses a string character by character.
 * BUG: Uses `=` instead of `+=` in the accumulator (same class of bug as
 *       the reference repo's `total = num` in utils.py).
 */
export function reverse(input: string): string {
  let result = '';
  for (let i = input.length - 1; i >= 0; i--) {
    result = input[i]; // BUG: should be `result += input[i]`
  }
  return result;
}

/**
 * Capitalizes the first letter, lowercases the rest.
 * BUG: Lowercases everything including the first character.
 */
export function capitalize(input: string): string {
  if (input.length === 0) return '';
  return input.toLowerCase(); // BUG: should be input[0].toUpperCase() + input.slice(1).toLowerCase()
}

/**
 * Counts non-overlapping occurrences of `target` in `input`.
 * BUG: Starts searching from index 1 instead of 0, missing occurrences
 *       at the start of the string.
 */
export function countOccurrences(input: string, target: string): number {
  if (target.length === 0) return 0;
  let count = 0;
  let pos = 1; // BUG: should start at 0
  while ((pos = input.indexOf(target, pos)) !== -1) {
    count++;
    pos += target.length;
  }
  return count;
}

/**
 * Truncates a string to maxLength, appending a suffix if truncated.
 * BUG: Always appends suffix even when string fits within maxLength.
 */
export function truncate(
  input: string,
  maxLength: number,
  suffix: string = '...',
): string {
  // BUG: missing the guard — should return input if input.length <= maxLength
  const truncated = input.slice(0, maxLength - suffix.length);
  return truncated + suffix;
}

// ---------- MISSING FEATURES ----------
// The following functions are referenced in tests but not yet implemented.
// They should be implemented according to specs/SPEC.md.

// TODO: implement slugify(input: string): string
// TODO: implement camelCase(input: string): string
// TODO: implement isPalindrome(input: string): boolean
