/* Real Terms — mapa 3D do mercado (#/mapa). Módulo ES carregado sob demanda por app.js.
 * Cada empresa é um ponto: três indicadores escolhíveis nos eixos, tamanho = valor de mercado,
 * cor = nível de previsibilidade. Arrastar gira, roda/pinça aproxima, passar o mouse mostra a
 * empresa, clicar (ou tocar duas vezes) abre a página dela. */
import * as THREE from "./vendor/three/three.module.min.js";

THREE.ColorManagement.enabled = false;  // cores do CSS usadas como estão

let atual = null;  // cena em execução; parar() a desmonta ao trocar de rota

export function parar() {
  if (!atual) return;
  atual.parar();
  atual = null;
}
window.RealTermsMapa = { parar: parar };

const LIQUIDEZ_MIN = 1e6;

function metricas(X) {
  const L = X.L;
  return [
    { id: "score", rot: L("Previsibilidade", "Predictability"), min: 0, max: 100, val: (e) => (X.score(e) || {}).total, fmt: (v) => X.nf(0).format(v) },
    { id: "dy", rot: L("Dividend yield 12m", "Dividend yield TTM"), min: 0, max: 0.15, val: (e, i) => i.dy, fmt: (v) => X.pct(v, 0) },
    { id: "pl", rot: L("P/L", "P/E"), min: 0, max: 40, val: (e, i) => (i.pl > 0 ? i.pl : null), fmt: (v) => X.nf(0).format(v) + "x" },
    { id: "pvp", rot: L("P/VP", "P/B"), min: 0, max: 6, val: (e, i) => (i.pvp > 0 ? i.pvp : null), fmt: (v) => X.nf(1).format(v) + "x" },
    { id: "roe", rot: L("ROE 12m", "ROE TTM"), min: -0.1, max: 0.4, val: (e, i) => (i.d12 ? i.roe12 : i.roe), fmt: (v) => X.pct(v, 0) },
    { id: "mliq", rot: L("Margem líquida 12m", "Net margin TTM"), min: -0.2, max: 0.4, val: (e, i) => (i.d12 ? i.mLiq12 : i.mLiq), fmt: (v) => X.pct(v, 0) },
    { id: "divida", rot: L("Dív. líq./EBITDA", "Net debt/EBITDA"), min: -1, max: 5, val: (e, i) => (i.d12 ? i.dlEbitda12 : i.dlEbitda), fmt: (v) => X.nf(1).format(v) + "x" },
    { id: "cagr", rot: L("Crescimento da receita 5a", "Revenue growth 5y"), min: -0.1, max: 0.3, val: (e, i) => i.cagrRec, fmt: (v) => X.pct(v, 0) },
  ];
}

