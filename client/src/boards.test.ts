import { describe, expect, it } from "vitest";
import { boardValue } from "./screens";

const entry = {
  rank: 1,
  name: "Edda",
  level: 20,
  value: 125,
  classId: null,
  alive: true,
  partySize: null,
};

describe("leaderboard scores (D-148)", () => {
  it("shows EXP, clears, kills, and clear times with their party size", () => {
    expect(boardValue("exp", entry)).toBe("125 EXP");
    expect(boardValue("clears", { ...entry, value: 1 })).toBe("1 clear");
    expect(boardValue("clears", entry)).toBe("125 clears");
    expect(boardValue("kills", entry)).toBe("125 slain");
    expect(boardValue("fastest", { ...entry, partySize: 1 })).toBe(
      "2:05 · solo",
    );
    expect(boardValue("fastest", { ...entry, partySize: 4 })).toBe(
      "2:05 · party of 4",
    );
  });
});
