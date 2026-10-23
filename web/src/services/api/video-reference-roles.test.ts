import assert from "node:assert/strict";
import test from "node:test";

import { resolveVideoImageReferences } from "./video-reference-roles";

test("显式首尾帧 ID 保持中间图片为 reference_image，单帧同时承担首尾语义", () => {
    const images = ["a", "b", "c"].map((id) => ({ id, dataUrl: `${id}.png`, name: id, type: "image/png" }));
    assert.deepEqual(resolveVideoImageReferences(images, { videoStartFrameNodeId: "a", videoEndFrameNodeId: "c" }).map((item) => [item.image.id, item.role]), [
        ["a", "first_frame"],
        ["b", "reference_image"],
        ["c", "last_frame"],
    ]);
    assert.equal(resolveVideoImageReferences([images[0]!], { videoStartFrameNodeId: "a", videoEndFrameNodeId: "a" })[0]?.role, "first_frame");
});
