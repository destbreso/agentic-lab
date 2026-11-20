// A path on screen shows the home folder as ~, never the user name.

import { describe, it, expect } from "vitest";
import { shown } from "./display-path.js";

describe("a path on screen", () => {
  it("writes the home folder as ~", () => {
    expect(shown("/home/ana/.config/jig/config.json", "/home/ana")).toBe("~/.config/jig/config.json");
    expect(shown("/home/ana", "/home/ana")).toBe("~");
  });
  it("leaves alone a path outside the home folder, and one that only starts with its name", () => {
    expect(shown("/etc/jig/config.json", "/home/ana")).toBe("/etc/jig/config.json");
    expect(shown("/home/anabel/x", "/home/ana")).toBe("/home/anabel/x");
  });
});
