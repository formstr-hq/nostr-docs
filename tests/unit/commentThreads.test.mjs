import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCommentThreads, getCommentAncestors, getDiscussionRows } from "../../src/utils/commentThreads.ts";

test("threads preserve parent links, chronological siblings and late parents", () => {
  const comments = [
    { id: "second", parentId: "root", createdAt: 3 },
    { id: "deep", parentId: "first", createdAt: 4 },
    { id: "first", parentId: "root", createdAt: 2 },
  ];
  assert.deepEqual(buildCommentThreads(comments).roots.map((c) => c.id), ["first", "second"]);
  const threads = buildCommentThreads([...comments, { id: "root", createdAt: 1 }]);
  assert.deepEqual(threads.roots.map((c) => c.id), ["root"]);
  assert.deepEqual(threads.repliesByParent.get("root").map((c) => c.id), ["first", "second"]);
  assert.deepEqual(getCommentAncestors(threads, "deep").map((c) => c.id), ["root", "first"]);
  assert.deepEqual(getDiscussionRows(threads, "root").map(({ comment, depth }) => [comment.id, depth]), [
    ["root", 0], ["first", 1], ["deep", 2], ["second", 1],
  ]);
});

test("very deep discussions are traversed iteratively and can be paged", () => {
  const comments = Array.from({ length: 15000 }, (_, i) => ({
    id: String(i), parentId: i ? String(i - 1) : undefined, createdAt: i,
  }));
  const threads = buildCommentThreads(comments);
  assert.equal(getCommentAncestors(threads, "14999").length, 14999);
  const rows = getDiscussionRows(threads, "0", 101);
  assert.equal(rows.length, 101);
  assert.equal(rows.at(-1).depth, 100);
  assert.equal(getDiscussionRows(threads, "14998").length, 2);
});

test("missing comments and malformed cycles cannot trap traversal", () => {
  const threads = buildCommentThreads([
    { id: "a", parentId: "b", createdAt: 1 },
    { id: "b", parentId: "a", createdAt: 2 },
    { id: "orphan", parentId: "missing", createdAt: 3 },
  ]);
  assert.deepEqual(getDiscussionRows(threads, "missing"), []);
  assert.equal(getDiscussionRows(threads, "a").length, 2);
  assert.equal(getCommentAncestors(threads, "a").length, 1);
  assert.deepEqual(threads.roots.map((c) => c.id), ["orphan"]);
});
