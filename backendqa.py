"""Native workflow checks; run with FreeCAD's python.exe, no test framework needed."""
from __future__ import annotations

import argparse
import base64
import copy
import json
import math
from pathlib import Path
import re
import struct
import tempfile
import urllib.error
import urllib.request

import backend
import Part


def assert_close(actual, expected, tolerance=1e-6):
    assert abs(actual - expected) <= tolerance, (actual, expected, tolerance)


def top_face(shape):
    choices = [(i, face.CenterOfMass.z) for i, face in enumerate(shape.Faces, 1)
               if isinstance(face.Surface, Part.Plane) and backend.face_frame(face)[1].z > 0.99]
    return max(choices, key=lambda item: item[1])[0]


def triangle_data(data):
    """Read exported STL independently of the exporter, in binary or ASCII form."""
    count = struct.unpack_from('<I', data, 80)[0] if len(data) >= 84 else -1
    if len(data) == 84 + 50 * count:
        return [[struct.unpack_from('<3f', data, 84 + 50 * i + 12 + 12 * j)
                 for j in range(3)] for i in range(count)]
    vertices = [tuple(map(float, m)) for m in re.findall(
        r'\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)', data.decode('ascii'))]
    assert len(vertices) % 3 == 0
    return [vertices[i:i + 3] for i in range(0, len(vertices), 3)]


def mesh_components(triangles):
    edges, parents = {}, list(range(len(triangles)))

    def find(n):
        while parents[n] != n:
            parents[n] = parents[parents[n]]
            n = parents[n]
        return n

    for i, tri in enumerate(triangles):
        points = [tuple(round(c, 5) for c in p) for p in tri]
        for j in range(3):
            edge = tuple(sorted((points[j], points[(j + 1) % 3])))
            edges.setdefault(edge, []).append(i)
    for connected in edges.values():
        assert len(connected) == 2, 'STL must contain closed manifold components'
        a, b = map(find, connected)
        parents[a] = b
    return len({find(i) for i in range(len(triangles))})


