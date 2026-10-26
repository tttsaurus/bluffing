import type { SkinId } from './types'

const vertex = `attribute vec2 position; varying vec2 uv;
void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }`
const fragment = `precision mediump float;
varying vec2 uv; uniform float time; uniform float theme;
vec3 palette(float t) { return .52 + .48*cos(6.28318*(vec3(.0,.33,.67)+t)); }
void main() {
  vec2 p = (uv-.5)*vec2(1.,1.42);
  float r = length(p), a = atan(p.y,p.x), t=time;
  vec3 c;
  if(theme < .5) {
    float lattice = pow(abs(sin((p.x+p.y)*44.)*sin((p.x-p.y)*44.)), 10.);
    c = mix(vec3(.025,.12,.105),vec3(.78,.59,.27),lattice*.7);
  } else if(theme < 1.5) {
    float wave = sin(p.x*8.+t*.4+sin(p.y*6.-t*.5));
    float foil = sin((p.y+wave*.16)*24.+t);
    c = palette(wave*.15+p.y*.35+t*.025)*(.35+.65*pow(.5+.5*foil,3.));
    c += vec3(.1,.65,.58)*pow(max(0.,1.-abs(wave)*1.5),4.)*.5;
  } else if(theme < 2.5) {
    float spiral = sin(a*5.+r*24.-t*1.4+sin(a*3.+t)*.7);
    float rays = pow(.5+.5*spiral,5.);
    float core = .055/(r+.055);
    c = mix(vec3(.16,.015,.24), vec3(1.,.22,.055), rays);
    c += vec3(1.,.65,.16)*core*1.5;
    c *= .7+.3*sin(r*70.-t*2.);
  } else {
    float facets = sin(p.x*22.+t*.45)*cos(p.y*16.-t*.3);
    float interference = sin((p.x+p.y)*30.+facets*4.+t*.7);
    c = palette(facets*.2+interference*.13+t*.035);
    c *= .28+.72*pow(.5+.5*interference,2.);
    c += vec3(.65,.8,1.)*pow(.5+.5*sin(p.x*40.-p.y*22.+t),28.)*.4;
  }
  float vignette = smoothstep(.95,.15,r);
  float scan = .96+.04*sin(uv.y*380.);
  gl_FragColor = vec4(c*(.62+.38*vignette)*scan,1.);
}`

export function createCardArtRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false })
  if (!gl) return null
  const shaders: WebGLShader[] = []
  const program = gl.createProgram()
  if (!program) return null
  const dispose = () => {
    shaders.forEach(shader => gl.deleteShader(shader))
    gl.deleteProgram(program)
    gl.deleteBuffer(buffer)
  }
  let buffer: WebGLBuffer | null = null
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) return false
    shaders.push(shader)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return false
    gl.attachShader(program, shader)
    return true
  }
  if (!compile(gl.VERTEX_SHADER, vertex) || !compile(gl.FRAGMENT_SHADER, fragment)) {
    dispose()
    return null
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { dispose(); return null }
  buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW)
  gl.useProgram(program)
  const position = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const theme = gl.getUniformLocation(program, 'theme')
  const clock = gl.getUniformLocation(program, 'time')
  return {
    draw(skin: SkinId, seconds: number) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform1f(theme, ['CLASSIC', 'AURORA', 'SUPERNOVA', 'PRISM'].indexOf(skin))
      gl.uniform1f(clock, seconds)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    },
    isContextLost: () => gl.isContextLost(),
    dispose,
  }
}

// Flying cards reuse these tiny raster copies of the same shader artwork.
// Warm them while idle so a throw never compiles six separate WebGL programs.
const stillArt = new Map<SkinId, HTMLCanvasElement | null>()
export function warmCardArt(skins: SkinId[]) {
  const missing = [...new Set(skins)].filter(skin => !stillArt.has(skin))
  if (!missing.length) return
  const source = document.createElement('canvas')
  source.width = 252
  source.height = 356
  const renderer = createCardArtRenderer(source)
  for (const skin of missing) {
    const copy = document.createElement('canvas')
    copy.width = source.width
    copy.height = source.height
    const context = renderer && copy.getContext('2d')
    if (context && renderer) {
      renderer.draw(skin, 3)
      context.drawImage(source, 0, 0)
      stillArt.set(skin, copy)
    } else stillArt.set(skin, null)
  }
  renderer?.dispose()
  // The cached copies are 2D canvases; release the temporary GPU context.
  source.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext()
}

export function paintStillCardArt(canvas: HTMLCanvasElement, skin: SkinId) {
  warmCardArt([skin])
  const art = stillArt.get(skin)
  const context = art && canvas.getContext('2d')
  if (!context || !art) return
  canvas.width = art.width
  canvas.height = art.height
  context.drawImage(art, 0, 0)
  canvas.style.opacity = '1'
}
