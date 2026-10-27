Three.js r180 (npm 0.180.0), MIT license.

Local files from the official mrdoob/three.js r180 Git tag:
- https://raw.githubusercontent.com/mrdoob/three.js/r180/build/three.module.js
- https://raw.githubusercontent.com/mrdoob/three.js/r180/build/three.core.js
- https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/jsm/controls/OrbitControls.js
- https://raw.githubusercontent.com/mrdoob/three.js/r180/LICENSE

OrbitControls.js has one local import adjustment: 'three' -> './three.module.js'.
All rendering dependencies are served locally; the app needs no CDN.
License text: THREE-LICENSE.txt
TransformControls.js: Three.js r180 examples/jsm/controls/TransformControls.js, MIT; local import rewritten to three.module.js.
ConvexHull.js: Three.js r180 examples/jsm/math/ConvexHull.js, MIT; local import rewritten to three.core.js.
