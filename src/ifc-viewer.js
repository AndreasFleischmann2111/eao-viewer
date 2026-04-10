/**
 * ifc-viewer.js
 * IFC 3D viewer using @thatopen/components + @thatopen/fragments + three.js.
 * Bundled by esbuild into public/ifc-viewer.bundle.js.
 *
 * Implements all 13 workarounds documented in docs/ifc-viewer-implementation.md.
 */

import * as OBC from '@thatopen/components';
import * as FRAGS from '@thatopen/fragments';
import * as THREE from 'three';

class IfcViewer {
  constructor(containerEl) {
    this.container   = containerEl;
    this.components  = null;
    this.world       = null;
    this.fragments   = null;
    this.ifcLoader   = null;
    this.model       = null;
    this.propModelId = null;
    this.updateTimer = null;
    this._disposed   = false;
  }

  /**
   * Initialize the OBC scene, renderer and camera.
   * Must be called once before loadIfc().
   */
  async init() {
    // Workaround #8: renderer MUST be set before camera
    this.components = new OBC.Components();

    const worlds  = this.components.get(OBC.Worlds);
    this.world    = worlds.create();

    this.world.scene    = new OBC.SimpleScene(this.components);
    this.world.renderer = new OBC.SimpleRenderer(this.components, this.container); // renderer first
    this.world.camera   = new OBC.SimpleCamera(this.components);                   // camera second

    this.world.scene.setup();

    // Workaround #9: white background requires three separate calls
    this.world.scene.three.background = new THREE.Color(0xffffff);
    this.world.scene.three.fog        = null;
    this.world.renderer.three.setClearColor(0xffffff, 1);

    this.components.init();

    // Workaround #12: FragmentsManager lives in OBC, not FRAGS
    this.fragments = this.components.get(OBC.FragmentsManager);

    // Workaround #1: classicWorker:true — the worker file has its ES export stripped
    this.fragments.init('/fragments.worker.js', { classicWorker: true });

    this.ifcLoader = this.components.get(OBC.IfcLoader);
    await this.ifcLoader.setup();

    // Workaround #2: force single-thread WASM BEFORE any IfcImporter is created
    this.ifcLoader.webIfc.SetWasmPath('/', true);
    await this.ifcLoader.webIfc.Init(undefined, true); // forceSingleThread = true
  }

  /**
   * Parse an IFC ArrayBuffer and display the 3D model.
   * @param {ArrayBuffer} arrayBuffer  Raw IFC file bytes
   * @param {function}    onProgress   Called with progress string, or null when done
   */
  async loadIfc(arrayBuffer, onProgress) {
    if (!this.components) await this.init();

    const rawBytes = new Uint8Array(arrayBuffer);

    // Workaround #3: inject pre-initialised IfcAPI so process() never calls Init() again
    const serializer = new FRAGS.IfcImporter();
    serializer.wasm.path     = '/';
    serializer.wasm.absolute = true;
    serializer.webIfcSettings = { ...this.ifcLoader.settings.webIfc };
    serializer.getIfcApi = async () => this.ifcLoader.webIfc;

    // Step 1: IFC → fragment bytes
    if (onProgress) onProgress('Parsing IFC geometry…');
    const bytes = await serializer.process({
      bytes: rawBytes,
      progressCallback: (p) => {
        if (onProgress) onProgress(`Parsing: ${Math.round(p * 100)}%`);
      },
    });

    // Workaround #4: 50 ms pump running concurrently with load()
    if (onProgress) onProgress('Building 3D tiles…');
    let pumpDone = false;
    const pump = setInterval(async () => {
      if (pumpDone) { clearInterval(pump); return; }
      try { await this.fragments.core.update(true); } catch { /* ignore */ }
    }, 50);

    try {
      this.model = await this.fragments.core.load(bytes, {
        modelId: `ifc-${Date.now()}`,
        camera:  this.world.camera.three,  // required for LOD culling
      });
    } finally {
      pumpDone = true;
      clearInterval(pump);
    }

    // Workaround #7: model.object must be added to scene manually
    this.world.scene.three.add(this.model.object);

    // Open IFC a second time for property queries (does not interfere with fragment model)
    this.propModelId = this.ifcLoader.webIfc.OpenModel(rawBytes);

    // Workaround #5: 200 ms ongoing update loop so tiles keep streaming in
    let updating = false;
    this.updateTimer = setInterval(async () => {
      if (this._disposed || !this.fragments?.initialized || updating) return;
      updating = true;
      try { await this.fragments.core.update(true); } catch { /* ignore */ }
      updating = false;
    }, 200);

    // Workaround #6: deferred camera fit — bbox is empty at load time
    let fitted = false;
    this.model.onViewUpdated.add(() => {
      if (fitted || this.model.box.isEmpty()) return;
      fitted = true;
      const sphere = this.model.box.getBoundingSphere(new THREE.Sphere());
      this.world.camera.controls.fitToSphere(sphere, true);
      if (onProgress) onProgress(null); // signal: done
    });
  }

  /** Fit camera to model bounding sphere. */
  fitAll() {
    if (!this.model || this.model.box.isEmpty()) return;
    const sphere = this.model.box.getBoundingSphere(new THREE.Sphere());
    this.world.camera.controls.fitToSphere(sphere, true);
  }

  /** Clean up all resources. */
  dispose() {
    this._disposed = true;
    if (this.updateTimer) clearInterval(this.updateTimer);
    if (this.ifcLoader && this.propModelId != null) {
      try { this.ifcLoader.webIfc.CloseModel(this.propModelId); } catch { /* ignore */ }
    }
    if (this.components) {
      try { this.components.dispose(); } catch { /* ignore */ }
    }
    this.model       = null;
    this.components  = null;
    this.fragments   = null;
    this.ifcLoader   = null;
    this.world       = null;
  }
}

// Expose globally so the classic-script app.js can use it
window.IfcViewer = IfcViewer;
