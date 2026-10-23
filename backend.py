"""Local browser CAD prototype backed by native Open CASCADE through FreeCAD.

Run with FreeCAD's bundled Python: python.exe backend.py
Only 127.0.0.1 is bound; geometry is processed locally. Units are millimetres.
"""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import math
import mimetypes
from pathlib import Path
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

import FreeCAD as App
import Part
import Import

ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web"
TEMP_ROOT = ROOT / ".runtime"
TEMP_ROOT.mkdir(exist_ok=True)
MAX_BODY = 40 * 1024 * 1024
CAD_LOCK = threading.RLock()
V = App.Vector
EPS = 1e-7
MAX_DIMENSION = 10000.0


class ModelError(ValueError):
    pass


def number(value, label, minimum=None, maximum=MAX_DIMENSION):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ModelError(f"{label}: Zahl erwartet.")
    value = float(value)
    if not math.isfinite(value):
        raise ModelError(f"{label}: endliche Zahl erwartet.")
    if minimum is not None and value < minimum:
        raise ModelError(f"{label}: muss mindestens {minimum:g} mm sein.")
    if maximum is not None and abs(value) > maximum:
        raise ModelError(f"{label}: maximal {maximum:g} mm erlaubt.")
    return value


def vector3(value, label):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ModelError(f"{label}: drei Koordinaten erwartet.")
    return V(*(number(c, label) for c in value))


def xyz(v):
    return [float(v.x), float(v.y), float(v.z)]


def validate_shape(shape, context="Geometrie"):
    if shape.isNull() or not shape.isValid():
        raise ModelError(f"{context}: keine gültige CAD-Geometrie erzeugt.")
    if len(shape.Solids) != 1 or not shape.isClosed() or shape.Volume <= EPS:
        raise ModelError(f"{context}: ein zusammenhängender, geschlossener Körper erforderlich.")
    return shape


def face_frame(face):
    """Stable right-handed plane frame, local to the current body."""
    if not isinstance(face.Surface, Part.Plane):
        raise ModelError("Eine Skizze ist nur auf einer ebenen Fläche möglich.")
    a, b, c, d = face.ParameterRange
    normal = face.normalAt((a + b) / 2, (c + d) / 2)
    normal.normalize()
    reference = V(1, 0, 0) if abs(normal.x) < 0.9 else V(0, 1, 0)
    u = reference - normal * reference.dot(normal)
    u.normalize()
    v = normal.cross(u)
    v.normalize()
    return face.CenterOfMass, normal, u, v


def normalized_point(point, bounds):
    """Dimensionless body coordinates, invariant under translation and box resize."""
    return [(value - low) / max(length, EPS) for value, low, length in
            [(point.x, bounds.XMin, bounds.XLength),
             (point.y, bounds.YMin, bounds.YLength),
             (point.z, bounds.ZMin, bounds.ZLength)]]


def geometry_reference(entity, shape, kind):
    bounds = shape.BoundBox
    result = {"version": 1, "kind": kind,
              "center": normalized_point(entity.CenterOfMass, bounds)}
    if kind == "face":
        result["surface"] = type(entity.Surface).__name__
        if isinstance(entity.Surface, Part.Plane):
            result["normal"] = xyz(face_frame(entity)[1])
    else:
        result["curve"] = type(entity.Curve).__name__
        result["start"] = normalized_point(entity.valueAt(entity.FirstParameter), bounds)
        result["end"] = normalized_point(entity.valueAt(entity.LastParameter), bounds)
    return result


def reference_matches(expected, actual, tolerance=1e-5):
    if isinstance(actual, dict):
        return (isinstance(expected, dict) and set(expected) == set(actual)
                and all(reference_matches(expected[key], value, tolerance)
                        for key, value in actual.items()))
    if isinstance(actual, list):
        return (isinstance(expected, list) and len(expected) == len(actual)
                and all(reference_matches(a, b, tolerance) for a, b in zip(expected, actual)))
    if isinstance(actual, (int, float)) and not isinstance(actual, bool):
        return (isinstance(expected, (int, float)) and not isinstance(expected, bool)
                and math.isfinite(expected) and abs(expected - actual) <= tolerance)
    return type(expected) is type(actual) and expected == actual


