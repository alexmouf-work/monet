/**
 * The 3D viewport renderer — docs/11 §5, raw WebGL2 (D11.1). Same discipline as the 2D
 * renderer: one canvas, a rAF loop gated by an invalidate flag, content invalidations
 * rebuild the mesh and re-upload changed textures, camera moves just redraw.
 *
 * GL notes that earn their comments:
 * - `frontFace(CW)`: geometry.ts orders every face's corners (s0t0…s0t1) seen from outside,
 *   which projects clockwise — one uniform rule instead of per-face winding.
 * - Textures are NEAREST/NEAREST with no mipmaps (Minecraft's look; mips would blur texels).
 * - texture v runs downward because ImageData row 0 uploads as texel row 0 — Minecraft's uv
 *   space, no flips anywhere.
 */
import type { CameraState, Model3D } from '../core/model3d/types';
import { projMatrix, viewMatrix } from '../core/model3d/camera';
import { buildMesh, type MeshData } from '../core/model3d/geometry';
import { multiply } from '../core/model3d/vec';
import type { ModelTexturePixels } from '../app/modelActions';

export interface ModelScene {
  model: Model3D | null;
  camera: CameraState;
  textures: Map<string, ModelTexturePixels>;
  hoverKey: number; // faceKey under the cursor, -1 for none
  selectedElement: number; // element id, -1 for none
  accent: string; // CSS hex from the theme
  /** Translate-gizmo origin in model space, or null (docs/11 §10.1 item 4). */
  gizmo: { x: number; y: number; z: number } | null;
  /** Inference plane held by the current drag (docs/11 §10.1 item 2), or null. */
  snapLine: { axis: 'x' | 'y' | 'z'; value: number } | null;
  /** Clear to transparent instead of the surround — render-to-PNG only (§13.3). */
  transparent?: boolean;
  /**
   * Extra model transform for the MESH only — a `display` slot preview (docs/11 §10.2). The
   * grid, bounds and axes stay in world space: they are what the model is being moved against.
   */
  modelMatrix?: Float32Array | null;
  surround: string; // CSS hex from the theme
  flatShade: boolean;
  grid: boolean;
}

const MESH_VS = `#version 300 es
in vec3 aPos; in vec2 aUV; in float aShade; in float aKey;
uniform mat4 uMVP;
out vec2 vUV; out float vShade; out float vKey;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vUV = aUV; vShade = aShade; vKey = aKey;
}`;

const MESH_FS = `#version 300 es
precision mediump float;
in vec2 vUV; in float vShade; in float vKey;
uniform sampler2D uTex; uniform float uHoverKey; uniform float uSelectedEl;
uniform vec3 uAccent; uniform bool uFlat;
out vec4 o;
void main() {
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.1) discard;               // Minecraft cutout
  vec3 rgb = c.rgb * (uFlat ? 1.0 : vShade);
  float el = floor(vKey / 8.0 + 0.001);
  if (uSelectedEl >= 0.0 && abs(el - uSelectedEl) < 0.5) rgb = mix(rgb, uAccent, 0.25);
  if (uHoverKey >= 0.0 && abs(vKey - uHoverKey) < 0.5) rgb = mix(rgb, vec3(1.0), 0.3);
  o = vec4(rgb, 1.0);
}`;

const LINE_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`;

const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 o;
void main() { o = uColor; }`;

function hexToRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

interface TexEntry {
  tex: WebGLTexture;
  version: number;
  width: number;
  height: number;
}