function cssVar(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || "#888";
}
function temaEscuro() {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

function rotulo(texto, cor, tamanho = 30) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const fonte = `600 ${tamanho}px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.font = fonte;
  const w = Math.ceil(ctx.measureText(texto).width) + 16;
  c.width = w; c.height = tamanho + 18;
  ctx.font = fonte;
  ctx.fillStyle = cor;
  ctx.textBaseline = "middle";
  ctx.fillText(texto, 8, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const k = 0.105;
  sp.scale.set(c.width * k, c.height * k, 1);
  return sp;
}

export function render(app, X) {
  parar();
  const L = X.L, esc = X.esc;
  const M = metricas(X);
  const porId = Object.fromEntries(M.map((m) => [m.id, m]));
  const cfg = { x: "score", y: "dy", z: "pl", liquidas: true, setor: "", destaque: "" };

  const base = X.EMPRESAS.filter((e) => Object.keys(e.cotacao).length).map((e) => ({ e, i: X.indicadores(e) }));
  const setores = [...new Set(base.map((b) => X.setor(b.e)))].sort((a, b) => a.localeCompare(b, X.locale()));
  const opcoes = (sel) => M.map((m) => `<option value="${m.id}"${m.id === sel ? " selected" : ""}>${esc(m.rot)}</option>`).join("");

  document.title = X.t("nav_mapa") + " · Real Terms";
  app.innerHTML =
    `<section class="mapa-cab">
      <span class="olho"><span class="capitulo">3D</span>${esc(L("Mapa do mercado", "Market map"))}</span>
      <h1>${esc(L("Todas as ações num só espaço", "Every stock in one space"))}</h1>
      <p class="mudo">${esc(L(
        "Cada ponto é uma empresa negociada na B3. Escolha o que vai em cada eixo; o tamanho é o valor de mercado e a cor, a previsibilidade. Arraste para girar, use a roda ou dois dedos para aproximar e clique num ponto para abrir a empresa.",
        "Each dot is a company traded on B3. Choose what goes on each axis; size is market cap and colour is predictability. Drag to rotate, scroll or pinch to zoom, and click a dot to open the company."))}</p>
    </section>
    <div class="mapa-controles">
      <label><span>${esc(L("Eixo X", "X axis"))}</span><select data-eixo="x">${opcoes(cfg.x)}</select></label>
      <label><span>${esc(L("Eixo Y (altura)", "Y axis (height)"))}</span><select data-eixo="y">${opcoes(cfg.y)}</select></label>
      <label><span>${esc(L("Eixo Z (profundidade)", "Z axis (depth)"))}</span><select data-eixo="z">${opcoes(cfg.z)}</select></label>
      <label><span>${esc(L("Setor", "Sector"))}</span><select id="m-setor"><option value="">${esc(X.t("todos_setores"))}</option>${setores.map((s) => `<option>${esc(s)}</option>`).join("")}</select></label>
      <label><span>${esc(L("Destacar", "Highlight"))}</span><input id="m-busca" type="search" placeholder="PETR4" autocomplete="off" spellcheck="false"></label>
      <label class="check"><input type="checkbox" id="m-liq" checked> ${esc(L("Só líquidas (≥ R$ 1 mi/dia)", "Liquid only (≥ R$ 1M/day)"))}</label>
      <div class="mapa-presets">
        <button data-preset="score,dy,pl">${esc(L("Renda", "Income"))}</button>
        <button data-preset="score,roe,pvp">${esc(L("Qualidade × preço", "Quality vs. price"))}</button>
        <button data-preset="cagr,mliq,divida">${esc(L("Crescimento × risco", "Growth vs. risk"))}</button>
      </div>
    </div>
    <div class="mapa-palco">
      <canvas id="m-canvas" aria-label="${esc(L("Mapa 3D das empresas", "3D map of companies"))}" role="img"></canvas>
      <div class="mapa-legenda">
        <span><i style="--c:var(--pos)"></i>${esc(L("Previsibilidade alta", "High predictability"))}</span>
        <span><i style="--c:var(--warn)"></i>${esc(L("Média", "Medium"))}</span>
        <span><i style="--c:var(--neg)"></i>${esc(L("Baixa", "Low"))}</span>
        <span><i style="--c:var(--muted)"></i>${esc(L("Sem histórico", "No history"))}</span>
      </div>
      <p class="mapa-conta mudo" id="m-conta"></p>
      <p class="mapa-dica-toque">${esc(L("Toque num ponto para ver; toque de novo para abrir.", "Tap a dot to preview; tap again to open."))}</p>
    </div>
    <p class="aviso">${esc(L(
      "Valores fora da faixa de cada eixo ficam presos na borda do cubo (ex.: P/L acima de 40x). Empresas sem o dado de algum eixo não aparecem.",
      "Values outside each axis range are pinned to the edge of the cube (e.g. P/E above 40x). Companies missing any axis value are left out."))}</p>`;

  const canvas = app.querySelector("#m-canvas");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    app.querySelector(".mapa-palco").innerHTML = `<div class="cartao vazio">${esc(X.t("mapa_erro"))} <a href="#/acoes">${esc(X.t("nav_acoes"))}</a>.</div>`;
    return;
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 3000);
  const grupo = new THREE.Group();
  cena.add(grupo);
  const R = 50;  // meio lado do cubo
  const vista = { yaw: -0.62, pitch: 0.30, dist: 300, zoomManual: false, girando: !matchMedia("(prefers-reduced-motion: reduce)").matches };

  // ---------------------------------------------------------------- pontos
  const material = new THREE.ShaderMaterial({
    uniforms: { escala: { value: 170 }, escuro: { value: 1 } },
    vertexShader: `
      attribute float tamanho; attribute vec3 cor; varying vec3 vCor;
      uniform float escala;
      void main() {
        vCor = cor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = tamanho * escala / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vCor; uniform float escuro;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float nucleo = smoothstep(0.30, 0.0, d);
        float halo = pow(1.0 - d * 2.0, 1.6);
        vec3 corEscuro = vCor * (0.30 + 0.95 * nucleo) + vec3(0.18) * nucleo * nucleo;
        float aEscuro = clamp(halo * 0.9 + nucleo, 0.0, 1.0);
        float aClaro = smoothstep(0.30, 0.24, d) * 0.9;  // tema claro: disco sólido do tamanho do núcleo
        gl_FragColor = vec4(mix(vCor, corEscuro, escuro), mix(aClaro, aEscuro, escuro));
      }`,
    transparent: true,
    depthWrite: false,
  });
  const geo = new THREE.BufferGeometry();
  const pontos = new THREE.Points(geo, material);
  grupo.add(pontos);
  let visiveis = [];  // [{e, i, x, y, z, raw}]
  let tamanhos = null;

  // ---------------------------------------------------------------- caixa e eixos
  const molduraGrupo = new THREE.Group();
  grupo.add(molduraGrupo);

  function limpar(g) {
    while (g.children.length) {
      const o = g.children.pop();
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    }
  }

  function moldura() {
    limpar(molduraGrupo);
    const corLinha = cssVar("--muted"), corTexto = cssVar("--muted"), corEixo = cssVar("--text");
    const caixa = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * R, 2 * R, 2 * R)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(corLinha), transparent: true, opacity: 0.55 }));
    molduraGrupo.add(caixa);
    // grade no chão
    const linhas = [];
    for (let k = -R; k <= R; k += R / 2) {
      linhas.push(-R, -R, k, R, -R, k, k, -R, -R, k, -R, R);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(linhas, 3));
    molduraGrupo.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(corLinha), transparent: true, opacity: 0.22 })));

    const ex = porId[cfg.x], ey = porId[cfg.y], ez = porId[cfg.z];
    const pos = (sp, x, y, z) => { sp.position.set(x, y, z); molduraGrupo.add(sp); };
    // nomes dos eixos
    pos(rotulo(ex.rot + " →", corEixo, 34), 0, -R - 9, R + 10);
    pos(rotulo(ey.rot + " ↑", corEixo, 34), -R - 12, R + 9, R);
    pos(rotulo(ez.rot + " →", corEixo, 34), R + 14, -R - 9, 0);
    // marcas: mínimo, meio e máximo
    [0, 0.5, 1].forEach((f) => {
      const v = (m) => m.min + (m.max - m.min) * f;
      const c = -R + 2 * R * f;
      pos(rotulo(ex.fmt(v(ex)), corTexto, 26), c, -R - 4, R + 4);
      pos(rotulo(ey.fmt(v(ey)), corTexto, 26), -R - 8, c, R + 2);
      pos(rotulo(ez.fmt(v(ez)), corTexto, 26), R + 6, -R - 4, c);
    });
  }

  function corNivel(total) {
    if (total == null) return cssVar("--muted");
    if (total >= 75) return cssVar("--pos");
    if (total >= 50) return cssVar("--warn");
    return cssVar("--neg");
  }

  function montar() {
    const ex = porId[cfg.x], ey = porId[cfg.y], ez = porId[cfg.z];
    const norm = (m, v) => {
      const f = (Math.max(m.min, Math.min(m.max, v)) - m.min) / (m.max - m.min);
      return -R + 2 * R * f;
    };
    let faltam = 0;
    visiveis = [];
    base.forEach(({ e, i }) => {
      if (cfg.liquidas && !(e.liquidez >= LIQUIDEZ_MIN)) return;
      if (cfg.setor && X.setor(e) !== cfg.setor) return;
      const vx = ex.val(e, i), vy = ey.val(e, i), vz = ez.val(e, i);
      if ([vx, vy, vz].some((v) => v == null || !isFinite(v))) { faltam++; return; }
      visiveis.push({ e, i, x: norm(ex, vx), y: norm(ey, vy), z: norm(ez, vz), raw: [vx, vy, vz] });
    });
    const n = visiveis.length;
    const posicoes = new Float32Array(n * 3), cores = new Float32Array(n * 3);
    tamanhos = new Float32Array(n);
    const vms = visiveis.map((p) => Math.log10(Math.max(p.e.valor_mercado || 1e4, 1e4)));
    const vmin = Math.min(...vms, 5), vmax = Math.max(...vms, 6);
    const col = new THREE.Color();
    visiveis.forEach((p, k) => {
      posicoes.set([p.x, p.y, p.z], k * 3);
      col.set(corNivel((X.score(p.e) || {}).total));
      cores.set([col.r, col.g, col.b], k * 3);
      tamanhos[k] = 9 + 24 * (vms[k] - vmin) / (vmax - vmin || 1);
      p.base = tamanhos[k];
    });
    geo.setAttribute("position", new THREE.BufferAttribute(posicoes, 3));
    geo.setAttribute("cor", new THREE.BufferAttribute(cores, 3));
    geo.setAttribute("tamanho", new THREE.BufferAttribute(tamanhos, 1));
    geo.computeBoundingSphere();
    moldura();
    destacar();
    app.querySelector("#m-conta").textContent = L(
      n + " empresas no mapa" + (faltam ? " · " + faltam + " sem dado em algum eixo" : ""),
      n + " companies on the map" + (faltam ? " · " + faltam + " missing a value on some axis" : ""));
  }

  // ---------------------------------------------------------------- destaque e dica
  const marca = new THREE.Group();
  grupo.add(marca);
  let sobre = -1, tocado = -1;

  function destacar() {
    limpar(marca);
    if (!tamanhos) return;
    const alvo = cfg.destaque;
    visiveis.forEach((p, k) => {
      const realce = (alvo && p.e.tickers.some((t) => t.startsWith(alvo))) || k === sobre;
      tamanhos[k] = realce ? p.base * 1.9 + 6 : p.base;
      if (alvo && realce) {
        const sp = rotulo(p.e.ticker, cssVar("--text"), 30);
        sp.position.set(p.x, p.y + 6, p.z);
        marca.add(sp);
      }
    });
    geo.attributes.tamanho.needsUpdate = true;
  }

  const dica = document.getElementById("dica");
  function mostrarDica(k, cx, cy) {
    if (k < 0) { dica.hidden = true; return; }
    const p = visiveis[k], s = X.score(p.e);
    const linhas = [porId[cfg.x], porId[cfg.y], porId[cfg.z]].map((m, j) => m.id === "score" ? "" :
      `<div><span class="mudo">${esc(m.rot)}</span><span class="num">${m.fmt(p.raw[j])}</span></div>`).join("");
    dica.innerHTML = `<b>${p.e.ticker} · ${esc(X.nomeCurto(p.e.nome))}</b>` +
      `<div><span class="mudo">${esc(X.t("col_vm"))}</span><span class="num">${X.dinheiro(X.estado.moeda === "brl" ? p.e.valor_mercado : p.e.valor_mercado / X.D.ptax_atual.valor)}</span></div>` +
      (s ? `<div><span class="mudo">${esc(X.t("col_score"))}</span><span class="num">${s.total}</span></div>` : "") + linhas;
    dica.hidden = false;
    let dx = cx + 14;
    if (dx + dica.offsetWidth > window.innerWidth - 8) dx = cx - dica.offsetWidth - 14;
    dica.style.left = dx + "px";
    dica.style.top = Math.max(8, cy - dica.offsetHeight - 12) + "px";
  }

  const v3 = new THREE.Vector3();
  function maisProximo(cx, cy) {
    const r = canvas.getBoundingClientRect();
    let melhor = -1, dmin = Infinity;
    visiveis.forEach((p, k) => {
      v3.set(p.x, p.y, p.z).applyMatrix4(grupo.matrixWorld).project(camera);
      const sx = r.left + (v3.x + 1) / 2 * r.width, sy = r.top + (1 - v3.y) / 2 * r.height;
      const d = Math.hypot(sx - cx, sy - cy);
      const raio = Math.max(10, tamanhos[k] * material.uniforms.escala.value / vista.dist / 2 / (renderer.getPixelRatio() || 1) + 4);
      if (d < raio && d < dmin) { dmin = d; melhor = k; }
    });
    return melhor;
  }

  // ---------------------------------------------------------------- interação
  const ponteiros = new Map();
  let arrasto = null, pinca = null;

  function aoDescer(ev) {
    canvas.setPointerCapture(ev.pointerId);
    ponteiros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    vista.girando = false;
    if (ponteiros.size === 1) arrasto = { x: ev.clientX, y: ev.clientY, moveu: 0 };
    if (ponteiros.size === 2) {
      const [a, b] = [...ponteiros.values()];
      pinca = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: vista.dist };
      arrasto = null;
    }
  }
  function aoMover(ev) {
    if (ponteiros.has(ev.pointerId)) ponteiros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinca && ponteiros.size === 2) {
      const [a, b] = [...ponteiros.values()];
      vista.zoomManual = true;
      vista.dist = Math.min(520, Math.max(130, pinca.dist * pinca.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y))));
      return;
    }
    if (arrasto) {
      const dx = ev.clientX - arrasto.x, dy = ev.clientY - arrasto.y;
      arrasto.moveu += Math.abs(dx) + Math.abs(dy);
      vista.yaw += dx * 0.008;
      vista.pitch = Math.max(-1.2, Math.min(1.2, vista.pitch + dy * 0.006));
      arrasto.x = ev.clientX; arrasto.y = ev.clientY;
      if (arrasto.moveu > 6) { dica.hidden = true; return; }
    }
    if (ev.pointerType === "mouse") {
      const k = maisProximo(ev.clientX, ev.clientY);
      if (k !== sobre) { sobre = k; destacar(); }
      canvas.style.cursor = k >= 0 ? "pointer" : arrasto ? "grabbing" : "grab";
      mostrarDica(k, ev.clientX, ev.clientY);
    }
  }
  function aoSubir(ev) {
    const foiToque = arrasto && arrasto.moveu <= 6;
    ponteiros.delete(ev.pointerId);
    if (ponteiros.size < 2) pinca = null;
    if (foiToque) {
      const k = maisProximo(ev.clientX, ev.clientY);
      if (k >= 0 && (ev.pointerType === "mouse" || k === tocado)) {
        location.hash = "#/" + visiveis[k].e.ticker;
        return;
      }
      tocado = k; sobre = k; destacar();
      mostrarDica(k, ev.clientX, ev.clientY);
    }
    arrasto = null;
  }
  function aoSair() { if (!arrasto) { sobre = -1; destacar(); dica.hidden = true; } }
  function aoRodar(ev) {
    ev.preventDefault();
    vista.girando = false;
    vista.zoomManual = true;
    vista.dist = Math.min(520, Math.max(130, vista.dist * (1 + Math.sign(ev.deltaY) * 0.08)));
  }

  canvas.addEventListener("pointerenter", () => { vista.girando = false; });  // ponto não foge do mouse
  canvas.addEventListener("pointerdown", aoDescer);
  canvas.addEventListener("pointermove", aoMover);
  canvas.addEventListener("pointerup", aoSubir);
  canvas.addEventListener("pointercancel", aoSubir);
  canvas.addEventListener("pointerleave", aoSair);
  canvas.addEventListener("wheel", aoRodar, { passive: false });

  // controles
  app.querySelectorAll("[data-eixo]").forEach((s) => s.addEventListener("change", () => { cfg[s.dataset.eixo] = s.value; montar(); }));
  app.querySelector("#m-setor").addEventListener("change", (ev) => { cfg.setor = ev.target.value; montar(); });
  app.querySelector("#m-liq").addEventListener("change", (ev) => { cfg.liquidas = ev.target.checked; montar(); });
  app.querySelector("#m-busca").addEventListener("input", (ev) => { cfg.destaque = ev.target.value.trim().toUpperCase(); destacar(); });
  app.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    [cfg.x, cfg.y, cfg.z] = b.dataset.preset.split(",");
    app.querySelectorAll("[data-eixo]").forEach((s) => { s.value = cfg[s.dataset.eixo]; });
    montar();
  }));

  // ---------------------------------------------------------------- tema, tamanho e laço
  function aplicarTema() {
    const escuro = temaEscuro();
    material.uniforms.escuro.value = escuro ? 1 : 0;
    material.blending = escuro ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.needsUpdate = true;
    montar();
  }
  const obsTema = new MutationObserver(aplicarTema);
  obsTema.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mqTema = matchMedia("(prefers-color-scheme: dark)");
  mqTema.addEventListener("change", aplicarTema);

  function redimensionar() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // tela estreita (celular em pé): afasta a câmera para o cubo caber na largura
    if (!vista.zoomManual) vista.dist = 300 * Math.max(1, 1.05 / camera.aspect);
    material.uniforms.escala.value = 170 * renderer.getPixelRatio() * Math.min(1.25, Math.max(0.7, h / 560));
  }
  const obsTamanho = new ResizeObserver(redimensionar);
  obsTamanho.observe(canvas);

  let quadro = 0;
  function laco() {
    if (vista.girando) vista.yaw += 0.0016;
    grupo.rotation.set(vista.pitch, vista.yaw, 0, "XYZ");
    camera.position.set(0, 0, vista.dist);
    camera.lookAt(0, 0, 0);
    renderer.render(cena, camera);
    quadro = requestAnimationFrame(laco);
  }

  aplicarTema();
  redimensionar();
  laco();

  // inspeção (depuração e testes): estado da câmera e quantos pontos estão no mapa
  window.RealTermsMapa.estado = () => ({ dist: vista.dist, zoomManual: vista.zoomManual, aspect: camera.aspect,
    escala: material.uniforms.escala.value, pontos: visiveis.length, canvas: [canvas.clientWidth, canvas.clientHeight] });

  atual = {
    parar() {
      cancelAnimationFrame(quadro);
      obsTema.disconnect();
      obsTamanho.disconnect();
      mqTema.removeEventListener("change", aplicarTema);
      dica.hidden = true;
      limpar(marca); limpar(molduraGrupo);
      geo.dispose(); material.dispose();
      renderer.dispose();
    },
  };
}