def validate_reference(expected, entity, shape, kind):
    if expected is not None and not reference_matches(expected, geometry_reference(entity, shape, kind)):
        noun = "Bezugsfläche" if kind == "face" else "Bezugskante"
        target = "Fläche" if kind == "face" else "Kante"
        raise ModelError(f"{noun} hat sich verändert. Bitte Bearbeitung neu auf der gewünschten {target} anlegen.")


def feature_index(value, count, kind):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > count:
        raise ModelError(f"{kind}: Index 1 bis {count} erwartet.")
    return value - 1


def sketch_face(spec, support):
    if not isinstance(spec, dict):
        raise ModelError("Skizze fehlt.")
    origin, normal, u, v = face_frame(support)
    center = spec.get("center", [0, 0])
    if not isinstance(center, (list, tuple)) or len(center) != 2:
        raise ModelError("Skizzenmittelpunkt: zwei Koordinaten erwartet.")
    cu, cv = (number(n, "Skizzenmittelpunkt") for n in center)
    p = origin + u * cu + v * cv
    kind = spec.get("kind")
    if kind == "rectangle":
        width = number(spec.get("width", 10), "Skizzenbreite", 0.01)
        height = number(spec.get("height", 10), "Skizzenhöhe", 0.01)
        corners = [p + u * x + v * y for x, y in
                   [(-width / 2, -height / 2), (width / 2, -height / 2),
                    (width / 2, height / 2), (-width / 2, height / 2)]]
        profile = Part.Face(Part.makePolygon(corners + [corners[0]]))
    elif kind == "circle":
        radius = number(spec.get("radius", 5), "Skizzenradius", 0.005)
        profile = Part.Face(Part.Wire([Part.makeCircle(radius, p, normal)]))
    else:
        raise ModelError("Unbekannte Skizzenform. Rechteck oder Kreis auswählen.")
    return profile, normal


