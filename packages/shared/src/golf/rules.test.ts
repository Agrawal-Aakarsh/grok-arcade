import { describe, expect, it } from "vitest";

import {
  cardOf,
  compareCards,
  finalScore,
  multiplierFor,
  PAR_CHARS,
  strokesOf,
  type GolfAttempt,
} from "./rules.js";

const attempt = (prompt: string, score: number | null): GolfAttempt => ({ prompt, score });
const card = (final: number, strokes: number) => ({ final, strokes, score: 0, multiplier: 1 });

describe("strokes", () => {
  it("counts characters, not bytes", () => {
    expect(strokesOf("a red boat")).toBe(10);
    // Emoji are one stroke despite being two UTF-16 units — otherwise a player
    // is charged double for using one.
    expect(strokesOf("🍎🍎")).toBe(2);
  });
});

describe("multiplier", () => {
  it("is exactly 1.0 at par", () => {
    expect(multiplierFor(PAR_CHARS)).toBeCloseTo(1.0, 5);
  });

  it("rewards brevity and punishes length", () => {
    expect(multiplierFor(20)).toBeGreaterThan(1);
    expect(multiplierFor(200)).toBeLessThan(1);
  });

  it("clamps at both ends", () => {
    // No ceiling would make a one-character prompt dominate fidelity entirely;
    // no floor would round every long attempt to zero and tie them all.
    expect(multiplierFor(0)).toBeLessThanOrEqual(1.25);
    expect(multiplierFor(10_000)).toBe(0.5);
  });
});

describe("final score", () => {
  it("is fidelity scaled by brevity", () => {
    expect(finalScore(80, PAR_CHARS)).toBeCloseTo(80, 1);
  });

  it("lets a shorter, slightly worse prompt beat a longer, better one", () => {
    // The whole design: 52 in 36 chars should edge out 55 in 56 chars.
    const short = finalScore(52, 36)!;
    const long = finalScore(55, 56)!;
    expect(short).toBeGreaterThan(long);
  });

  it("does not let a terrible one-word prompt win on brevity alone", () => {
    // "boat" scoring 20 must lose to a real attempt scoring 55.
    expect(finalScore(20, 4)!).toBeLessThan(finalScore(55, 56)!);
  });

  it("stays null while unjudged rather than scoring zero", () => {
    expect(finalScore(null, 30)).toBeNull();
  });
});

describe("card", () => {
  it("takes your best attempt by final score, not by fidelity", () => {
    const best = cardOf([
      attempt("an extremely long and detailed prompt about a red sailboat at sea at dusk", 70),
      attempt("red sailboat at dusk", 64),
    ]);
    expect(best?.strokes).toBe(20);
  });

  it("ignores attempts that are still being judged", () => {
    expect(cardOf([attempt("pending one", null)])).toBeNull();
  });

  it("returns null with no attempts", () => {
    expect(cardOf([])).toBeNull();
  });
});

describe("leaderboard order", () => {
  it("ranks by final score descending", () => {
    expect([card(40, 10), card(66, 30)].sort(compareCards)[0]!.final).toBe(66);
  });

  it("breaks ties on fewer strokes", () => {
    expect([card(60, 90), card(60, 30)].sort(compareCards)[0]!.strokes).toBe(30);
  });
});
