import { describe, it, expect } from "vitest";
import {
  reverse,
  capitalize,
  countOccurrences,
  truncate,
} from "./string-utils";

// ── Phase 1: Bug-fix tests ──────────────────────────────────────────

describe("reverse", () => {
  it("reverses a normal string", () => {
    expect(reverse("hello")).toBe("olleh");
  });

  it("reverses a single character", () => {
    expect(reverse("a")).toBe("a");
  });

  it("returns empty string for empty input", () => {
    expect(reverse("")).toBe("");
  });

  it("handles palindromes", () => {
    expect(reverse("racecar")).toBe("racecar");
  });
});

describe("capitalize", () => {
  it("capitalizes lowercase word", () => {
    expect(capitalize("hello")).toBe("Hello");
  });

  it("handles all-uppercase input", () => {
    expect(capitalize("HELLO")).toBe("Hello");
  });

  it("handles single character", () => {
    expect(capitalize("a")).toBe("A");
  });

  it("returns empty string for empty input", () => {
    expect(capitalize("")).toBe("");
  });
});

describe("countOccurrences", () => {
  it("counts single-char occurrences", () => {
    expect(countOccurrences("banana", "a")).toBe(3);
  });

  it("counts multi-char occurrences", () => {
    expect(countOccurrences("abcabc", "abc")).toBe(2);
  });

  it("returns 0 when target not found", () => {
    expect(countOccurrences("hello", "z")).toBe(0);
  });

  it("handles non-overlapping correctly", () => {
    expect(countOccurrences("aaa", "aa")).toBe(1);
  });

  it("counts occurrence at position 0", () => {
    expect(countOccurrences("apple", "a")).toBe(1);
  });

  it("returns 0 for empty target", () => {
    expect(countOccurrences("hello", "")).toBe(0);
  });
});

describe("truncate", () => {
  it("truncates long strings with default suffix", () => {
    expect(truncate("Hello World", 5)).toBe("He...");
  });

  it("does NOT truncate strings shorter than maxLength", () => {
    expect(truncate("Hi", 10)).toBe("Hi");
  });

  it("does NOT truncate strings exactly at maxLength", () => {
    expect(truncate("Hello", 5)).toBe("Hello");
  });

  it("uses custom suffix", () => {
    expect(truncate("Hello World", 7, "…")).toBe("Hello …");
  });

  it("handles empty string", () => {
    expect(truncate("", 5)).toBe("");
  });
});

// ── Phase 2: Missing feature tests ──────────────────────────────────
// These tests will fail until the functions are implemented.

// Uncomment once slugify is exported:
// import { slugify } from './string-utils';
//
// describe('slugify', () => {
//   it('converts spaces to hyphens and lowercases', () => {
//     expect(slugify('Hello World!')).toBe('hello-world');
//   });
//
//   it('collapses consecutive hyphens', () => {
//     expect(slugify('  Already--slugified ')).toBe('already-slugified');
//   });
//
//   it('handles camelCase-like input', () => {
//     expect(slugify('CamelCase Test')).toBe('camelcase-test');
//   });
//
//   it('returns empty string for empty input', () => {
//     expect(slugify('')).toBe('');
//   });
// });

// Uncomment once camelCase is exported:
// import { camelCase } from './string-utils';
//
// describe('camelCase', () => {
//   it('converts space-separated words', () => {
//     expect(camelCase('hello world')).toBe('helloWorld');
//   });
//
//   it('converts hyphenated words', () => {
//     expect(camelCase('foo-bar-baz')).toBe('fooBarBaz');
//   });
//
//   it('converts underscored words', () => {
//     expect(camelCase('one_two_three')).toBe('oneTwoThree');
//   });
//
//   it('handles single word', () => {
//     expect(camelCase('already')).toBe('already');
//   });
//
//   it('returns empty string for empty input', () => {
//     expect(camelCase('')).toBe('');
//   });
// });

// Uncomment once isPalindrome is exported:
// import { isPalindrome } from './string-utils';
//
// describe('isPalindrome', () => {
//   it('detects simple palindromes', () => {
//     expect(isPalindrome('racecar')).toBe(true);
//   });
//
//   it('ignores case and spaces', () => {
//     expect(isPalindrome('A man a plan a canal Panama')).toBe(true);
//   });
//
//   it('returns false for non-palindromes', () => {
//     expect(isPalindrome('hello')).toBe(false);
//   });
//
//   it('handles empty string', () => {
//     expect(isPalindrome('')).toBe(true);
//   });
//
//   it('handles single character', () => {
//     expect(isPalindrome('x')).toBe(true);
//   });
// });
