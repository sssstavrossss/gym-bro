import { beforeEach, expect, it } from "vitest";
import { clearReview, describe, resetDescribe, restoreReview, startRevise } from "../src/state/describe";

const review = () => {
  resetDescribe();
  describe.text = "Ring donut, oil for frying";
  describe.id = "d1";
  describe.fromPhoto = true;
  describe.seen = "a ring donut";
  describe.rows = [{ key: "a", words: "ring donut", name: "Smultringer", on: true, food: null, amount: 60, unit: "g", guessed: true } as never];
  describe.phase = "review";
};

beforeEach(review);

it("× empties Describe and keeps the review for Undo", () => {
  const kept = clearReview();
  expect(describe.phase).toBe("write");
  expect(describe.text).toBe("");
  expect(describe.rows).toEqual([]);
  expect(describe.id).toBeNull();
  expect(kept).toMatchObject({ text: "Ring donut, oil for frying", id: "d1", fromPhoto: true, seen: "a ring donut" });
  expect(kept!.rows).toHaveLength(1);

  expect(restoreReview(kept!)).toBe(true);
  expect(describe.phase).toBe("review");
  expect(describe.text).toBe("Ring donut, oil for frying");
  expect(describe.rows).toHaveLength(1);
});

it("does nothing while adding or editing the words", () => {
  describe.adding = true;
  expect(clearReview()).toBeNull();
  describe.adding = false;
  startRevise();
  expect(clearReview()).toBeNull();
  expect(describe.phase).toBe("review");
});

it("Undo doesn't replace a review that came after", () => {
  const kept = clearReview()!;
  review();
  describe.text = "Something newer";
  expect(restoreReview(kept)).toBe(false);
  expect(describe.text).toBe("Something newer");
});