export class ModelRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private meshProgram!: WebGLProgram;
  private lineProgram!: WebGLProgram;
  private meshVAO: WebGLVertexArrayObject | null = null;
  private mesh: MeshData | null = null;
  private meshFor = ''; // model id the VAO was built for
  private buffers: WebGLBuffer[] = [];
  private textures = new Map<string, TexEntry>();
  private fallback: WebGLTexture | null = null;
  private lineVAO: WebGLVertexArrayObject | null = null;
  private lineCounts: { grid: number; bounds: number; axes: [number, number, number] } = {
    grid: 0,
    bounds: 0,
    axes: [0, 0, 0],
  };
  private raf = 0;
  private dirty = true;
  private contentDirty = true;
  private lost = false;
  /** Set only for the duration of a render-to-PNG pass (see readFrame). */
  private sceneFilter: ((s: ModelScene) => ModelScene) | null = null;
  cssW = 1;
  cssH = 1;
  readonly stats = { frames: 0, totalMs: 0, maxMs: 0, lastMs: 0, rebuilds: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    private getScene: () => ModelScene,
  ) {
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.initGL();
  }

  private onLost = (e: Event) => {
    e.preventDefault(); // allow restore
    this.lost = true;
  };

  private onRestored = () => {
    // The document is the truth and GL state is a cache (docs/11 §15.7): rebuild everything.
    this.lost = false;
    this.textures.clear();
    this.meshFor = '';
    this.initGL();
    this.invalidate(true);
  };

  private initGL() {
    const gl = this.canvas.getContext('webgl2', {
      // alpha so render-to-PNG can clear transparent (§13.3); normal frames clear opaque, so
      // page compositing is unchanged. Straight (un-premultiplied) alpha keeps readPixels
      // values directly usable as PNG bytes.
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      // Lets the harness read pixels back after the frame — a debug aid, not a hot path.
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      this.gl = null;
      return;
    }
    this.gl = gl;
    try {
      this.meshProgram = this.program(MESH_VS, MESH_FS);
      this.lineProgram = this.program(LINE_VS, LINE_FS);
      this.fallback = this.makeFallbackTexture();
      this.buildLines();
    } catch (err) {
      // A context that exists but cannot compile (driver reset, blocked GPU process) must
      // degrade exactly like "no WebGL2": a blank viewport, never a crash into React.
      console.error('3D viewport unavailable:', (err as Error).message);
      this.gl = null;
    }
  }

  get available(): boolean {
    return !!this.gl && !this.lost;
  }

  private program(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl!;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`shader: ${gl.getShaderInfoLog(sh) || 'compile failed (no log)'}`);
      }
      return sh;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`program: ${gl.getProgramInfoLog(p) ?? 'link failed'}`);
    }
    return p;
  }

  /** The classic magenta/black missing-texture checker — unmistakable (docs/11 §4.2). */
  private makeFallbackTexture(): WebGLTexture {
    const gl = this.gl!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const px = new Uint8Array([255, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 255, 255]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  invalidate(content = false) {
    this.dirty = true;
    if (content) this.contentDirty = true;
  }

  start() {
    const loop = () => {
      if (this.dirty && this.available) {
        this.dirty = false;
        const t0 = performance.now();
        this.draw();
        const ms = performance.now() - t0;
        this.stats.frames += 1;
        this.stats.totalMs += ms;
        this.stats.lastMs = ms;
        if (ms > this.stats.maxMs) this.stats.maxMs = ms;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    // Free GPU objects but do NOT loseContext(): a canvas keeps its one context forever, so
    // killing it here leaves the next renderer on this canvas (StrictMode's double mount,
    // hot reload) compiling into a permanently lost context — which is exactly the bug this
    // comment used to be. The context itself goes when the canvas does.
    const gl = this.gl;
    if (gl && !this.lost) {
      for (const b of this.buffers) gl.deleteBuffer(b);
      for (const t of this.textures.values()) gl.deleteTexture(t.tex);
      if (this.meshVAO) gl.deleteVertexArray(this.meshVAO);
      if (this.lineVAO) gl.deleteVertexArray(this.lineVAO);
      gl.deleteProgram(this.meshProgram);
      gl.deleteProgram(this.lineProgram);
    }
    this.textures.clear();
    this.buffers = [];
    this.gl = null;
  }

  resize(cssW: number, cssH: number) {
    if (cssW < 2 || cssH < 2) return; // hidden behind the 2D workspace — keep the old size
    const dpr = window.devicePixelRatio || 1;
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.invalidate();
  }

  /** Centre pixel of the last presented frame — the harness's "did anything render" probe. */
  readCenter(): [number, number, number, number] {
    const gl = this.gl;
    if (!gl) return [0, 0, 0, 0];
    const px = new Uint8Array(4);
    gl.readPixels(
      Math.floor(gl.drawingBufferWidth / 2),
      Math.floor(gl.drawingBufferHeight / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      px,
    );
    return [px[0], px[1], px[2], px[3]];
  }

  /**
   * The whole framebuffer as top-down RGBA — render-to-PNG (docs/11 §13.3). The one
   * legitimate readback (§14): user-initiated and rare. Draws first so what is returned is
   * the current scene, not whatever the last rAF left behind.
   *
   * `clean` (the default) renders the MODEL only, on transparency: no grid, bounds, axes,
   * gizmo, inference plane, hover highlight or selection tint. An icon must not carry the
   * editor's furniture, and the selection tint in particular would recolour the whole block.
   */
  readFrame(clean = true): { pixels: Uint8ClampedArray; width: number; height: number } | null {
    const gl = this.gl;
    if (!gl || this.lost) return null;
    if (clean) {
      this.sceneFilter = (s) => ({
        ...s,
        grid: false,
        gizmo: null,
        snapLine: null,
        hoverKey: -1,
        selectedElement: -1,
        transparent: true,
      });
    }
    try {
      this.draw();
    } finally {
      this.sceneFilter = null;
    }
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const raw = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    // GL rows run bottom-up; images run top-down.
    const pixels = new Uint8ClampedArray(w * h * 4);
    const stride = w * 4;
    for (let y = 0; y < h; y++) {
      pixels.set(raw.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride);
    }
    // The viewport is stale now (it holds the clean pass); put the real scene back.
    if (clean) this.invalidate(false);
    return { pixels, width: w, height: h };
  }

  // ------------------------------------------------------------------ mesh & textures

  private rebuildMesh(model: Model3D) {
    const gl = this.gl!;
    for (const b of this.buffers) gl.deleteBuffer(b);
    this.buffers = [];
    if (this.meshVAO) gl.deleteVertexArray(this.meshVAO);

    const mesh = buildMesh(model.elements);
    this.mesh = mesh;
    this.stats.rebuilds += 1;

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const attach = (data: Float32Array, size: number, loc: number) => {
      const buf = gl.createBuffer()!;
      this.buffers.push(buf);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attach(mesh.positions, 3, 0);
    attach(mesh.uvs, 2, 1);
    attach(mesh.shades, 1, 2);
    attach(mesh.keys, 1, 3);
    const ibo = gl.createBuffer()!;
    this.buffers.push(ibo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    this.meshVAO = vao;
    this.meshFor = model.id;
  }

  private syncTexture(key: string, px: ModelTexturePixels): TexEntry {
    const gl = this.gl!;
    let entry = this.textures.get(key);
    if (!entry) {
      entry = { tex: gl.createTexture()!, version: -1, width: 0, height: 0 };
      this.textures.set(key, entry);
    }
    if (entry.version === px.version) return entry;
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    const bytes = new Uint8Array(px.pixels.buffer, px.pixels.byteOffset, px.pixels.byteLength);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      px.width,
      px.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bytes,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    entry.version = px.version;
    entry.width = px.width;
    entry.height = px.height;
    return entry;
  }

  // ------------------------------------------------------------------ scene furniture

  private buildLines() {
    const gl = this.gl!;
    const verts: number[] = [];
    // Ground grid on the 1/16 lattice at y = 0, spanning the block with one cell of margin.
    for (let i = -4; i <= 20; i++) {
      verts.push(i, 0, -4, i, 0, 20);
      verts.push(-4, 0, i, 20, 0, i);
    }
    const grid = verts.length / 3;
    // Block bounds: the 12 edges of the 16³ cube.
    const c = [0, 16];
    for (const y of c) for (const z of c) verts.push(0, y, z, 16, y, z);
    for (const x of c) for (const z of c) verts.push(x, 0, z, x, 16, z);
    for (const x of c) for (const y of c) verts.push(x, y, 0, x, y, 16);
    const bounds = verts.length / 3 - grid;
    // Axis triad at the origin.
    verts.push(0, 0, 0, 6, 0, 0);
    verts.push(0, 0, 0, 0, 6, 0);
    verts.push(0, 0, 0, 0, 0, 6);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.lineVAO = vao;
    this.lineCounts = { grid, bounds, axes: [2, 2, 2] };
  }

  // ------------------------------------------------------------------ draw

  private draw() {
    const gl = this.gl!;
    const raw = this.getScene();
    const scene = this.sceneFilter ? this.sceneFilter(raw) : raw;
    const [r, g, b] = hexToRGB(scene.surround);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    if (scene.transparent) gl.clearColor(0, 0, 0, 0);
    else gl.clearColor(r, g, b, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const model = scene.model;
    if (!model) return;

    if (this.contentDirty || this.meshFor !== model.id) {
      this.rebuildMesh(model);
      this.contentDirty = false;
    }

    const aspect = this.cssW / Math.max(1, this.cssH);
    const vp = multiply(projMatrix(scene.camera, aspect), viewMatrix(scene.camera));
    // Furniture and gizmos use the view-projection; the mesh may carry a display transform.
    const mvp = scene.modelMatrix ? multiply(vp, scene.modelMatrix) : vp;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // Furniture first (no cull): grid, block bounds, axes.
    if (scene.grid) {
      gl.useProgram(this.lineProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, 'uMVP'), false, vp);
      gl.bindVertexArray(this.lineVAO);
      const color = gl.getUniformLocation(this.lineProgram, 'uColor');
      const { grid, bounds } = this.lineCounts;
      gl.uniform4f(color, 0.5, 0.5, 0.5, 0.25);
      gl.drawArrays(gl.LINES, 0, grid);
      gl.uniform4f(color, 0.55, 0.6, 0.65, 0.8);
      gl.drawArrays(gl.LINES, grid, bounds);
      gl.uniform4f(color, 0.86, 0.3, 0.3, 1);
      gl.drawArrays(gl.LINES, grid + bounds, 2);
      gl.uniform4f(color, 0.35, 0.75, 0.35, 1);
      gl.drawArrays(gl.LINES, grid + bounds + 2, 2);
      gl.uniform4f(color, 0.35, 0.55, 0.9, 1);
      gl.drawArrays(gl.LINES, grid + bounds + 4, 2);
      gl.bindVertexArray(null);
    }

    if (!this.meshVAO || !this.mesh) return;
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CW); // see the header comment

    gl.useProgram(this.meshProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.meshProgram, 'uMVP'), false, mvp);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, 'uHoverKey'), scene.hoverKey);
    gl.uniform1f(gl.getUniformLocation(this.meshProgram, 'uSelectedEl'), scene.selectedElement);
    const [ar, ag, ab] = hexToRGB(scene.accent);
    gl.uniform3f(gl.getUniformLocation(this.meshProgram, 'uAccent'), ar, ag, ab);
    gl.uniform1i(gl.getUniformLocation(this.meshProgram, 'uFlat'), scene.flatShade ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.meshProgram, 'uTex'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.meshVAO);

    for (const batch of this.mesh.batches) {
      const px = scene.textures.get(batch.textureVar);
      if (px) this.syncTexture(batch.textureVar, px);
      const entry = px ? this.textures.get(batch.textureVar) : null;
      gl.bindTexture(gl.TEXTURE_2D, entry?.tex ?? this.fallback);
      gl.drawElements(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, batch.start * 4);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.CULL_FACE);

    // Translate gizmo: three axis segments through the depth buffer (always visible).
    if (scene.gizmo && !scene.modelMatrix) {
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.lineProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, 'uMVP'), false, vp);
      const g = scene.gizmo;
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const L = GIZMO_LENGTH;
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          g.x,
          g.y,
          g.z,
          g.x + L,
          g.y,
          g.z,
          g.x,
          g.y,
          g.z,
          g.x,
          g.y + L,
          g.z,
          g.x,
          g.y,
          g.z,
          g.x,
          g.y,
          g.z + L,
        ]),
        gl.STREAM_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const color = gl.getUniformLocation(this.lineProgram, 'uColor');
      gl.lineWidth(1);
      gl.uniform4f(color, 0.92, 0.26, 0.26, 1);
      gl.drawArrays(gl.LINES, 0, 2);
      gl.uniform4f(color, 0.3, 0.8, 0.36, 1);
      gl.drawArrays(gl.LINES, 2, 2);
      gl.uniform4f(color, 0.3, 0.55, 0.95, 1);
      gl.drawArrays(gl.LINES, 4, 2);
      gl.deleteBuffer(buf);
      gl.enable(gl.DEPTH_TEST);
    }

    // Inference plane (docs/11 §10.1 item 2): the aligned coordinate as an accent-coloured
    // outline square over everything, so "why did it stick here" is always answered visually.
    if (scene.snapLine) {
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.lineProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, 'uMVP'), false, vp);
      const { axis, value: v } = scene.snapLine;
      const lo = -4;
      const hi = 20;
      // Rectangle outline in the two perpendicular axes at `axis = v`.
      const pt = (a: number, b: number): [number, number, number] =>
        axis === 'x' ? [v, a, b] : axis === 'y' ? [a, v, b] : [a, b, v];
      const corners = [pt(lo, lo), pt(hi, lo), pt(hi, hi), pt(lo, hi)];
      const verts: number[] = [];
      for (let i = 0; i < 4; i++) verts.push(...corners[i], ...corners[(i + 1) % 4]);
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const [sr, sg, sb] = hexToRGB(scene.accent);
      gl.uniform4f(gl.getUniformLocation(this.lineProgram, 'uColor'), sr, sg, sb, 0.9);
      gl.drawArrays(gl.LINES, 0, 8);
      gl.deleteBuffer(buf);
      gl.enable(gl.DEPTH_TEST);
    }
  }
}

/** Model-space length of the gizmo axes — shared with the hit test in ModelWorkspace. */
export const GIZMO_LENGTH = 7;
