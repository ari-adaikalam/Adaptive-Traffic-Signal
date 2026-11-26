"""Saves the frames the page sends while the training set is made (see docs/detector.md). One frame is a JPEG, its YOLO label file and a small JSON about it, written under
<root>/<split>/images, labels and meta. Everything in the request is checked before anything is written, and the file names are made only from checked fields, so a request cannot choose a path."""
import base64
import json
import os
import re
import tempfile
from pathlib import Path

SPLITS = ("train", "val", "test", "test-heldout")  # test-heldout is the held-out condition (night with rain): it is never used for training
MAX_BODY = 4_000_000  # bytes of request
MAX_IMAGE = 1_500_000  # bytes of JPEG
MAX_META = 40_000  # bytes of JSON
CAMERAS = 8
SESSION = re.compile(r"^s[0-9]{1,10}$")  # "s" and the simulation seed
LABEL = re.compile(r"^[0-3] (?:0|1|0\.[0-9]{1,6}) (?:0|1|0\.[0-9]{1,6}) (?:0|1|0\.[0-9]{1,6}) (?:0|1|0\.[0-9]{1,6})$")
JPEG_PREFIX = "data:image/jpeg;base64,"


class BadFrame(ValueError):
    """The request is not a frame this tool will write."""


def _int(value, low, high, name):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise BadFrame(f"{name} must be a whole number from {low} to {high}")
    return value


def check(payload):
    """Validates a request body that has been read as JSON. Returns (name, split, jpeg bytes, label text, meta text)."""
    if not isinstance(payload, dict):
        raise BadFrame("not an object")
    session, split = payload.get("session"), payload.get("split")
    if not isinstance(session, str) or not SESSION.match(session):
        raise BadFrame("bad session")
    if split not in SPLITS:
        raise BadFrame("bad split")
    camera, frame = _int(payload.get("camera"), 0, CAMERAS - 1, "camera"), _int(payload.get("frame"), 0, 99_999, "frame")
    image = payload.get("image")
    if not isinstance(image, str) or not image.startswith(JPEG_PREFIX) or len(image) > MAX_IMAGE * 4 // 3 + 64:
        raise BadFrame("bad image")
    try:
        jpeg = base64.b64decode(image[len(JPEG_PREFIX):], validate=True)
    except ValueError as error:
        raise BadFrame("bad image encoding") from error
    if len(jpeg) > MAX_IMAGE or jpeg[:3] != b"\xff\xd8\xff":
        raise BadFrame("not a JPEG")
    labels = payload.get("labels")
    if not isinstance(labels, list) or len(labels) > 200 or not all(isinstance(line, str) and LABEL.match(line) for line in labels):
        raise BadFrame("bad labels")
    meta = payload.get("meta", {})
    meta_text = json.dumps(meta, separators=(",", ":"))
    if not isinstance(meta, dict) or len(meta_text) > MAX_META:
        raise BadFrame("bad meta")
    return f"{session}-c{camera}-{frame:05d}", split, jpeg, "\n".join(labels) + ("\n" if labels else ""), meta_text


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, suffix=".part")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
        os.replace(temporary, path)  # a half written file is never left under the real name
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def save(root, payload):
    """Checks a frame and writes it. Returns the name it was saved under."""
    name, split, jpeg, labels, meta = check(payload)
    base = Path(root).resolve() / split
    _write(base / "images" / f"{name}.jpg", jpeg)
    _write(base / "labels" / f"{name}.txt", labels.encode())
    _write(base / "meta" / f"{name}.json", meta.encode())
    return f"{split}/{name}"
