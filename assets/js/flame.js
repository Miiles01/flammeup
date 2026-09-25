/* Flamme Up — scène de flamme WebGL (remplace la scène « DNA Ink » de Dantora).
   Un seul shader plein écran : flamme en fbm + braises montantes, qui se penche
   vers le curseur. Rendu en pause hors écran ; image fixe si mouvement réduit. */
(function () {
  const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

  const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLean;
uniform float uScale;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

vec3 ramp(float f){
  vec3 c = vec3(0.071, 0.059, 0.051);
  c = mix(c, vec3(0.42, 0.06, 0.03), smoothstep(0.02, 0.28, f));
  c = mix(c, vec3(0.86, 0.22, 0.09), smoothstep(0.25, 0.55, f));
  c = mix(c, vec3(1.00, 0.55, 0.18), smoothstep(0.52, 0.78, f));
  c = mix(c, vec3(1.00, 0.86, 0.52), smoothstep(0.78, 0.97, f));
  return c;
}

void main(){
  vec2 p = (gl_FragCoord.xy - vec2(0.5 * uRes.x, 0.0)) / uRes.y;
  p /= uScale;
  float t = uTime;
  float h = clamp(p.y, 0.0, 1.4);

  float n1 = fbm(vec2(p.x * 2.4, p.y * 1.8 - t * 1.35));
  float n2 = fbm(vec2(p.x * 5.2 + 3.1, p.y * 3.6 - t * 2.4));

  float x = p.x - uLean * h * h * 0.55 + (n1 - 0.5) * 0.55 * h;
  float width = mix(0.36, 0.0, pow(clamp(h / 1.05, 0.0, 1.0), 0.75));
  float body = smoothstep(width, width * 0.15, abs(x));
  body *= smoothstep(1.15, 0.15, h + (n2 - 0.5) * 0.55);
  body = clamp(body * (0.75 + n2 * 0.6), 0.0, 1.0);

  // Lueur diffuse autour de la base.
  float glow = exp(-abs(p.x) * 3.2) * exp(-h * 2.2) * 0.35;
  float f = clamp(body + glow * 0.6, 0.0, 1.0);
  vec3 col = ramp(f);
  col += vec3(0.55, 0.12, 0.04) * glow * 0.55;

  // Braises : particules qui montent en ondulant.
  for (int i = 0; i < 28; i++) {
    float fi = float(i);
    float seed = hash(vec2(fi, 7.13));
    float speed = 0.07 + seed * 0.12;
    float life = fract(t * speed + seed * 9.0);
    vec2 pos = vec2((hash(vec2(fi, 2.7)) - 0.5) * 0.9, life * 1.3 - 0.05);
    pos.x += sin(t * (0.8 + seed) + fi) * 0.05 * life + uLean * life * 0.25;
    float size = mix(0.0055, 0.0015, life) * (0.6 + seed);
    float d = length(p - pos);
    float spark = smoothstep(size, 0.0, d) * (1.0 - life) * 1.4;
    col += vec3(1.0, 0.55, 0.2) * spark;
  }

  // Vignette douce vers le charbon, pour fondre les bords du canvas.
  vec2 uv = gl_FragCoord.xy / uRes;
  float edge = smoothstep(0.0, 0.18, uv.x) * smoothstep(1.0, 0.82, uv.x) * smoothstep(1.0, 0.8, uv.y);
  col = mix(vec3(0.071, 0.059, 0.051), col, edge);

  gl_FragColor = vec4(col, 1.0);
}`;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function createFlame(canvas, opts) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) { canvas.style.background = 'radial-gradient(60% 60% at 50% 100%, #c3331d, #120f0d 70%)'; return null; }

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uLean = gl.getUniformLocation(prog, 'uLean');
    const uScale = gl.getUniformLocation(prog, 'uScale');

    // Résolution réduite : la flamme est floue par nature, ça ne se voit pas.
    const quality = opts.quality || 0.6;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * quality;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
    };

    let lean = 0, leanTarget = 0, visible = false, raf = 0, drawn = false;
    const start = performance.now();

    const frame = (now) => {
      raf = 0;
      resize();
      lean += (leanTarget - lean) * 0.04;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, reduced ? 12.0 : (now - start) / 1000);
      gl.uniform1f(uLean, lean);
      gl.uniform1f(uScale, opts.scale || 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!drawn) { drawn = true; opts.onFirstFrame && opts.onFirstFrame(); }
      if (visible && !reduced) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }).observe(canvas);
    window.addEventListener('resize', kick);
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      leanTarget = Math.max(-1, Math.min(1, ((e.clientX - (r.left + r.width / 2)) / (r.width / 2))));
    }, { passive: true });

    kick();
    return { kick };
  }

  window.FlameScene = { createFlame };
})();
