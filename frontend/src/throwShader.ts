// One small reusable GPU surface serves every impact; no full-screen shader loop.
const vertex = `attribute vec2 p;varying vec2 uv;void main(){uv=p;gl_Position=vec4(p,0.,1.);}`
const fragment = `precision mediump float;
varying vec2 uv;uniform float age;uniform float kind;uniform float seed;
float hash(float n){return fract(sin(n*127.1+seed*7.3)*43758.5453);}
float glow(float d,float width){return exp(-abs(d)/width);}
void main(){
 vec2 p=uv*1.2;float r=length(p);float a=atan(p.y,p.x);float t=max(.001,age);
 vec3 hot=kind<.5?vec3(1.,.12,.035):kind<1.5?vec3(.35,.85,1.):vec3(1.,.66,.19);
 vec3 dark=kind<.5?vec3(.52,.015,.04):kind<1.5?vec3(.38,.3,1.):vec3(.32,.095,.025);
 float wave=sin(a*9.+sin(a*5.+seed)*2.+r*18.-t*9.);
 float bloom=exp(-r*r/(.022+t*.11))*exp(-t*3.8);
 float ring=glow(r-t*.96,.016+t*.014)*exp(-t*2.1);
 float ring2=glow(r-t*.64,.008)*exp(-t*2.8);
 float rays=pow(max(0.,cos(a*(kind> .5&&kind<1.5?12.:7.)+wave*.3)),20.)*exp(-r*3.)*exp(-t*3.4);
 float liquid=0.;float sparks=0.;
 for(int i=0;i<22;i++){
  float f=float(i);float ang=hash(f+1.)*6.28318;
  vec2 dir=vec2(cos(ang),sin(ang));
  vec2 center=dir*(.08+hash(f+3.)*.52)*min(1.,t*3.8);
  center.y-=t*t*(kind>1.5?.22:.12);
  float size=(.025+hash(f+8.)*.055)*(1.-smoothstep(.5,1.55,t));
  float d=length(p-center);
  liquid+=(1.-smoothstep(0.,max(.001,size),d))*(.5+.5*hash(f+17.));
  vec2 spark=dir*t*(.65+hash(f+4.)*.7);float sd=length(p-spark);
  sparks+=exp(-sd*150.)*exp(-t*1.8);
 }
 float mist=exp(-r*r/(.025+t*.26))*(.5+.5*sin(a*6.+r*28.-t*6.))*exp(-t*2.8);
 float flare=(exp(-abs(p.x)*160.)+exp(-abs(p.y)*160.))*exp(-r*4.)*exp(-t*7.);
 float alpha=clamp(bloom*2.+ring+ring2+rays*.7+liquid*.85+sparks+mist*.25+flare,0.,1.)*(1.-smoothstep(1.05,1.6,t));
 vec3 color=mix(dark,hot,clamp(ring+rays+sparks+mist+bloom,0.,1.));
 color+=vec3(.9,.95,1.)*(bloom+sparks+flare)*.8;
 if(kind>.5&&kind<1.5){alpha=clamp((ring*1.2+ring2+rays+sparks+mist*.25+flare+bloom)*1.2,0.,1.)*(1.-smoothstep(.8,1.5,t));}
 gl_FragColor=vec4(color,alpha);
}`

export function createThrowShader() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false })
  if (!gl) return null
  const program = gl.createProgram()
  if (!program) return null
  const shaders: WebGLShader[] = []
  for (const [type, code] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)
    if (!shader) return null
    shaders.push(shader)
    gl.shaderSource(shader, code); gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program); return null }
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program); return null }
  gl.useProgram(program)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'p')
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const clock = gl.getUniformLocation(program, 'age'), theme = gl.getUniformLocation(program, 'kind'), random = gl.getUniformLocation(program, 'seed')
  gl.viewport(0, 0, canvas.width, canvas.height)
  return {
    draw(age: number, kind: number, seed: number) {
      if (gl.isContextLost()) return null
      gl.uniform1f(clock, age); gl.uniform1f(theme, kind); gl.uniform1f(random, seed)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      return canvas
    },
    dispose() {
      shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteBuffer(buffer); gl.deleteProgram(program)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
