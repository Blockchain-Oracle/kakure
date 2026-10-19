import { RENDER, SOFTWARE_RENDERER, SRGB } from "./constants";
import { VERT } from "./shaders";

/** WebGL plumbing for the black hole: the context, programs, and the half-float render targets. */
export type Gl = WebGL2RenderingContext | WebGLRenderingContext;
export type Prog = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
export type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };

/** How targets are stored: half floats keep the gas bright enough to bloom; without them, Reinhard-packed bytes. */
export interface Format {
  hdr: boolean;
  texType: number;
  internal: number;
  filter: number;
  pack: number;
}

const BYTE = 0xff;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;
const HEX = 16;

export function hexToLinear(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), HEX);
  const channel = (v: number) => (v <= SRGB.knee ? v / SRGB.slope : ((v + SRGB.offset) / SRGB.scale) ** SRGB.gamma);
  return [
    channel(((n >> RED_SHIFT) & BYTE) / SRGB.max),
    channel(((n >> GREEN_SHIFT) & BYTE) / SRGB.max),
    channel((n & BYTE) / SRGB.max),
  ];
}

export function openContext(canvas: HTMLCanvasElement): { ctx: Gl; software: boolean; format: Format } | null {
  const attributes: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  };
  const ctx = (canvas.getContext("webgl2", attributes) ?? canvas.getContext("webgl", attributes)) as Gl | null;
  if (!ctx) return null;
  const debug = ctx.getExtension("WEBGL_debug_renderer_info");
  const renderer = debug ? String(ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? "") : "";
  return { ctx, software: SOFTWARE_RENDERER.test(renderer), format: formatFor(ctx) };
}

function formatFor(ctx: Gl): Format {
  const isGl2 = typeof WebGL2RenderingContext !== "undefined" && ctx instanceof WebGL2RenderingContext;
  if (isGl2) {
    const g2 = ctx as WebGL2RenderingContext;
    if (g2.getExtension("EXT_color_buffer_half_float") || g2.getExtension("EXT_color_buffer_float")) {
      return { hdr: true, texType: g2.HALF_FLOAT, internal: g2.RGBA16F, filter: g2.LINEAR, pack: 1 };
    }
  } else {
    const half = ctx.getExtension("OES_texture_half_float");
    if (half && ctx.getExtension("EXT_color_buffer_half_float")) {
      const linear = ctx.getExtension("OES_texture_half_float_linear");
      return {
        hdr: true,
        texType: half.HALF_FLOAT_OES,
        internal: ctx.RGBA,
        filter: linear ? ctx.LINEAR : ctx.NEAREST,
        pack: 1,
      };
    }
  }
  return { hdr: false, texType: ctx.UNSIGNED_BYTE, internal: ctx.RGBA, filter: ctx.LINEAR, pack: RENDER.ldrPack };
}

function compile(ctx: Gl, type: number, source: string): WebGLShader | null {
  const shader = ctx.createShader(type);
  if (!shader) return null;
  ctx.shaderSource(shader, source);
  ctx.compileShader(shader);
  if (ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) return shader;
  ctx.deleteShader(shader);
  return null;
}

export function link(ctx: Gl, fragment: string): Prog | null {
  const vs = compile(ctx, ctx.VERTEX_SHADER, VERT);
  const fs = compile(ctx, ctx.FRAGMENT_SHADER, fragment);
  const program = ctx.createProgram();
  if (!vs || !fs || !program) return null;
  ctx.attachShader(program, vs);
  ctx.attachShader(program, fs);
  ctx.bindAttribLocation(program, 0, "aPos");
  ctx.linkProgram(program);
  ctx.deleteShader(vs);
  ctx.deleteShader(fs);
  if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) return null;
  const u: Prog["u"] = {};
  const count = ctx.getProgramParameter(program, ctx.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = ctx.getActiveUniform(program, i);
    if (info) u[info.name] = ctx.getUniformLocation(program, info.name);
  }
  return { program, u };
}

export function makeTarget(ctx: Gl, format: Format, w: number, h: number): Target | null {
  const tex = ctx.createTexture();
  const fb = ctx.createFramebuffer();
  if (!tex || !fb) return null;
  ctx.bindTexture(ctx.TEXTURE_2D, tex);
  ctx.texImage2D(ctx.TEXTURE_2D, 0, format.internal, w, h, 0, ctx.RGBA, format.texType, null);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, format.filter);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, format.filter);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
  ctx.bindFramebuffer(ctx.FRAMEBUFFER, fb);
  ctx.framebufferTexture2D(ctx.FRAMEBUFFER, ctx.COLOR_ATTACHMENT0, ctx.TEXTURE_2D, tex, 0);
  const ok = ctx.checkFramebufferStatus(ctx.FRAMEBUFFER) === ctx.FRAMEBUFFER_COMPLETE;
  ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
  if (ok) return { fb, tex, w, h };
  ctx.deleteTexture(tex);
  ctx.deleteFramebuffer(fb);
  return null;
}

/** One triangle big enough to cover the frame: cheaper than two, and no seam down the diagonal. */
const COVER = 3;
const XY = 2;

export function fullFrameTriangle(ctx: Gl): WebGLBuffer | null {
  const vbo = ctx.createBuffer();
  ctx.bindBuffer(ctx.ARRAY_BUFFER, vbo);
  ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, COVER, -1, -1, COVER]), ctx.STATIC_DRAW);
  ctx.enableVertexAttribArray(0);
  ctx.vertexAttribPointer(0, XY, ctx.FLOAT, false, 0, 0);
  ctx.disable(ctx.DEPTH_TEST);
  ctx.disable(ctx.BLEND);
  return vbo;
}
