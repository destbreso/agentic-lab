# Implementation Plan — String Utils Module

## Objective
Repair and complete the `string-utils` TypeScript module so that all tests pass
and the specification is fully satisfied.

---

## Phase 1: Bug Fixes (Critical)

- [ ] **1.1** Fix `reverse()` — currently returns first char repeated instead of reversed string
- [ ] **1.2** Fix `capitalize()` — lowercases the entire string instead of capitalizing first letter
- [ ] **1.3** Fix `countOccurrences()` — off-by-one: counts from index 1 instead of 0
- [ ] **1.4** Fix `truncate()` — appends suffix even when string is shorter than max length

## Phase 2: Missing Features

- [ ] **2.1** Implement `slugify()` — convert string to URL-friendly slug
- [ ] **2.2** Implement `camelCase()` — convert delimited string to camelCase
- [ ] **2.3** Implement `isPalindrome()` — check if string reads the same forwards and backwards

## Phase 3: Edge Cases & Hardening

- [ ] **3.1** Ensure all functions handle empty string input
- [ ] **3.2** Ensure all functions handle `null`/`undefined` gracefully (return empty string)
- [ ] **3.3** Add Unicode awareness to `reverse()` (handle multi-byte chars)

---

## Status Legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Completed
- `[!]` Blocked / needs attention