def build_object(spec):
    if not isinstance(spec, dict):
        raise ModelError("Objekt muss ein JSON-Objekt sein.")
    params = spec.get("params", {})
    if not isinstance(params, dict):
        raise ModelError("Objektmaße müssen ein JSON-Objekt sein.")
    kind = spec.get("kind", "box")
    height = number(params.get("height", 10), "Höhe", 0.01)
    if kind == "box":
        width = number(params.get("width", 30), "Breite", 0.01)
        depth = number(params.get("depth", 20), "Tiefe", 0.01)
        shape = Part.makeBox(width, depth, height, V(-width / 2, -depth / 2, 0))
    elif kind == "cylinder":
        radius = number(params.get("radius", 10), "Radius", 0.005)
        shape = Part.makeCylinder(radius, height)
    elif kind == "imported":
        encoded = spec.get("sourceBase64")
        if not isinstance(encoded, str) or len(encoded) > MAX_BODY:
            raise ModelError("STEP-Quelldaten fehlen oder sind zu groß.")
        try:
            raw = base64.b64decode(encoded, validate=True)
        except Exception as exc:
            raise ModelError("STEP-Quelldaten sind ungültig.") from exc
        if not raw.lstrip().startswith(b"ISO-10303-21"):
            raise ModelError("Datei ist keine STEP-Datei.")
        with tempfile.TemporaryDirectory(prefix="cad_local_", dir=TEMP_ROOT) as temp:
            path = Path(temp) / "source.step"
            path.write_bytes(raw)
            try:
                shape = Part.read(str(path))
            except Exception as exc:
                raise ModelError("STEP-Quelldaten konnten nicht gelesen werden.") from exc
    else:
        raise ModelError(f"Unbekannter Grundkörper: {kind!r}.")
    validate_shape(shape, "Grundkörper")
    features = spec.get("features", [])
    if not isinstance(features, list) or len(features) > 50:
        raise ModelError("Maximal 50 Bearbeitungen pro Körper möglich.")
    for n, feature in enumerate(features, 1):
        if not isinstance(feature, dict):
            raise ModelError(f"Bearbeitung {n}: ungültige Daten.")
        op = feature.get("type")
        try:
            if op in ("extrude", "pocket"):
                index = feature_index(feature.get("face"), len(shape.Faces), "Fläche")
                validate_reference(feature.get("reference"), shape.Faces[index], shape, "face")
                profile, normal = sketch_face(feature.get("sketch"), shape.Faces[index])
                depth = number(feature.get("depth", 5), "Tiefe", 0.01)
                prism = profile.extrude(normal * (depth if op == "extrude" else -depth))
                before = shape.Volume
                shape = (shape.fuse(prism) if op == "extrude" else shape.cut(prism)).removeSplitter()
                validate_shape(shape, f"Bearbeitung {n}")
                if abs(shape.Volume - before) < EPS:
                    raise ModelError("Skizze berührt den Körper nicht oder ändert kein Volumen.")
            elif op in ("fillet", "chamfer"):
                ids = feature.get("edges", [])
                if not isinstance(ids, list) or not ids:
                    raise ModelError("Mindestens eine Kante auswählen.")
                indices = [feature_index(i, len(shape.Edges), "Kante") for i in ids]
                if len(indices) != len(set(indices)):
                    raise ModelError("Kanten dürfen nicht doppelt ausgewählt sein.")
                edges = [shape.Edges[i] for i in indices]
                references = feature.get("references")
                if references is not None:
                    if not isinstance(references, list) or len(references) != len(edges):
                        raise ModelError("Für jede ausgewählte Kante ist ein Geometriebezug erforderlich.")
                    for reference, edge in zip(references, edges):
                        validate_reference(reference, edge, shape, "edge")
                if op == "fillet":
                    radius = number(feature.get("radius", 1), "Rundungsradius", 0.005)
                    shape = shape.makeFillet(radius, edges)
                else:
                    distance = number(feature.get("distance", 1), "Fasenbreite", 0.005)
                    shape = shape.makeChamfer(distance, edges)
                validate_shape(shape, f"Bearbeitung {n}")
            else:
                raise ModelError(f"Unbekannte Bearbeitung: {op!r}.")
        except ModelError as exc:
            raise ModelError(f"Bearbeitung {n}: {exc}") from exc
        except Exception as exc:
            raise ModelError(f"Bearbeitung {n} ({op}) konnte mit diesen Maßen nicht erstellt werden.") from exc
    position = vector3(spec.get("position", [0, 0, 0]), "Position")
    result = shape.copy()
    result.translate(position)
    return validate_shape(result)


def build_project(project):
    if not isinstance(project, dict) or project.get("version", 1) != 1:
        raise ModelError("Ungültiges Projektformat (Version 1 erwartet).")
    objects = project.get("objects")
    if not isinstance(objects, list) or len(objects) > 30:
        raise ModelError("Projekt muss eine Liste mit maximal 30 Körpern enthalten.")
    ids = []
    results = []
    for index, spec in enumerate(objects):
        identifier = spec.get("id") if isinstance(spec, dict) else None
        if not isinstance(identifier, str) or not identifier or len(identifier) > 128:
            raise ModelError(f"Körper {index + 1}: gültige Kennung fehlt.")
        if identifier in ids:
            raise ModelError("Körper-Kennungen müssen eindeutig sein.")
        ids.append(identifier)
        try:
            results.append((spec, build_object(spec)))
        except ModelError as exc:
            raise ModelError(f"{spec.get('name', identifier)}: {exc}") from exc
    return results


