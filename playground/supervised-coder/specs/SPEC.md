# String Utils — Module Specification

## Overview

`string-utils.ts` is a zero-dependency TypeScript utility module that provides
common string manipulation functions. It must be correct, well-typed, and
handle edge cases gracefully.

## API Contract

### `reverse(input: string): string`
Returns the input string reversed character by character.
- `reverse("hello")` → `"olleh"`
- `reverse("")` → `""`
- `reverse("a")` → `"a"`

### `capitalize(input: string): string`
Returns the input with the first character uppercased and the rest lowercased.
- `capitalize("hello")` → `"Hello"`
- `capitalize("HELLO")` → `"Hello"`
- `capitalize("")` → `""`

### `countOccurrences(input: string, target: string): number`
Returns the number of non-overlapping occurrences of `target` in `input`.
- `countOccurrences("banana", "a")` → `3`
- `countOccurrences("aaa", "aa")` → `1` (non-overlapping)
- `countOccurrences("hello", "z")` → `0`

### `truncate(input: string, maxLength: number, suffix?: string): string`
Truncates `input` to `maxLength` characters. If truncated, appends `suffix`
(default `"..."`). The total length including suffix must not exceed `maxLength`.
- `truncate("Hello World", 5)` → `"He..."`
- `truncate("Hi", 10)` → `"Hi"` (no truncation needed)
- `truncate("Hello", 5)` → `"Hello"` (exact fit, no truncation)

### `slugify(input: string): string`
Converts input to a URL-friendly slug: lowercase, spaces/underscores replaced
with hyphens, non-alphanumeric chars removed, consecutive hyphens collapsed.
- `slugify("Hello World!")` → `"hello-world"`
- `slugify("  Already--slugified ")` → `"already-slugified"`
- `slugify("CamelCase Test")` → `"camelcase-test"`

### `camelCase(input: string): string`
Converts a delimited string (spaces, hyphens, underscores) to camelCase.
- `camelCase("hello world")` → `"helloWorld"`
- `camelCase("foo-bar-baz")` → `"fooBarBaz"`
- `camelCase("already")` → `"already"`

### `isPalindrome(input: string): boolean`
Returns `true` if the input reads the same forwards and backwards, ignoring
case and non-alphanumeric characters.
- `isPalindrome("racecar")` → `true`
- `isPalindrome("A man a plan a canal Panama")` → `true`
- `isPalindrome("hello")` → `false`

## Quality Requirements

1. All functions must be pure (no side effects)
2. All functions must handle empty string as input
3. All functions must be fully typed (no `any`)
4. Test coverage must include normal, edge, and error cases