def run_native():
    body = {'id': 'box', 'name': 'Workflow Quader', 'kind': 'box',
            'params': {'width': 30, 'depth': 20, 'height': 10}, 'features': [], 'position': [0, 0, 0]}
    project = {'version': 1, 'objects': [body]}
    shape = backend.build_project(project)[0][1]
    assert_close(shape.Volume, 6000)
    assert_close(shape.BoundBox.XLength, 30)
    assert_close(shape.BoundBox.YLength, 20)
    assert_close(shape.BoundBox.ZLength, 10)
    body['features'].append({'type': 'extrude', 'face': top_face(shape), 'depth': 4,
                             'sketch': {'kind': 'rectangle', 'width': 8, 'height': 6, 'center': [0, 0]}})
    shape = backend.build_project(project)[0][1]
    assert_close(shape.Volume, 6000 + 8 * 6 * 4)
    assert_close(shape.BoundBox.ZMax, 14)
    body['features'].append({'type': 'pocket', 'face': top_face(shape), 'depth': 3,
                             'sketch': {'kind': 'circle', 'radius': 1.5, 'center': [0, 0]}})
    shape = backend.build_project(project)[0][1]
    pocket_volume = 6000 + 8 * 6 * 4 - math.pi * 1.5 ** 2 * 3
    assert_close(shape.Volume, pocket_volume)
    edge = next(i for i, e in enumerate(shape.Edges, 1)
                if abs(e.BoundBox.ZMin - 14) < 1e-6 and abs(e.BoundBox.ZMax - 14) < 1e-6
                and abs(e.Length - 8) < 1e-6)
    body['features'].append({'type': 'fillet', 'edges': [edge], 'radius': 0.5})
    shape = backend.build_project(project)[0][1]
    assert shape.Volume < pocket_volume and shape.Volume > pocket_volume - 10
    cylinder = {'id': 'cylinder', 'name': 'Workflow Zylinder', 'kind': 'cylinder',
                'params': {'radius': 7, 'height': 14}, 'features': [], 'position': [50, 0, 0]}
    cylinder_shape = backend.build_object(cylinder)
    rim = next(i for i, edge in enumerate(cylinder_shape.Edges, 1)
               if abs(edge.BoundBox.ZMin - 14) < 1e-6 and abs(edge.BoundBox.ZMax - 14) < 1e-6)
    cylinder['features'].append({'type': 'chamfer', 'edges': [rim], 'distance': 1})
    project['objects'].append(cylinder)
    models = backend.build_project(project)
    assert models[1][1].Volume < math.pi * 7 ** 2 * 14
    metadata = backend.model_response(project)
    assert all(len(o['mesh']['faceIds']) == len(o['mesh']['triangles']) for o in metadata['objects'])
    assert all(o['faces'] and o['edges'] and o['valid'] for o in metadata['objects'])
    for op in ({'type': 'pocket', 'face': 999, 'depth': 1, 'sketch': {'kind': 'circle', 'radius': 1}},
               {'type': 'fillet', 'edges': [1], 'radius': 1000},
               {'type': 'extrude', 'face': top_face(shape), 'depth': 2,
                'sketch': {'kind': 'rectangle', 'width': 2, 'height': 2, 'center': [100, 100]}}):
        rejected = copy.deepcopy(project)
        rejected['objects'][0]['features'].append(op)
        before = copy.deepcopy(rejected)
        try:
            backend.build_project(rejected)
        except backend.ModelError:
            pass
        else:
            raise AssertionError('Invalid operation was accepted')
        assert rejected == before, 'Backend mutated rejected project'
    expected_volume = sum(s.Volume for _, s in models)
    with tempfile.TemporaryDirectory(prefix='qa_', dir=backend.TEMP_ROOT) as folder:
        path = Path(folder) / 'roundtrip.step'
        step = backend.export_project(project, 'step')
        path.write_bytes(step)
        imported = Part.read(str(path))
        assert len(imported.Solids) == 2 and imported.isValid() and imported.isClosed()
        assert_close(imported.Volume, expected_volume, 1e-5)
        split_import = backend.import_step(base64.b64encode(step).decode('ascii'), 'QA.step')
        assert len(split_import['objects']) == 2
        assert_close(sum(o['volume'] for o in split_import['objects']), expected_volume, 1e-5)
        triangles = triangle_data(backend.export_project(project, 'stl'))
        assert len(triangles) > 24
        assert mesh_components(triangles) == 2
        assert_close(min(p[0] for t in triangles for p in t), -15, 0.03)
        assert_close(max(p[0] for t in triangles for p in t), 57, 0.03)
        assert_close(max(p[2] for t in triangles for p in t), 14, 0.03)
    return {'native': 'passed', 'solids': 2, 'stl_triangles': len(triangles),
            'features': ['rectangle extrude', 'circle pocket', 'fillet', 'chamfer'],
            'roundtrips': ['STEP', 'STEP assembly import', 'STL closed components'],
            'project': project}


def run_http(url, project):
    def request(route, value=None):
        data = json.dumps(value).encode() if value is not None else None
        req = urllib.request.Request(url + route, data=data,
                                     headers={'Content-Type': 'application/json'})
        return urllib.request.urlopen(req, timeout=30).read()
    health = json.loads(request('/api/health'))
    assert health.get('app') == 'formraum-local-cad' and health.get('local') is True
    initial = json.loads(request('/api/model', {'project': project}))
    assert len(initial['objects']) == 2
    assert request('/api/export_step', {'project': project}).lstrip().startswith(b'ISO-10303-21')
    bad = copy.deepcopy(project)
    bad['objects'][0]['params']['height'] = -1
    try:
        request('/api/model', {'project': bad})
    except urllib.error.HTTPError as exc:
        assert exc.code == 400 and json.loads(exc.read()).get('error')
    else:
        raise AssertionError('HTTP invalid geometry accepted')
    after = json.loads(request('/api/model', {'project': project}))
    assert [o['volume'] for o in initial['objects']] == [o['volume'] for o in after['objects']]
    return {'http': 'passed', 'local_health': True, 'invalid_request': 400}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--server', help='Optional existing local server, e.g. http://127.0.0.1:8787')
    args = parser.parse_args()
    result = run_native()
    project = result.pop('project')
    if args.server:
        result.update(run_http(args.server.rstrip('/'), project))
    print(json.dumps(result, ensure_ascii=False, indent=2))
