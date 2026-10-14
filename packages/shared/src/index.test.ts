import { describe, expect, it } from "vitest";

import { suma } from "./index.js";

describe("suma", () => {
  it("suma dos números", () => {
    expect(suma(2, 3)).toBe(5);
  });
});
