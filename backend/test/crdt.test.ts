import { describe, expect, it } from "vitest";
import * as Y from "yjs";

describe("Yjs offline merge", () => {
  it("converges after concurrent edits are exchanged in arbitrary order", () => {
    const seed = new Y.Doc();
    seed.getText("content").insert(0, "shared ");

    const left = new Y.Doc();
    const right = new Y.Doc();
    Y.applyUpdate(left, Y.encodeStateAsUpdate(seed));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(seed));

    const leftBefore = Y.encodeStateAsUpdate(left);
    const rightBefore = Y.encodeStateAsUpdate(right);
    left.getText("content").insert(left.getText("content").length, "left");
    right.getText("content").insert(right.getText("content").length, "right");

    const leftUpdate = Y.encodeStateAsUpdate(left, Y.encodeStateVectorFromUpdate(rightBefore));
    const rightUpdate = Y.encodeStateAsUpdate(right, Y.encodeStateVectorFromUpdate(leftBefore));
    Y.applyUpdate(left, rightUpdate);
    Y.applyUpdate(right, leftUpdate);

    expect(left.getText("content").toString()).toBe(right.getText("content").toString());
    expect(left.getText("content").toString()).toContain("left");
    expect(left.getText("content").toString()).toContain("right");

    seed.destroy();
    left.destroy();
    right.destroy();
  });

  it("applies the same CRDT update idempotently", () => {
    const source = new Y.Doc();
    const target = new Y.Doc();
    source.getText("content").insert(0, "once");
    const update = Y.encodeStateAsUpdate(source);
    Y.applyUpdate(target, update);
    Y.applyUpdate(target, update);
    expect(target.getText("content").toString()).toBe("once");
    source.destroy();
    target.destroy();
  });
});