def shape_json(spec, shape):
    vertices, triangles, face_ids, faces = [], [], [], []
    for face_id, face in enumerate(shape.Faces, 1):
        points, facets = face.tessellate(0.12)
        offset = len(vertices)
        vertices.extend(xyz(p) for p in points)
        triangles.extend([[a + offset, b + offset, c + offset] for a, b, c in facets])
        face_ids.extend([face_id] * len(facets))
        planar = isinstance(face.Surface, Part.Plane)
        entry = {"id": face_id, "planar": planar, "area": face.Area,
                 "reference": geometry_reference(face, shape, "face")}
        if planar:
            origin, normal, u, v = face_frame(face)
            entry.update(origin=xyz(origin), normal=xyz(normal), u=xyz(u), v=xyz(v))
        faces.append(entry)
    edges = []
    for edge_id, edge in enumerate(shape.Edges, 1):
        try:
            points = edge.discretize(Deflection=0.08)
        except Exception:
            points = edge.discretize(Number=32)
        edges.append({"id": edge_id, "points": [xyz(p) for p in points], "length": edge.Length,
                      "reference": geometry_reference(edge, shape, "edge")})
    bb = shape.BoundBox
    return {
        "id": spec["id"], "name": str(spec.get("name", spec["id"]))[:200],
        "mesh": {"vertices": vertices, "triangles": triangles, "faceIds": face_ids},
        "faces": faces, "edges": edges,
        "bounds": {"min": [bb.XMin, bb.YMin, bb.ZMin], "max": [bb.XMax, bb.YMax, bb.ZMax]},
        "volume": float(shape.Volume), "valid": True,
    }


def model_response(project):
    # Validate the complete history first. Only a successful response promotes
    # a legacy history to geometric references; the caller's data is untouched.
    canonical = copy.deepcopy(project)
    models = build_project(canonical)
    for spec, _ in models:
        features = spec.get("features", [])
        for index, feature in enumerate(features):
            kind = feature.get("type")
            missing_face = kind in ("extrude", "pocket") and feature.get("reference") is None
            references = feature.get("references")
            missing_edges = kind in ("fillet", "chamfer") and (
                references is None or any(reference is None for reference in references))
            if not missing_face and not missing_edges:
                continue
            prefix = dict(spec)
            prefix["features"] = features[:index]
            before = build_object(prefix)
            if missing_face:
                face_index = feature_index(feature["face"], len(before.Faces), "Fläche")
                feature["reference"] = geometry_reference(before.Faces[face_index], before, "face")
            else:
                feature["references"] = [
                    (references[i] if references is not None and references[i] is not None
                     else geometry_reference(before.Edges[feature_index(edge_id, len(before.Edges), "Kante")],
                                             before, "edge"))
                    for i, edge_id in enumerate(feature["edges"])]
    return {"project": canonical, "objects": [shape_json(spec, shape) for spec, shape in models]}


def export_project(project, kind):
    models = build_project(project)
    if not models:
        raise ModelError("Das Projekt enthält keine Körper zum Exportieren.")
    with tempfile.TemporaryDirectory(prefix="cad_export_", dir=TEMP_ROOT) as temp:
        path = Path(temp) / ("Werkstueck.step" if kind == "step" else "Werkstueck.stl")
        if kind == "step":
            doc = App.newDocument("CADLocalExport")
            try:
                features = []
                for i, (spec, shape) in enumerate(models):
                    feature = doc.addObject("PartDesign::Feature", f"Body_{i + 1}")
                    feature.Label = str(spec.get("name", spec["id"]))[:200]
                    feature.Shape = shape
                    features.append(feature)
                doc.recompute()
                Import.export(features, str(path))
            finally:
                App.closeDocument(doc.Name)
        else:
            Part.makeCompound([shape for _, shape in models]).exportStl(str(path))
        return path.read_bytes()


