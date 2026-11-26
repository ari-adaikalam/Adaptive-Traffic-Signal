"""The tool that saves training frames (web/tools/collect_store.py): a good frame is written under the split, a bad request writes nothing, and a request cannot choose where a file goes."""
import base64
import importlib.util
import pathlib

import pytest

SPEC = importlib.util.spec_from_file_location("collect_store", pathlib.Path(__file__).resolve().parent.parent / "web" / "tools" / "collect_store.py")
store = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(store)

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\xff\xd9"


def frame(**changes):
    base = {"session": "s12345", "split": "train", "camera": 3, "frame": 7, "image": store.JPEG_PREFIX + base64.b64encode(JPEG).decode(),
            "labels": ["0 0.500000 0.400000 0.100000 0.050000", "2 0.250000 0.600000 0.200000 0.100000"], "meta": {"time": 12.5}}
    base.update(changes)
    return base


def files(root):
    return sorted(str(p.relative_to(root)) for p in pathlib.Path(root).rglob("*") if p.is_file())


def test_a_good_frame_is_written_as_an_image_a_label_file_and_a_meta_file(tmp_path):
    name = store.save(tmp_path, frame())
    assert name == "train/s12345-c3-00007"
    assert files(tmp_path) == ["train/images/s12345-c3-00007.jpg", "train/labels/s12345-c3-00007.txt", "train/meta/s12345-c3-00007.json"]
    assert (tmp_path / "train/images/s12345-c3-00007.jpg").read_bytes() == JPEG
    assert (tmp_path / "train/labels/s12345-c3-00007.txt").read_text().splitlines() == frame()["labels"]


def test_a_frame_with_no_vehicles_has_an_empty_label_file(tmp_path):
    store.save(tmp_path, frame(labels=[]))
    assert (tmp_path / "train/labels/s12345-c3-00007.txt").read_text() == ""


def test_the_held_out_condition_has_a_split_of_its_own(tmp_path):
    assert store.save(tmp_path, frame(split="test-heldout")).startswith("test-heldout/")


@pytest.mark.parametrize("changes", [
    {"session": "../etc"}, {"session": "s1/../../x"}, {"session": "s"}, {"session": "x123"}, {"session": 5}, {"session": "s12345678901"},
    {"split": "../train"}, {"split": "all"}, {"split": None},
    {"camera": 8}, {"camera": -1}, {"camera": "3"}, {"camera": True}, {"frame": 100000}, {"frame": -1}, {"frame": 1.5},
    {"image": "data:image/png;base64,AAAA"}, {"image": "not an image"}, {"image": store.JPEG_PREFIX + "!!!not base64!!!"},
    {"image": store.JPEG_PREFIX + base64.b64encode(b"GIF89a....").decode()},
    {"image": store.JPEG_PREFIX + base64.b64encode(JPEG + b"\x00" * store.MAX_IMAGE).decode()},
    {"labels": ["4 0.5 0.5 0.1 0.1"]}, {"labels": ["0 1.5 0.5 0.1 0.1"]}, {"labels": ["0 0.5 0.5 0.1"]}, {"labels": ["0 0.5 0.5 0.1 0.1; rm -rf"]},
    {"labels": "0 0.5 0.5 0.1 0.1"}, {"labels": ["0 0.5 0.5 0.1 0.1"] * 201}, {"labels": [5]},
    {"meta": []}, {"meta": {"x": "y" * store.MAX_META}},
])
def test_a_bad_request_is_refused_and_writes_nothing(tmp_path, changes):
    with pytest.raises(store.BadFrame):
        store.save(tmp_path, frame(**changes))
    assert files(tmp_path) == []


@pytest.mark.parametrize("payload", [None, [], "x", 5, {}])
def test_a_body_that_is_not_a_frame_is_refused(tmp_path, payload):
    with pytest.raises(store.BadFrame):
        store.save(tmp_path, payload)
    assert files(tmp_path) == []


def test_every_file_is_inside_the_root_and_none_is_left_half_written(tmp_path):
    store.save(tmp_path, frame())
    store.save(tmp_path, frame())  # again: it replaces the first
    for path in pathlib.Path(tmp_path).rglob("*"):
        assert tmp_path.resolve() in path.resolve().parents or path.resolve() == tmp_path.resolve()
    assert not [p for p in pathlib.Path(tmp_path).rglob("*.part")]
    assert len(files(tmp_path)) == 3
