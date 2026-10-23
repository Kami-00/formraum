"""Regression checks for geometric face/edge anchors. Run with FreeCAD Python."""
from copy import deepcopy

import backend as cad


def main():
    box = {"id": "anchor-check", "kind": "box",
           "params": {"width": 40, "depth": 30, "height": 12},
           "position": [20, 10, 7], "features": []}
    body = cad.build_object(box)
    box["features"].append({"type": "extrude", "face": 6,
                            "reference": cad.geometry_reference(body.Faces[5], body, "face"),
                            "sketch": {"kind": "rectangle", "center": [0, 0], "width": 10, "height": 10},
                            "depth": 5})
    body = cad.build_object(box)
    # The native boolean changes face 6 from the top face to the right side.
    box["features"].append({"type": "pocket", "face": 6,
                            "reference": cad.geometry_reference(body.Faces[5], body, "face"),
                            "sketch": {"kind": "circle", "center": [0, 0], "radius": 2}, "depth": 3})
    assert cad.build_object(box).isValid()
    removed = deepcopy(box)
    removed["features"].pop(0)
    try:
        cad.build_object(removed)
    except cad.ModelError as error:
        assert "Bezugsfläche hat sich verändert" in str(error)
    else:
        raise AssertionError("A pocket was silently redirected to a different face.")

    resized = deepcopy(box)
    resized["features"] = resized["features"][:1]
    resized["params"] = {"width": 50, "depth": 40, "height": 20}
    assert cad.build_object(resized).isValid()

    edges = deepcopy(box)
    edges["features"] = []
    body = cad.build_object(edges)
    edges["features"].append({"type": "fillet", "edges": [1], "radius": 1,
                              "references": [cad.geometry_reference(body.Edges[0], body, "edge")]})
    assert cad.build_object(edges).isValid()
    edges["params"]["width"] = 50
    assert cad.build_object(edges).isValid()
    malformed = deepcopy(edges)
    malformed["features"][0]["references"][0]["end"][0] += 0.1
    try:
        cad.build_object(malformed)
    except cad.ModelError as error:
        assert "Bezugskante hat sich verändert" in str(error)
    else:
        raise AssertionError("A mismatched edge reference was accepted.")

    result = cad.shape_json(resized, cad.build_object(resized))
    assert all("reference" in face for face in result["faces"])
    assert all("reference" in edge for edge in result["edges"])

    legacy = {"version": 1, "objects": [deepcopy(box), deepcopy(edges)]}
    legacy["objects"][1]["id"] = "legacy-edge"
    for spec in legacy["objects"]:
        for feature in spec["features"]:
            feature.pop("reference", None)
            feature.pop("references", None)
    original = deepcopy(legacy)
    promoted = cad.model_response(legacy)["project"]
    assert legacy == original
    assert all("reference" in feature for feature in promoted["objects"][0]["features"])
    assert promoted["objects"][1]["features"][0]["references"]
    assert len(cad.build_project(promoted)) == 2
    promoted["objects"][0]["features"].pop(0)
    try:
        cad.build_project(promoted)
    except cad.ModelError as error:
        assert "Bezugsfläche hat sich verändert" in str(error)
    else:
        raise AssertionError("The migrated legacy history lost its geometric guard.")
    print("Geometric reference checks passed: wrong face/edge rejected, normalized resizing accepted.")
    print("Legacy migration checks passed: original unchanged, response anchored, rebuild guarded.")


if __name__ == "__main__":
    main()