def import_step(encoded, filename="Import.step"):
    """Split an imported assembly into independently selectable native solids."""
    if not isinstance(encoded, str):
        raise ModelError("STEP-Datei fehlt.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ModelError("Dateiinhalt ist ungültig.") from exc
    if len(raw) > 25 * 1024 * 1024 or not raw.lstrip().startswith(b"ISO-10303-21"):
        raise ModelError("Eine STEP-Datei bis 25 MB erwartet.")
    with tempfile.TemporaryDirectory(prefix="cad_import_", dir=TEMP_ROOT) as temp:
        path = Path(temp) / "assembly.step"
        path.write_bytes(raw)
        try:
            shape = Part.read(str(path))
        except Exception as exc:
            raise ModelError("STEP-Datei konnte nicht gelesen werden.") from exc
        if shape.isNull() or not shape.isValid() or not shape.Solids:
            raise ModelError("STEP-Datei enthält keine gültigen Volumenkörper.")
        if len(shape.Solids) > 30:
            raise ModelError("Diese Version unterstützt maximal 30 importierte Körper.")
        objects = []
        for i, solid in enumerate(shape.Solids, 1):
            validate_shape(solid, "Import")
            solid_path = Path(temp) / f"body_{i}.step"
            solid.exportStep(str(solid_path))
            body_encoded = base64.b64encode(solid_path.read_bytes()).decode("ascii")
            digest = hashlib.sha256(raw + str(i).encode()).hexdigest()[:12]
            objects.append({"id": f"import-{digest}", "name": f"{Path(filename).stem} {i}",
                            "kind": "imported", "params": {}, "position": [0, 0, 0],
                            "features": [], "sourceBase64": body_encoded})
    return model_response({"version": 1, "objects": objects})


class Handler(BaseHTTPRequestHandler):
    server_version = "CADLokal/0.1"
    protocol_version = "HTTP/1.1"

    def _origin_ok(self):
        host = self.headers.get("Host", "")
        try:
            host_name = urlsplit("http://" + host).hostname
        except ValueError:
            return False
        if host_name not in ("localhost", "127.0.0.1", "::1"):
            return False
        origin = self.headers.get("Origin")
        if origin:
            try:
                parsed = urlsplit(origin)
                if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
                    return False
                if parsed.port != self.server.server_port:
                    return False
            except ValueError:
                return False
        return True

    def send_bytes(self, status, body, content_type, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, value):
        self.send_bytes(status, json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                        "application/json; charset=utf-8")

    def do_GET(self):
        if not self._origin_ok():
            self.send_json(403, {"error": "Nur lokaler Browserzugriff erlaubt."})
            return
        route = urlsplit(self.path).path
        if route == "/api/health":
            self.send_json(200, {"ok": True, "app": "formraum-local-cad", "engine": "FreeCAD / Open CASCADE", "version": ".".join(App.Version()[:3]),
                                 "units": "mm", "local": True})
            return
        try:
            relative = unquote(route).lstrip("/") or "index.html"
            path = (WEB_ROOT / relative).resolve()
            if not path.is_relative_to(WEB_ROOT.resolve()) or not path.is_file():
                self.send_json(404, {"error": "Datei nicht gefunden."})
                return
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if path.suffix in (".js", ".mjs"):
                mime = "application/javascript"
            self.send_bytes(200, path.read_bytes(), mime)
        except (OSError, ValueError):
            self.send_json(404, {"error": "Datei nicht gefunden."})

    def do_POST(self):
        if not self._origin_ok():
            self.send_json(403, {"error": "Nur lokaler Browserzugriff erlaubt."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > MAX_BODY:
                raise ModelError("Anfrage fehlt oder ist zu groß (maximal 40 MB).")
            if "application/json" not in self.headers.get("Content-Type", ""):
                raise ModelError("JSON-Anfrage erwartet.")
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ModelError("JSON-Objekt erwartet.")
            route = urlsplit(self.path).path
            with CAD_LOCK:
                if route == "/api/model":
                    self.send_json(200, model_response(payload.get("project")))
                elif route in ("/api/export_step", "/api/export_stl"):
                    kind = "step" if route.endswith("step") else "stl"
                    data = export_project(payload.get("project"), kind)
                    self.send_bytes(200, data, "application/step" if kind == "step" else "model/stl",
                                    f"Werkstueck.{kind}")
                elif route == "/api/import_step":
                    self.send_json(200, import_step(payload.get("base64"), payload.get("filename", "Import.step")))
                else:
                    self.send_json(404, {"error": "API-Pfad nicht gefunden."})
        except (ModelError, json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
            self.send_json(400, {"error": str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            self.send_json(500, {"error": "CAD-Berechnung fehlgeschlagen. Die bestehenden Projektdaten bleiben erhalten."})


def main():
    parser = argparse.ArgumentParser(description="Lokales CAD mit FreeCAD-Kern")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    print(f"CAD Lokal: http://127.0.0.1:{args.port} – FreeCAD {'.'.join(App.Version()[:3])}, mm", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
