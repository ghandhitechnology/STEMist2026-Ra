import { describe, expect, it } from "vitest";
import { normalizeMathDelimiters } from "./markdown-math";

describe("normalizeMathDelimiters", () => {
  it("passes plain prose through untouched", () => {
    const text = "It costs $5 and $10 at most.";
    expect(normalizeMathDelimiters(text)).toBe(text);
  });

  it("converts \\( … \\) to inline dollars", () => {
    expect(normalizeMathDelimiters("Euler: \\(e^{i\\pi} + 1 = 0\\).")).toBe(
      "Euler: $e^{i\\pi} + 1 = 0$."
    );
  });

  it("converts \\[ … \\] to display dollars", () => {
    expect(normalizeMathDelimiters("\\[\\frac{a}{b}\\]")).toBe(
      "$$\\frac{a}{b}$$"
    );
  });

  it("leaves fenced code alone", () => {
    const text = "```tex\n\\(x\\)\n```";
    expect(normalizeMathDelimiters(text)).toBe(text);
  });

  it("leaves inline code alone", () => {
    const text = "Use `\\(x\\)` for inline math.";
    expect(normalizeMathDelimiters(text)).toBe(text);
  });

  it("does not rewrite inside an unclosed (streaming) fence", () => {
    const text = "```python\nx = 1\n\\(y\\)";
    expect(normalizeMathDelimiters(text)).toBe(text);
  });

  it("rewrites /= inside math to \\neq", () => {
    expect(normalizeMathDelimiters("$a /= b$")).toBe("$a \\neq  b$");
  });

  it("rewrites =/= inside math to \\neq", () => {
    expect(normalizeMathDelimiters("$a =/= b$")).toBe("$a \\neq  b$");
  });

  it("rewrites /= inside display math and converted \\[ … \\]", () => {
    expect(normalizeMathDelimiters("\\[a /= b\\]")).toBe("$$a \\neq  b$$");
    expect(normalizeMathDelimiters("$$a /= b$$")).toBe("$$a \\neq  b$$");
  });

  it("leaves /= alone in prose and code", () => {
    const prose = "In Python, x /= 2 halves x.";
    expect(normalizeMathDelimiters(prose)).toBe(prose);
    const code = "`x /= 2` and\n```c\nx /= 2;\n```";
    expect(normalizeMathDelimiters(code)).toBe(code);
  });

  it("leaves /= alone in unclosed (streaming) math", () => {
    const text = "$a /= b";
    expect(normalizeMathDelimiters(text)).toBe(text);
  });

  it("rewrites != , >= and <= inside math", () => {
    expect(normalizeMathDelimiters("$a != b$")).toBe("$a \\neq  b$");
    expect(normalizeMathDelimiters("$x >= 0$")).toBe("$x \\ge  0$");
    expect(normalizeMathDelimiters("$x <= 1$")).toBe("$x \\le  1$");
  });

  it("does not touch \\geq/\\leq or := inside math", () => {
    const text = "$a \\geq b,\\ c \\leq d,\\ x := y$";
    expect(normalizeMathDelimiters(text)).toBe(text);
  });

  it("handles a full multi-line display block like the Peano example", () => {
    const input =
      "no successor is equal to \\(0\\):\n\n\\[\n\\forall n,\\quad S(n) /= 0.\n\\]\n\nApplying this to \\(n = 0\\),";
    expect(normalizeMathDelimiters(input)).toBe(
      "no successor is equal to $0$:\n\n$$\n\\forall n,\\quad S(n) \\neq  0.\n$$\n\nApplying this to $n = 0$,"
    );
  });

  it("rewrites /= in every math block of a multi-block message", () => {
    const input = "$$1 := S(0)$$\n\nprose\n\n$$S(0) /= 0$$\n\n$$1 /= 0$$";
    expect(normalizeMathDelimiters(input)).toBe(
      "$$1 := S(0)$$\n\nprose\n\n$$S(0) \\neq  0$$\n\n$$1 \\neq  0$$"
    );
  });
});
