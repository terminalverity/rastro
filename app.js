// Locus (antes Rastro): página del mapa. Lee los puntos de tu servidor (o un ejemplo) y muestra días, lugares y conexión.
(function () {
  "use strict";
  const A = window.Analisis;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const DIA = 86400;

  // ---------- Formato ----------
  const fHora = new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false });
  const fFecha = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long" });
  const fSemana = new Intl.DateTimeFormat("es-PE", { weekday: "long" });
  const fMes = new Intl.DateTimeFormat("es-PE", { month: "long" });
  const fCorta = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short" });
  const fNum = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });
  const fEntero = new Intl.NumberFormat("es-PE");
  const hora = (s) => fHora.format(new Date(s * 1000));
  function dur(seg) {
    seg = Math.max(0, Math.round(seg));
    if (seg < 60) return "<1 min";
    const m = Math.round(seg / 60);
    if (m < 60) return m + " min";
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  const dist = (m) => (m < 1000 ? Math.round(m / 10) * 10 + " m" : fNum.format(m / 1000) + " km");
  function hace(seg) {
    if (seg < 90) return "hace 1 min";
    if (seg < 3600) return `hace ${Math.round(seg / 60)} min`;
    if (seg < 36 * 3600) return `hace ${Math.round(seg / 3600)} h`;
    return `hace ${Math.round(seg / DIA)} días`;
  }
  const medianoche = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sumarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const seg = (d) => Math.round(d.getTime() / 1000);
  const iso = (s) => new Date(s * 1000).toISOString();

  const MODOS = {
    pie: { nombre: "A pie", corto: "A pie" },
    vehiculo: { nombre: "En vehículo", corto: "Vehículo" },
    bici: { nombre: "En bici", corto: "Bici" },
    desconocido: { nombre: "En movimiento", corto: "Otro" },
  };
  const color = (m) => `var(--${MODOS[m] ? m : "desconocido"})`;
  const sinMovimiento = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
  // Vibración corta (Android) para confirmar con el dedo lo que se toca. Solo pantallas táctiles y después de un toque real.
  const tactil = (() => { try { return matchMedia("(pointer: coarse)"); } catch (e) { return { matches: false }; } })();
  function toque(ms) {
    if (!tactil.matches || !navigator.vibrate) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try { navigator.vibrate(ms || 8); } catch (e) { /* sin vibración */ }
  }
  // Tras arrastrar algo, el «click» que el navegador manda al soltar no debe contar como toque.
  let sinClicksHasta = 0;
  const suprimirClicks = () => { sinClicksHasta = performance.now() + 350; };
  // Reinicia una animación de CSS aunque la clase ya estuviera puesta.
  function reanimar(el, clase) {
    if (!el) return;
    el.classList.remove(clase);
    void el.offsetWidth;
    el.classList.add(clase);
    el.addEventListener("animationend", () => el.classList.remove(clase), { once: true });
  }

  // Formato de las cifras del día (número grande, unidad chica).
  const FORMATOS = {
    d: (m) => (m < 1000 ? `${Math.round(m / 10) * 10}<i>m</i>` : `${fNum.format(m / 1000)}<i>km</i>`),
    t: (s) => { const min = Math.round(s / 60); return min < 60 ? `${min}<i>min</i>` : `${Math.floor(min / 60)}<i>h</i> ${min % 60}<i>min</i>`; },
    n: (n) => String(Math.round(n)),
  };
  function colores() {
    const cs = getComputedStyle(document.documentElement);
    const c = {};
    for (const k of ["ruta", "casing", "text", "accent", "estancia", "muted"]) c[k] = cs.getPropertyValue("--" + k).trim();
    return c;
  }

  // ---------- Almacenamiento local (puede fallar en modo privado) ----------
  const local = {
    leer(k) { try { return JSON.parse(localStorage.getItem("rastro." + k)); } catch (e) { return null; } },
    guardar(k, v) { try { localStorage.setItem("rastro." + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
    borrar(k) { try { localStorage.removeItem("rastro." + k); } catch (e) { /* sin almacenamiento */ } },
  };

  // ---------- Configuración ----------
  const PAGINA_PUBLICA_DEF = "https://terminalverity.github.io/rastro/";
  // 1) enlace «#conectar=…» (para abrir en otro dispositivo), 2) config.local.js (en la Mac), 3) lo guardado en este navegador.
  function leerConfig() {
    const h = location.hash.match(/conectar=([^&]+)/);
    if (h) {
      try {
        const txt = decodeURIComponent(escape(atob(h[1].replace(/-/g, "+").replace(/_/g, "/"))));
        const c = JSON.parse(txt);
        if (c.url && c.clave) local.guardar("config", { url: c.url, clave: c.clave });
      } catch (e) { /* enlace inválido */ }
      history.replaceState(null, "", location.pathname + location.search);
    }
    const c = window.RASTRO_CONFIG;
    if (c && c.url && c.clave) return Object.assign({ origen: "archivo" }, c);
    const g = local.leer("config");
    if (g && g.url && g.clave) return Object.assign({ origen: "navegador" }, g);
    return null;
  }

  // ---------- Fuentes de datos ----------
  function fuenteReal(cfg) {
    const base = cfg.url.replace(/\/+$/, "");
    async function pedir(ruta, opt) {
      opt = opt || {};
      const headers = { Authorization: "Bearer " + cfg.clave };
      if (opt.body) headers["Content-Type"] = "application/json";
      const metodo = opt.method || "GET";
      // Al salir de casa el celular pasa del wifi a los datos y la primera consulta suele fallar: se reintenta.
      let r;
      for (let intento = 0; ; intento++) {
        try {
          r = await fetch(base + ruta, { method: metodo, headers, body: opt.body ? JSON.stringify(opt.body) : undefined, cache: "no-store" });
          break;
        } catch (e) {
          if (metodo !== "GET" || intento >= 2) throw new Error("Sin internet o el servidor no respondió");
          await new Promise((ok) => setTimeout(ok, intento ? 2000 : 700));
        }
      }
      let j = null;
      try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
      if (!r.ok) throw new Error((j && j.error) || "Error " + r.status);
      return j;
    }
    return {
      demo: false,
      ahora: () => Date.now() / 1000,
      puntos: (a, b) => pedir(`/puntos?desde=${encodeURIComponent(iso(a))}&hasta=${encodeURIComponent(iso(b))}`),
      estado: () => pedir("/estado"),
      lugares: () => pedir("/lugares"),
      crearLugar: (l) => pedir("/lugares", { method: "POST", body: l }),
      editarLugar: (id, c) => pedir("/lugares/" + id, { method: "PATCH", body: c }),
      borrarLugar: (id) => pedir("/lugares/" + id, { method: "DELETE" }),
      fijarModo: (m) => pedir("/modo", { method: "POST", body: { modo: m } }),
      llaves: () => pedir("/llaves"),
      borrarLlave: (id) => pedir("/llaves/" + encodeURIComponent(id), { method: "DELETE" }),
      opcionesLlave: () => pedir("/llave/registro/opciones", { method: "POST", body: {} }),
      registrarLlave: (respuesta, nombre) => pedir("/llave/registro", { method: "POST", body: { respuesta, nombre } }),
    };
  }

  function fuenteDemo(D) {
    let lugares = D.lugares.map((l) => Object.assign({}, l));
    let sig = 100, modo = "equilibrado";
    const P = D.puntos;
    const K = ["t", "lat", "lon", "acc", "v", "m", "b"];
    return {
      demo: true,
      ahora: () => D.ahora,
      async puntos(a, b) {
        const out = { n: 0, t: [], lat: [], lon: [], acc: [], v: [], m: [], b: [] };
        for (let i = 0; i < P.n; i++) if (P.t[i] >= a && P.t[i] < b) { for (const k of K) out[k].push(P[k][i]); out.n++; }
        return out;
      },
      async estado() {
        const i = P.n - 1;
        return {
          ultimo: { t: iso(P.t[i]), lat: P.lat[i], lon: P.lon[i], precision_m: P.acc[i], bateria: P.b[i] / 100, bateria_estado: "unplugged" },
          total: P.n, primero: iso(P.t[0]), ultimas_24h: P.t.filter((t) => t > D.ahora - DIA).length, modo, config_pendiente: false,
        };
      },
      async lugares() { return lugares.map((l) => Object.assign({}, l)); },
      async crearLugar(l) { const n = Object.assign({ id: sig++, radio_m: 120 }, l); lugares.push(n); return n; },
      async editarLugar(id, c) { const l = lugares.find((x) => x.id === id); Object.assign(l, c); return l; },
      async borrarLugar(id) { lugares = lugares.filter((x) => x.id !== id); return { ok: true }; },
      async fijarModo(m) { modo = m; return { ok: true, modo: m }; },
    };
  }

  function cargarScript(src) {
    return new Promise((ok, mal) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = mal; document.head.appendChild(s); });
  }

  // ---------- Estado ----------
  const S = {
    cfg: null, fuente: null, pestana: "dia",
    fecha: null, estado: null, lugares: [],
    an: null, items: [], sel: null, cargando: false,
    frecuentes: null, rangoLugares: 30, selLugar: null, editando: null,
    errorConexion: null, reintento: null,
  };

  // ---------- Mapa ----------
  let mapa, capaTiles, capa, ajustarMapa = true;
  function iniciarMapa() {
    mapa = L.map("mapa", { zoomControl: false, preferCanvas: false, attributionControl: true }).setView([-12.1, -77.03], 12);
    L.control.zoom({ position: "bottomright" }).addTo(mapa);
    mapa.attributionControl.setPrefix(false);
    ponerTiles();
    try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { ponerTiles(); redibujar(); }); } catch (e) { /* navegador antiguo */ }
    capa = L.layerGroup().addTo(mapa);
  }
  function oscuro() {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  }
  // Mapa base vectorial de OpenFreeMap: gratis, sin clave y con versión oscura.
  // El estilo se ajusta antes de pintarlo: calles con su nombre local («Avenida Simón Bolívar», no «Simon Bolivar Avenue»)
  // y sin las flechas de sentido único, que solo ensucian. Si falla, se usa el estilo tal cual.
  const estilos = {};
  async function estiloMapa(nombre) {
    const url = "https://tiles.openfreemap.org/styles/" + nombre;
    if (estilos[nombre]) return estilos[nombre];
    try {
      const s = await (await fetch(url)).json();
      s.layers = s.layers.filter((l) => !/oneway/.test(l.id)).map((l) => {
        const t = l.layout && l.layout["text-field"];
        if (t) l.layout["text-field"] = JSON.parse(JSON.stringify(t).split('["get","name_en"]').join('["get","name"]'));
        return l;
      });
      return (estilos[nombre] = s);
    } catch (e) { return url; }
  }
  let turnoTiles = 0;
  async function ponerTiles() {
    const turno = ++turnoTiles;
    const atrib = '© <a href="https://openfreemap.org">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    if (!L.maplibreGL) {
      if (!capaTiles) capaTiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapa);
      return;
    }
    const estilo = await estiloMapa(oscuro() ? "dark" : "positron");
    if (turno !== turnoTiles) return;
    if (capaTiles) capaTiles.remove();
    capaTiles = L.maplibreGL({ style: estilo, attribution: atrib }).addTo(mapa);
  }
  function redibujar() { if (S.pestana === "lugares") dibujarLugares(); else dibujarDia(); }

  // El panel flota sobre el mapa: lo que se muestra se encuadra en la parte libre.
  const esCelular = () => innerWidth <= 820;
  // En la computadora el panel va al lado del mapa, no encima: solo se descuenta lo que de verdad lo tape.
  const tapaIzq = () => Math.max(0, $("#panel").getBoundingClientRect().right - $("#mapa").getBoundingClientRect().left);
  function relleno() {
    const p = $("#panel").getBoundingClientRect();
    if (esCelular()) return { paddingTopLeft: [28, 36], paddingBottomRight: [28, innerHeight - p.top + 24] };
    return { paddingTopLeft: [tapaIzq() + 56, 72], paddingBottomRight: [72, 56] };
  }
  function centroLibre(ll, z) {
    const p = $("#panel").getBoundingClientRect();
    const d = esCelular() ? [0, (innerHeight - p.top) / 2] : [-tapaIzq() / 2, 0];
    return mapa.unproject(mapa.project(L.latLng(ll), z).add(d), z);
  }
  function volarA(ll, z) {
    const c = centroLibre(ll, z);
    if (sinMovimiento()) mapa.setView(c, z, { animate: false });
    else mapa.flyTo(c, z, { duration: 0.45, easeLinearity: 0.25 });
  }
  function volarALimites(ll, maxZoom) {
    const op = Object.assign({ maxZoom }, relleno());
    if (sinMovimiento()) mapa.fitBounds(ll, Object.assign(op, { animate: false }));
    else mapa.flyToBounds(ll, Object.assign(op, { duration: 0.45, easeLinearity: 0.25 }));
  }

  // El trazo dice cómo te moviste: sólido = vehículo, puntos = a pie, guiones = bici.
  const TRAZO = { vehiculo: null, pie: "0.1 6", bici: "7 5", desconocido: "0.1 8" };

  // Al abrir un día, una pluma de cinabrio dibuja la ruta en menos de un segundo y luego se retira.
  function trazar(plumas) {
    if (!plumas.length) return;
    // Corre en el próximo cuadro; si el navegador no pinta (pestaña oculta), igual corre y termina.
    let empezado = false;
    const correr = () => {
      if (empezado) return;
      empezado = true;
      for (const { pluma, capas, k } of plumas) {
        const p = pluma._path;
        let listo = false;
        const terminar = () => {
          if (listo) return;
          listo = true;
          for (const x of capas) if (x._path) { x._path.style.transition = "opacity .25s"; x._path.style.opacity = ""; }
          if (p) { p.style.transition = "opacity .3s"; p.style.opacity = "0"; }
          setTimeout(() => { if (capa.hasLayer(pluma)) capa.removeLayer(pluma); }, 320);
        };
        if (!p || !p.getTotalLength || document.hidden) { terminar(); continue; }
        const largo = p.getTotalLength();
        const ms = Math.round(Math.min(850, 280 + largo * 0.35)), espera = k * 90;
        p.style.strokeDasharray = largo + " " + largo;
        p.style.strokeDashoffset = String(largo);
        p.getBoundingClientRect();
        p.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(.4,0,.2,1) ${espera}ms`;
        p.style.strokeDashoffset = "0";
        p.addEventListener("transitionend", terminar, { once: true });
        mapa.once("zoomstart movestart", terminar);
        setTimeout(terminar, ms + espera + 300);
      }
    };
    requestAnimationFrame(correr);
    setTimeout(correr, 60);
  }

  function marcaYo(lat, lon) {
    return L.marker([lat, lon], { icon: L.divIcon({ className: "pin-wrap", html: '<div class="yo"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }), keyboard: false, zIndexOffset: 1000 });
  }

  function dibujarDia() {
    if (!capa) return;
    capa.clearLayers();
    const c = colores();
    const limites = [];
    const sel = S.sel;
    const animar = S.animarRuta && !sinMovimiento() && !document.hidden;
    S.animarRuta = false;
    const plumas = [];
    let orden = 0;
    S.items.forEach((it, idx) => {
      if (it.tipo !== "trayecto") return;
      const tenue = sel != null && sel !== idx;
      const elegido = sel === idx;
      const tinta = elegido ? c.accent : c.ruta;
      const piezas = it.sinDatos || !it.tramos.length ? [{ modo: "desconocido", i0: 0, i1: it.path.length - 1 }] : it.tramos;
      const capas = [], todo = [];
      for (const t of piezas) {
        const ll = it.path.slice(t.i0, t.i1 + 1).map((p) => [p.lat, p.lon]);
        if (ll.length < 2) continue;
        limites.push(...ll);
        todo.push(...ll);
        capas.push(L.polyline(ll, { color: c.casing, weight: elegido ? 8 : 6, opacity: tenue ? 0.3 : 0.85, interactive: false, lineCap: "round", lineJoin: "round" }).addTo(capa));
        capas.push(L.polyline(ll, { color: tinta, weight: elegido ? 3.5 : 2.5, opacity: tenue ? 0.3 : 1, dashArray: TRAZO[t.modo] || null, lineCap: "round", lineJoin: "round", className: elegido ? "ruta-elegida" : "" })
          .on("click", () => seleccionar(idx, "mapa")).addTo(capa));
      }
      if (animar && todo.length > 1) {
        for (const x of capas) if (x._path) x._path.style.opacity = "0";
        const pluma = L.polyline(todo, { color: c.accent, weight: 2.5, opacity: 1, interactive: false, lineCap: "round", lineJoin: "round" }).addTo(capa);
        plumas.push({ pluma, capas, k: orden });
      }
      orden++;
    });
    // Estancias en el mismo sitio (ir y volver a casa) comparten un marcador: «1·6».
    const grupos = [];
    S.items.forEach((it, idx) => {
      if (it.tipo !== "estancia") return;
      let g = grupos.find((x) => A.dist(x.lat, x.lon, it.lat, it.lon) < 80);
      if (!g) grupos.push((g = { lat: it.lat, lon: it.lon, idxs: [] }));
      g.idxs.push(idx);
    });
    const vivo = esHoy() && S.an && S.an.enVivo;
    grupos.forEach((g, n) => {
      const nums = g.idxs.map((i) => S.items[i].num).join("·");
      const tiene = g.idxs.includes(sel);
      const aqui = vivo && vivo.quieto && g.idxs.some((i) => S.items[i].sigue && !S.items[i].cortaFin);
      const clase = "pin" + (tiene ? " sel" : sel != null ? " tenue" : "") + (aqui ? " ahora" : "") + (animar ? " brota" : "");
      const ancho = 20 + Math.max(0, nums.length - 1) * 6;
      const nombre = nombreDe(S.items[g.idxs[0]]) + (aqui ? " · estás aquí" : "");
      L.marker([g.lat, g.lon], { icon: L.divIcon({ className: "pin-wrap", html: `<div class="${clase}" style="--d:${250 + n * 60}ms">${nums}</div>`, iconSize: [ancho, 20], iconAnchor: [ancho / 2, 10] }), keyboard: false, zIndexOffset: tiene ? 500 : 0 })
        .bindTooltip(esc(nombre), { direction: "top", offset: [0, -10] })
        .on("click", () => {
          // Si el grupo ya está elegido, pasa a su siguiente estancia.
          const k = g.idxs.indexOf(sel);
          seleccionar(k >= 0 ? g.idxs[(k + 1) % g.idxs.length] : g.idxs[0], "mapa");
        }).addTo(capa);
      limites.push([g.lat, g.lon]);
    });
    // En movimiento: marca en la última posición recibida.
    const u = S.estado && S.estado.ultimo;
    if (u && vivo && !vivo.quieto) marcaYo(u.lat, u.lon).bindTooltip("Última posición · " + hace(S.fuente.ahora() - Date.parse(u.t) / 1000), { direction: "top", offset: [0, -8] }).addTo(capa);
    if (ajustarMapa && sel == null && limites.length) mapa.fitBounds(limites, Object.assign({ maxZoom: 17, animate: false }, relleno()));
    else if (ajustarMapa && !limites.length && u) mapa.setView(centroLibre([u.lat, u.lon], 15), 15, { animate: false });
    ajustarMapa = false;
    if (animar) trazar(plumas);
  }

  // ---------- Pestañas ----------
  function irA(p) {
    const antes = S.pestana;
    S.pestana = p;
    const orden = ["dia", "lugares", "conectar"];
    document.querySelectorAll(".pestanas button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.p === p)));
    const nav = $(".pestanas"), i = orden.indexOf(p), j = orden.indexOf(antes);
    nav.classList.toggle("a-der", i > j);
    nav.classList.toggle("a-izq", i < j);
    nav.style.setProperty("--i", i);
    for (const id of orden) $("#p-" + id).hidden = id !== p;
    $("#desliza").scrollTop = 0;
    if (p === "dia") { ajustarMapa = true; if (antes !== p) S.animarRuta = true; dibujarDia(); }
    if (p === "lugares") { ajustarMapa = true; cargarLugaresFrecuentes(); }
    if (p === "conectar") { renderConectar(); dibujarDia(); }
  }

  // ---------- Día ----------
  const esHoy = () => S.fecha && seg(S.fecha) === seg(medianoche(new Date(S.fuente.ahora() * 1000)));
  function nombreDe(it) {
    const l = A.lugarDe(it.lat, it.lon, S.lugares);
    return l ? l.nombre : "Lugar sin nombre";
  }

  function fijarFecha(d, entra) {
    S.entraFecha = entra || null;
    S.fecha = medianoche(d);
    S.sel = null;
    S.editando = null;
    ajustarMapa = true;
    local.guardar("fecha", seg(S.fecha));
    cargarDia();
  }

  async function cargarDia(silencioso) {
    const a = seg(S.fecha), b = seg(sumarDias(S.fecha, 1));
    renderCabeceraDia();
    if (!silencioso) { S.cargando = true; S.animarDia = true; S.animarRuta = true; renderDia(); }
    const pedido = (S.pedidoDia = {});
    try {
      // Se piden 24 h extra a cada lado para saber dónde empezaste y terminaste el día.
      const datos = await S.fuente.puntos(a - DIA, b + DIA);
      if (pedido !== S.pedidoDia) return;
      S.an = A.analizar(datos, { ahora: S.fuente.ahora() });
      S.items = A.delDia(S.an, a, b);
      let n = 0;
      for (const it of S.items) if (it.tipo === "estancia") it.num = ++n;
      S.errorDia = null;
    } catch (e) {
      if (pedido !== S.pedidoDia) return;
      // Si ya se veía este día, se queda como estaba y se vuelve a intentar en silencio.
      const mismoDia = S.an && S.diaCargado === a;
      if (!mismoDia) { S.items = []; S.an = null; S.errorDia = e.message; }
      clearTimeout(S.reintento);
      S.reintento = setTimeout(() => { if (!document.hidden) cargarDia(true); }, 15000);
      if (mismoDia) { S.cargando = false; return; }
    }
    if (!S.errorDia) S.diaCargado = a;
    S.cargando = false;
    renderDia();
    if (S.pestana !== "lugares") dibujarDia();
  }

  function renderCabeceraDia() {
    const hoy = medianoche(new Date(S.fuente.ahora() * 1000));
    const dif = Math.round((seg(hoy) - seg(S.fecha)) / DIA);
    const rel = dif === 0 ? "Hoy" : dif === 1 ? "Ayer" : "";
    const anio = S.fecha.getFullYear() !== hoy.getFullYear() ? " " + S.fecha.getFullYear() : "";
    $("#dia-rel").textContent = rel;
    const sem = fSemana.format(S.fecha);
    $("#dia-texto").innerHTML = `<span class="dia-num">${String(S.fecha.getDate()).padStart(2, "0")}</span><span class="dia-txt"><b>${esc(sem.charAt(0).toUpperCase() + sem.slice(1))}</b><i>${rel ? `<em>${rel}</em> · ` : ""}${esc(fMes.format(S.fecha) + anio)}</i></span>`;
    $("#dia-titulo").title = "Elegir fecha · " + fFecha.format(S.fecha);
    if (S.entraFecha && !sinMovimiento()) reanimar($("#dia-texto"), "entra-" + S.entraFecha);
    S.entraFecha = null;
    $("#dia-sig").disabled = dif <= 0;
    $("#dia-hoy").hidden = dif === 0;
    const fi = $("#fecha-input");
    fi.max = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
    fi.value = `${S.fecha.getFullYear()}-${String(S.fecha.getMonth() + 1).padStart(2, "0")}-${String(S.fecha.getDate()).padStart(2, "0")}`;
  }

  function renderDia() {
    const el = $("#dia-contenido");
    $("#aviso-demo").hidden = !S.fuente.demo;
    if (S.cargando && !S.items.length) { el.innerHTML = '<div class="vacio">Cargando…</div>'; return; }
    if (S.errorDia) { el.innerHTML = `<div class="vacio"><b>No se pudo leer el servidor</b>${esc(S.errorDia)}. Se vuelve a intentar solo. <button class="enlace" data-reintentar>Reintentar ahora</button></div>`; return; }
    if (!S.items.length) {
      const sinNada = S.estado && !S.estado.ultimo;
      const antes = S.estado && S.estado.primero && seg(sumarDias(S.fecha, 1)) <= Date.parse(S.estado.primero) / 1000;
      el.innerHTML = sinNada
        ? '<div class="vacio"><b>Todavía no llega ningún punto</b>Conecta tu teléfono en la pestaña «Conectar». Los datos aparecen aquí en minutos.</div>'
        : antes ? '<div class="vacio"><b>Aún no rastreabas este día</b>Tu historial empieza el ' + esc(fFecha.format(new Date(S.estado.primero))) + ".</div>"
        : '<div class="vacio"><b>Sin datos este día</b>El teléfono no mandó puntos (apagado, sin batería o sin permiso de ubicación).</div>';
      return;
    }
    const r = A.resumen(S.items);
    const lugaresDia = A.lugaresFrecuentes(S.items, S.lugares).length;
    S.animarDia = false;
    let h = '<div class="cifras">';
    h += `<div class="cifra"><b data-n="${r.dist}" data-f="d">${FORMATOS.d(r.dist)}</b><small>Recorrido</small></div>`;
    h += `<div class="cifra"><b data-n="${r.mov}" data-f="t">${FORMATOS.t(r.mov)}</b><small>En movimiento</small></div>`;
    h += `<div class="cifra"><b data-n="${lugaresDia}" data-f="n">${lugaresDia}</b><small>${lugaresDia === 1 ? "Lugar" : "Lugares"}</small></div>`;
    h += "</div>";
    h += renderFranja();
    h += '<ol class="linea" id="linea">' + S.items.map(htmlItem).join("") + "</ol>";
    el.innerHTML = h;
    if (S.editando != null) { const i = $("#nombre-nuevo"); if (i) i.focus(); }
  }

  function renderFranja() {
    const a = seg(S.fecha);
    const pct = (s) => ((s - a) / DIA) * 100;
    let h = '<div class="franja"><div class="franja-barra" id="franja">';
    S.items.forEach((it, idx) => {
      const sel = S.sel === idx ? " sel" : "";
      if (it.tipo === "estancia") {
        h += `<i class="estancia${sel}" data-i="${idx}" style="left:${pct(it.ini)}%;width:${pct(it.fin) - pct(it.ini)}%" title="${esc(nombreDe(it))} · ${hora(it.ini)}–${hora(it.fin)}"></i>`;
      } else {
        const piezas = it.tramos.length && !it.sinDatos ? it.tramos : [{ modo: "desconocido", ini: it.ini, fin: it.fin }];
        for (const t of piezas) {
          const ini = Math.max(t.ini, it.ini), fin = Math.min(t.fin, it.fin);
          h += `<i class="m-${MODOS[t.modo] ? t.modo : "desconocido"}${sel}" data-i="${idx}" style="left:${pct(ini)}%;width:${pct(fin) - pct(ini)}%" title="${MODOS[t.modo] ? MODOS[t.modo].nombre : ""} · ${hora(ini)}–${hora(fin)}"></i>`;
        }
      }
    });
    if (esHoy()) h += `<div class="ahora" style="left:${pct(S.fuente.ahora())}%"></div>`;
    h += '</div><div class="franja-horas"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>';
    return h;
  }

  const SUGERIDOS = ["Casa", "Oficina", "Gimnasio", "Familia"];
  const GLIFO = { vehiculo: "", pie: "0.1 3.4", bici: "4 2.5", desconocido: "0.1 4.5" };
  const glifo = (m) => `<svg class="glifo" viewBox="0 0 22 6" aria-hidden="true"><line x1="1.5" y1="3" x2="20.5" y2="3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"${GLIFO[m] ? ` stroke-dasharray="${GLIFO[m]}"` : ""}/></svg>`;

  function htmlItem(it, idx) {
    const sel = S.sel === idx ? " sel" : "";
    if (it.tipo === "estancia") {
      const l = A.lugarDe(it.lat, it.lon, S.lugares);
      let sub;
      if (it.sigue && !it.cortaFin) sub = '<span style="color:var(--accent)">sigues aquí</span>';
      else if (it.cortaIni && it.cortaFin) sub = "todo el día";
      else if (it.cortaFin) sub = "continúa al día siguiente";
      else sub = "hasta " + hora(it.fin);
      const nombre = l ? `<span class="nombre">${esc(l.nombre)}</span>` : '<span class="nombre sin">Lugar sin nombre</span>';
      let extra = "";
      if (!l) {
        extra = S.editando === idx
          ? `<form class="nombrar" data-form="${idx}"><input id="nombre-nuevo" class="campo" maxlength="80" placeholder="Nombre del lugar" autocomplete="off"><button class="boton primario">Guardar</button></form><div class="sugerencias">${SUGERIDOS.map((n) => `<button type="button" class="chip" data-sugerido-dia="${idx}" data-nombre="${n}">${n}</button>`).join("")}</div>`
          : `<button class="enlace" data-nombrar="${idx}" style="font-size:12px;margin-top:5px">Ponerle nombre</button>`;
      }
      return `<li class="item estancia${sel}" data-i="${idx}"><time>${it.cortaIni ? "—" : hora(it.ini)}</time><div class="cuerpo"><div class="fila"><span class="num">${it.num}</span>${nombre}</div><div class="sub">${sub}</div>${extra}</div><span class="dur">${dur(it.fin - it.ini)}</span></li>`;
    }
    const modo = it.sinDatos ? "desconocido" : it.modo;
    const texto = it.sinDatos ? "Trayecto sin datos" : `${(MODOS[modo] || MODOS.desconocido).nombre} · ${dist(it.dist)}`;
    let tramos = "";
    if (!it.sinDatos && it.tramos.length > 1) tramos = '<div class="tramos">' + it.tramos.map((t) => `<span class="tramo">${glifo(t.modo)}${dur(t.fin - t.ini)}</span>`).join("") + "</div>";
    return `<li class="item trayecto${it.sinDatos ? " sin-datos" : ""}${sel}" data-i="${idx}"><time>${it.cortaIni ? "—" : hora(it.ini)}</time><div class="cuerpo"><div class="fila">${glifo(modo)}<span class="trayecto-txt">${texto}</span></div>${tramos}</div><span class="dur">${dur(it.fin - it.ini)}</span></li>`;
  }

  function seleccionar(idx, origen) {
    S.sel = S.sel === idx && origen !== "mapa" ? null : idx;
    if (S.editando != null && S.editando !== idx) S.editando = null;
    renderDia();
    dibujarDia();
    if (S.sel == null) return;
    if (!sinMovimiento()) {
      reanimar(document.querySelector(`#linea [data-i="${idx}"] .num`), "sella");
      document.querySelectorAll(".pin.sel").forEach((el) => reanimar(el, "sella"));
    }
    const it = S.items[idx];
    if (it.tipo === "estancia") volarA([it.lat, it.lon], Math.max(mapa.getZoom(), 16));
    else {
      const ll = it.path.map((p) => [p.lat, p.lon]);
      if (ll.length) volarALimites(ll, 17);
    }
    if (origen !== "lista") { const li = document.querySelector(`#linea [data-i="${idx}"]`); if (li) li.scrollIntoView({ block: "nearest" }); }
  }

  async function guardarNombre(idx, nombre) {
    const it = S.items[idx];
    nombre = nombre.trim();
    if (!nombre) return;
    try {
      const radio_m = S.an ? radioDePuntos(it.lat, it.lon, S.an.puntos, [it]) : 30;
      await S.fuente.crearLugar({ nombre, lat: +it.lat.toFixed(6), lon: +it.lon.toFixed(6), radio_m });
      S.lugares = await S.fuente.lugares();
      S.editando = null;
      S.frecuentes = null;
      renderDia();
      dibujarDia();
    } catch (e) { alertaSuave("No se pudo guardar: " + e.message); }
  }

  function alertaSuave(msg) {
    const el = $("#dia-contenido");
    const p = document.createElement("div");
    p.className = "aviso"; p.style.background = "var(--bad-soft)"; p.textContent = msg;
    el.prepend(p);
    setTimeout(() => p.remove(), 5000);
  }

  // ---------- Lugares ----------
  async function cargarLugaresFrecuentes() {
    const el = $("#p-lugares");
    if (!S.frecuentes) {
      el.innerHTML = '<div class="vacio">Calculando tus lugares…</div>';
      try {
        const ahora = S.fuente.ahora();
        const datos = await S.fuente.puntos(ahora - S.rangoLugares * DIA, ahora + 60);
        const an = A.analizar(datos, { ahora });
        S.frecuentes = A.lugaresFrecuentes(an.items, S.lugares);
        S.puntosRango = an.puntos;
        S.estanciasRango = an.items.filter((x) => x.tipo === "estancia");
      } catch (e) {
        el.innerHTML = `<div class="vacio"><b>No se pudo leer el servidor</b>${esc(e.message)}</div>`;
        return;
      }
    }
    renderLugares();
    dibujarLugares();
  }

  function recalcularFrecuentes() {
    if (S.estanciasRango) S.frecuentes = A.lugaresFrecuentes(S.estanciasRango, S.lugares);
  }

  // Tamaño automático: el radio que abarca el 85 % de tus puntos GPS en ese sitio, más un margen.
  const RADIO_MIN = 10, RADIO_MAX = 2000, TAMANOS = [15, 30, 60, 120, 250];
  function radioDePuntos(lat, lon, P, estancias) {
    const d = [];
    for (const v of estancias) for (let k = v.i0; k <= v.i1 && k < P.length; k++) if (!P[k].virtual) d.push(A.dist(lat, lon, P[k].lat, P[k].lon));
    if (d.length < 3) return 30;
    d.sort((a, b) => a - b);
    return Math.min(300, Math.max(15, Math.round((d[Math.floor(d.length * 0.85)] + 5) / 5) * 5));
  }
  const radioAuto = (c) => radioDePuntos(c.lat, c.lon, S.puntosRango || [], c.visitas);

  function renderLugares() {
    const el = $("#p-lugares");
    const F = S.frecuentes || [];
    const nombradosSinVisitas = S.lugares.filter((l) => !F.some((c) => c.lugar && c.lugar.id === l.id));
    let h = '<div class="encabezado"><h2 class="etiqueta">Dónde pasas tu tiempo</h2><div class="rangos" role="group" aria-label="Periodo">';
    for (const d of [7, 30, 90]) h += `<button data-rango="${d}" aria-pressed="${S.rangoLugares === d}" title="Últimos ${d} días">${d}D</button>`;
    h += "</div></div>";
    if (S.fuente.demo) h += '<p class="aviso">Ejemplo con datos inventados: lo que cambies aquí no se guarda.</p>';
    if (!F.length && !nombradosSinVisitas.length) {
      el.innerHTML = h + '<div class="vacio"><b>Aún no hay lugares</b>Aparecen solos cuando pasas 5 minutos o más en un sitio.</div>';
      bindRango();
      return;
    }
    const max = Math.max(...F.map((c) => c.seg), 1);
    h += '<ul class="lista-lugares">';
    F.forEach((c, i) => {
      const sel = S.selLugar === i;
      const nombre = c.lugar ? `<span class="nombre">${esc(c.lugar.nombre)}</span>` : '<span class="nombre sin">Lugar sin nombre</span>';
      const visitas = c.visitas.length;
      h += `<li class="lugar${sel ? " sel" : ""}" data-l="${i}"><div class="fila">${nombre}<span class="dur">${dur(c.seg)}</span></div>`;
      h += `<div class="sub">${visitas} ${visitas === 1 ? "visita" : "visitas"} · última ${esc(fCorta.format(new Date(c.ultima * 1000)))}</div>`;
      h += `<div class="barrita"><i style="width:${(c.seg / max) * 100}%"></i></div>`;
      if (sel) h += editorLugar(c, i);
      h += "</li>";
    });
    for (const l of nombradosSinVisitas) {
      h += `<li class="lugar" data-lugar-id="${l.id}"><div class="fila"><span class="nombre">${esc(l.nombre)}</span><span class="dur">—</span></div><div class="sub">sin visitas en este periodo</div></li>`;
    }
    h += "</ul>";
    el.innerHTML = h;
    bindRango();
  }

  function editorLugar(c, i) {
    const l = c.lugar;
    const b = S.borrador || {};
    const r = Math.round(S.borrador ? S.borrador.radio_m : l ? l.radio_m : radioAuto(c));
    const auto = radioAuto(c);
    const chips = [`<button type="button" class="chip" data-radio="${auto}" aria-pressed="${r === auto}">Auto · ${auto} m</button>`]
      .concat(TAMANOS.filter((t) => t !== auto).map((t) => `<button type="button" class="chip" data-radio="${t}" aria-pressed="${r === t}">${t} m</button>`)).join("");
    const conForma = b.forma === "contorno";
    const forma = `<div><div class="etiqueta">Forma</div><div class="tamanos" role="group" aria-label="Forma">
        <button type="button" class="chip" data-forma="circulo" aria-pressed="${!conForma}">Círculo</button>
        <button type="button" class="chip" data-forma="contorno" aria-pressed="${conForma}">Contorno</button></div></div>`;
    const detalle = conForma
      ? `<div><div class="etiqueta">Contorno <b id="valor-contorno">${textoContorno(b)}</b></div>
          <p class="ayuda" id="ayuda-contorno">${ayudaContorno(b)}</p>
          <div class="tamanos" id="botones-contorno">${botonesContorno(b)}</div></div>`
      : `<div><div class="etiqueta">Tamaño <b id="valor-radio">${r} m a la redonda</b></div>
          <div class="tamanos">${chips}</div>
          <p class="ayuda">O arrastra en el mapa el borde del círculo para el tamaño, o su centro para moverlo.</p></div>`;
    return `<div class="editor" data-editor="${i}">
      <div><div class="etiqueta">Nombre</div>
        <input class="campo" name="nombre" maxlength="80" value="${l ? esc(l.nombre) : ""}" placeholder="Escribe y presiona Enter" autocomplete="off">
        ${l ? "" : `<div class="sugerencias">${SUGERIDOS.map((n) => `<button type="button" class="chip" data-sugerido="${n}">${n}</button>`).join("")}</div>`}
      </div>
      ${forma}
      ${detalle}
      <div class="acciones">${l ? `<button type="button" class="boton peligro" data-borrar="${l.id}">Quitar nombre</button>` : "<span></span>"}<span class="guardado" id="guardado">Guardado</span></div>
    </div>`;
  }

  // ---------- Contornos: la forma real del lugar ----------
  const fArea = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });
  function textoArea(m2) { return m2 < 10000 ? fEntero.format(Math.round(m2 / 10) * 10) + " m²" : fArea.format(m2 / 10000) + " ha"; }
  function textoContorno(b) {
    if (b.modoContorno === "dibujar") { const n = (b.trazo || []).length; return n === 1 ? "1 esquina" : n + " esquinas"; }
    if (!b.contorno) return "sin trazar";
    return (b.tipoForma ? b.tipoForma + " · " : "") + textoArea(A.areaContorno(b.contorno));
  }
  function ayudaContorno(b) {
    if (b.avisoContorno) return b.avisoContorno;
    if (b.modoContorno === "tomar") return b.contorno
      ? "Si no es el que buscas, toca otra vez en el mismo sitio: pasa al siguiente más grande. Arrastra las esquinas para ajustarlo."
      : "Toca en el mapa el parque, edificio, colegio o centro comercial que es este lugar.";
    if (b.modoContorno === "dibujar") return "Toca el mapa para poner cada esquina, en orden.";
    return "Arrastra las esquinas para ajustarlo; los puntos chicos entre esquinas agregan una nueva.";
  }
  function botonesContorno(b) {
    if (b.modoContorno === "dibujar") {
      const n = (b.trazo || []).length;
      return `<button type="button" class="chip" data-contorno="deshacer"${n ? "" : " disabled"}>Deshacer</button>
        <button type="button" class="chip" data-contorno="listo"${n >= 3 ? "" : " disabled"}>Listo</button>
        <button type="button" class="chip" data-contorno="tomar">Tomar del mapa</button>`;
    }
    return `<button type="button" class="chip" data-contorno="tomar" aria-pressed="${b.modoContorno === "tomar"}">Tomar del mapa</button>
      <button type="button" class="chip" data-contorno="dibujar">Dibujar a mano</button>`;
  }
  function refrescarContorno() {
    const b = S.borrador;
    if (!b) return;
    const v = $("#valor-contorno"), a = $("#ayuda-contorno"), bt = $("#botones-contorno");
    if (v) v.textContent = textoContorno(b);
    if (a) a.textContent = ayudaContorno(b);
    if (bt) bt.innerHTML = botonesContorno(b);
  }

  // Centro (por área) y radio que abarca el contorno: el servidor y los filtros rápidos siguen usando un círculo.
  function centroYRadio(cont) {
    const lat0 = cont[0][0], lon0 = cont[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
    const V = cont.map((v) => [(v[1] - lon0) * kx, (v[0] - lat0) * ky]);
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = V.length - 1; i < V.length; j = i++) {
      const f = V[j][0] * V[i][1] - V[i][0] * V[j][1];
      a += f; cx += (V[j][0] + V[i][0]) * f; cy += (V[j][1] + V[i][1]) * f;
    }
    if (Math.abs(a) < 1e-6) { cx = V.reduce((s, v) => s + v[0], 0) / V.length; cy = V.reduce((s, v) => s + v[1], 0) / V.length; }
    else { cx /= 3 * a; cy /= 3 * a; }
    const lat = lat0 + cy / ky, lon = lon0 + cx / kx;
    const r = Math.max(...cont.map((v) => A.dist(lat, lon, v[0], v[1])));
    return { lat: +lat.toFixed(6), lon: +lon.toFixed(6), radio_m: Math.min(RADIO_MAX, Math.max(RADIO_MIN, Math.round(r))) };
  }
  // Quita vértices que no cambian la forma (los parques del mapa traen cientos); como mucho 400.
  function simplificar(cont) {
    cont = cont.filter((v, k) => !k || A.dist(v[0], v[1], cont[k - 1][0], cont[k - 1][1]) > 1.5);
    if (cont.length < 3) return cont;
    const lat0 = cont[0][0], lon0 = cont[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
    const V = cont.map((v) => [(v[1] - lon0) * kx, (v[0] - lat0) * ky]);
    const dp = (tol) => {
      const P = V.concat([V[0]]), keep = new Uint8Array(P.length);
      keep[0] = keep[P.length - 1] = 1;
      const pila = [[0, P.length - 1]];
      while (pila.length) {
        const [i, j] = pila.pop();
        let dmax = 0, k = -1;
        const [ax, ay] = P[i], [bx, by] = P[j], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        for (let m = i + 1; m < j; m++) {
          const t = L2 ? Math.max(0, Math.min(1, ((P[m][0] - ax) * dx + (P[m][1] - ay) * dy) / L2)) : 0;
          const d = Math.hypot(P[m][0] - ax - t * dx, P[m][1] - ay - t * dy);
          if (d > dmax) { dmax = d; k = m; }
        }
        if (k > 0 && dmax > tol) { keep[k] = 1; pila.push([i, k], [k, j]); }
      }
      const out = [];
      for (let m = 0; m < P.length - 1; m++) if (keep[m]) out.push(cont[m]);
      return out;
    };
    let tol = 1.2, out = dp(tol);
    while (out.length > 400) { tol *= 1.6; out = dp(tol); }
    return out.length >= 3 ? out : cont.slice(0, 3);
  }

  // Formas del mapa base (OpenFreeMap) que contienen el punto, de la más chica a la más grande.
  const CAPAS_FORMA = ["building", "park", "landuse", "landcover", "aeroway"];
  const NOMBRE_CLASE = {
    building: "Edificio", park: "Parque", aeroway: "Aeropuerto", grass: "Área verde", wood: "Bosque", forest: "Bosque", sand: "Arena",
    school: "Colegio", university: "Universidad", college: "Instituto", kindergarten: "Nido", hospital: "Hospital", stadium: "Estadio",
    pitch: "Cancha", playground: "Juegos", cemetery: "Cementerio", commercial: "Zona comercial", retail: "Zona comercial",
    industrial: "Zona industrial", military: "Zona militar", beach: "Playa", zoo: "Zoológico", theme_park: "Parque de diversiones",
  };
  // Zonas que no son «un lugar» (un barrio residencial entero, campos de cultivo) y tamaños absurdos para uno.
  const CLASES_FUERA = new Set(["residential", "neighbourhood", "suburb", "quarter", "farmland", "farmyard", "meadow"]);
  const AREA_MAX = 3e6; // m² (300 ha)
  function dentroAnillo(ring, x, y) {
    let d = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
    }
    return d;
  }
  function cajaDe(ring) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const [x, y] of ring) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
    return [a, b, c, d];
  }
  const tocan = (p, q, e) => p[0] - e <= q[2] && q[0] - e <= p[2] && p[1] - e <= q[3] && q[1] - e <= p[3];
  function formasEn(lat, lon) {
    let gl = null;
    try { gl = capaTiles && capaTiles.getMaplibreMap ? capaTiles.getMaplibreMap() : null; } catch (e) { gl = null; }
    if (!gl) return [];
    const piezas = [];
    for (const sl of CAPAS_FORMA) {
      let fs = [];
      try { fs = gl.querySourceFeatures("openmaptiles", { sourceLayer: sl }); } catch (e) { continue; }
      for (const f of fs) {
        const g = f.geometry;
        const polys = g && g.type === "Polygon" ? [g.coordinates] : g && g.type === "MultiPolygon" ? g.coordinates : [];
        const p = f.properties || {};
        const clave = sl + "|" + (f.id != null ? f.id : [p.class, p.subclass, p.name].join("·"));
        if (CLASES_FUERA.has(p.class)) continue;
        for (const poly of polys) if (poly[0] && poly[0].length >= 4) piezas.push({ capa: sl, clase: p.class, clave, poly, caja: cajaDe(poly[0]) });
      }
    }
    const out = [];
    const vistos = new Set();
    for (const pz of piezas) {
      if (vistos.has(pz.clave) || !dentroAnillo(pz.poly[0], lon, lat)) continue;
      vistos.add(pz.clave);
      // Los mosaicos del mapa cortan los rasgos grandes: se juntan los trozos vecinos del mismo rasgo.
      // El mismo trozo puede llegar dos veces (mosaicos de dos zooms con distinto detalle): queda el más detallado.
      const iou = (p, q) => {
        const w = Math.min(p[2], q[2]) - Math.max(p[0], q[0]), h = Math.min(p[3], q[3]) - Math.max(p[1], q[1]);
        if (w <= 0 || h <= 0) return 0;
        const i = w * h, ap = (p[2] - p[0]) * (p[3] - p[1]), aq = (q[2] - q[0]) * (q[3] - q[1]);
        return i / (ap + aq - i);
      };
      const cand = piezas.filter((q) => q.clave === pz.clave && tocan(q.caja, pz.caja, 2e-5)).sort((p, q) => q.poly[0].length - p.poly[0].length);
      const unicos = [];
      for (const q of cand) if (!unicos.some((u) => iou(u.caja, q.caja) > 0.6)) unicos.push(q);
      const trozos = unicos.map((q) => q.poly);
      let partes = [unicos.find((q) => dentroAnillo(q.poly[0], lon, lat)) ? unicos.find((q) => dentroAnillo(q.poly[0], lon, lat)).poly : pz.poly];
      if (trozos.length > 1 && window.polygonClipping) { try { partes = window.polygonClipping.union(...trozos); } catch (e) { partes = [pz.poly]; } }
      const parte = partes.find((q) => dentroAnillo(q[0], lon, lat)) || pz.poly;
      let ring = parte[0].map(([x, y]) => [+y.toFixed(6), +x.toFixed(6)]);
      if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
      if (ring.length < 3) continue;
      ring = simplificar(ring);
      const area = A.areaContorno(ring);
      if (area < 20 || area > AREA_MAX) continue;
      out.push({ contorno: ring, area, tipo: NOMBRE_CLASE[pz.capa === "building" || pz.capa === "park" || pz.capa === "aeroway" ? pz.capa : pz.clase] || "Zona" });
    }
    out.sort((a, b) => a.area - b.area);
    return out.filter((x, k) => !k || x.area > out[k - 1].area * 1.03);
  }

  function tomarContorno(ll) {
    const b = S.borrador;
    const previo = b.toma && A.dist(b.toma.lat, b.toma.lon, ll.lat, ll.lng) < 25 ? b.toma : null;
    const formas = formasEn(ll.lat, ll.lng);
    if (!formas.length) {
      b.avisoContorno = "Ahí el mapa no tiene un contorno: toca justo sobre el edificio o el parque (acerca el mapa si hace falta), o dibújalo a mano.";
      refrescarContorno();
      b.avisoContorno = null;
      return;
    }
    const k = previo ? (previo.k + 1) % formas.length : 0;
    b.toma = { lat: ll.lat, lon: ll.lng, k };
    b.tipoForma = formas[k].tipo;
    fijarContorno(formas[k].contorno);
    toque(8);
  }

  // Guarda un contorno nuevo (centro y radio se recalculan).
  function fijarContorno(cont) {
    const cr = centroYRadio(cont);
    const x = S.frecuentes && S.frecuentes[S.selLugar];
    if (x) { x.lat = cr.lat; x.lon = cr.lon; }
    aplicarLugar(Object.assign({ contorno: cont }, cr));
    refrescarContorno();
    dibujarLugares();
  }

  function accionContorno(accion) {
    const b = S.borrador;
    if (!b) return;
    b.tipoForma = accion === "tomar" ? b.tipoForma : null;
    if (accion === "tomar") { b.modoContorno = "tomar"; b.trazo = null; }
    else if (accion === "dibujar") { b.modoContorno = "dibujar"; b.trazo = []; b.toma = null; }
    else if (accion === "deshacer" && b.trazo) b.trazo.pop();
    else if (accion === "listo" && b.trazo && b.trazo.length >= 3) { const t = b.trazo; b.trazo = null; b.modoContorno = null; fijarContorno(t); return; }
    refrescarContorno();
    dibujarLugares();
  }

  function cambiarForma(forma) {
    const b = S.borrador;
    const x = S.frecuentes && S.frecuentes[S.selLugar];
    if (!b || !x || (b.forma || "circulo") === forma) return;
    b.forma = forma;
    if (forma === "contorno") { b.modoContorno = b.contorno ? null : "tomar"; }
    else {
      b.modoContorno = null; b.trazo = null; b.toma = null; b.tipoForma = null;
      if (b.contorno) aplicarLugar({ contorno: null, radio_m: radioAuto(x) });
    }
    renderLugares();
    dibujarLugares();
  }

  function alTocarMapa(e) {
    const b = S.borrador;
    if (S.pestana !== "lugares" || S.selLugar == null || !b || b.forma !== "contorno") return;
    if (b.modoContorno === "tomar") tomarContorno(e.latlng);
    else if (b.modoContorno === "dibujar") {
      b.trazo.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]);
      toque(6);
      refrescarContorno();
      dibujarLugares();
    }
  }

  function bindRango() {
    document.querySelectorAll("#p-lugares [data-rango]").forEach((b) => {
      b.onclick = () => {
        if (+b.dataset.rango === S.rangoLugares) return;
        S.rangoLugares = +b.dataset.rango; S.frecuentes = null; S.selLugar = null; S.borrador = null; ajustarMapa = true; cargarLugaresFrecuentes();
      };
    });
  }

  const alEste = (lat, lon, r) => [lat, lon + r / (111320 * Math.cos((lat * Math.PI) / 180))];
  const asidero = (clase) => L.divIcon({ className: "pin-wrap", html: `<div class="asidero ${clase}"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] });

  function dibujarLugares() {
    if (!capa) return;
    capa.clearLayers();
    S.circuloLugar = null;
    const c = colores();
    const F = S.frecuentes || [];
    const max = Math.max(...F.map((x) => x.seg), 1);
    const limites = [];
    F.forEach((x, i) => {
      const sel = S.selLugar === i;
      if (!sel && x.lugar && Array.isArray(x.lugar.contorno)) L.polygon(x.lugar.contorno, { color: c.ruta, weight: 1, opacity: 0.45, fill: false, interactive: false }).addTo(capa);
      if (sel && S.borrador && S.borrador.forma === "contorno" && S.borrador.contorno) { limites.push([x.lat, x.lon]); return; }
      L.circleMarker([x.lat, x.lon], { radius: 5 + 11 * Math.sqrt(x.seg / max), color: sel ? c.accent : c.ruta, weight: 1, opacity: sel ? 1 : 0.8, fillColor: sel ? c.accent : c.ruta, fillOpacity: sel ? 0.22 : 0.08 })
        .bindTooltip(esc(x.lugar ? x.lugar.nombre : "Lugar sin nombre") + " · " + dur(x.seg), { direction: "top" })
        .on("click", () => elegirLugar(i)).addTo(capa);
      limites.push([x.lat, x.lon]);
    });
    // Lugar elegido con contorno: el polígono con sus esquinas (y puntos medios para agregar una) arrastrables.
    const b = S.selLugar != null && S.borrador;
    if (b && b.forma === "contorno") {
      dibujarContorno(b, c);
      if (ajustarMapa && limites.length) mapa.fitBounds(limites, Object.assign({ maxZoom: 16, animate: false }, relleno()));
      ajustarMapa = false;
      return;
    }
    // Lugar elegido: círculo con dos asideros (borde = tamaño, centro = posición).
    if (b) {
      const circ = (S.circuloLugar = L.circle([b.lat, b.lon], { radius: b.radio_m, color: c.accent, weight: 1.5, fillColor: c.accent, fillOpacity: 0.08, interactive: false }).addTo(capa));
      const borde = L.marker(alEste(b.lat, b.lon, b.radio_m), { draggable: true, keyboard: false, icon: asidero(""), zIndexOffset: 2000 }).addTo(capa);
      const centro = L.marker([b.lat, b.lon], { draggable: true, keyboard: false, icon: asidero("centro"), zIndexOffset: 2001 }).addTo(capa);
      let rPrevio = b.radio_m;
      borde.on("dragstart", () => toque(10));
      centro.on("dragstart", () => toque(10));
      borde.on("drag", (e) => {
        const r = Math.min(RADIO_MAX, Math.max(RADIO_MIN, Math.round(A.dist(b.lat, b.lon, e.latlng.lat, e.latlng.lng) / 5) * 5));
        if (r !== rPrevio && TAMANOS.includes(r)) toque(6);
        rPrevio = r;
        circ.setRadius(r);
        mostrarRadio(r);
      });
      borde.on("dragend", () => { const r = Math.round(circ.getRadius()); borde.setLatLng(alEste(b.lat, b.lon, r)); aplicarLugar({ radio_m: r }); });
      centro.on("drag", (e) => { circ.setLatLng(e.latlng); borde.setLatLng(alEste(e.latlng.lat, e.latlng.lng, circ.getRadius())); });
      centro.on("dragend", (e) => { const ll = e.target.getLatLng(); aplicarLugar({ lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6) }); });
      S.asideroBorde = borde;
    }
    if (ajustarMapa && limites.length) mapa.fitBounds(limites, Object.assign({ maxZoom: 16, animate: false }, relleno()));
    ajustarMapa = false;
  }

  function dibujarContorno(b, c) {
    if (b.modoContorno === "dibujar") {
      const t = b.trazo || [];
      if (t.length >= 2) L.polyline(t.length >= 3 ? t.concat([t[0]]) : t, { color: c.accent, weight: 1.5, dashArray: "4 4", interactive: false }).addTo(capa);
      t.forEach((v) => L.marker(v, { keyboard: false, interactive: false, icon: asidero("") }).addTo(capa));
      return;
    }
    if (!b.contorno) return;
    const pts = b.contorno.map((v) => L.latLng(v[0], v[1]));
    const poli = L.polygon(pts, { color: c.accent, weight: 1.5, fillColor: c.accent, fillOpacity: 0.08, interactive: false }).addTo(capa);
    const guardar = () => fijarContorno(poli.getLatLngs()[0].map((p) => [+p.lat.toFixed(6), +p.lng.toFixed(6)]));
    pts.forEach((p, k) => {
      const m = L.marker(p, { draggable: true, keyboard: false, icon: asidero(""), zIndexOffset: 2000 }).addTo(capa);
      m.on("dragstart", () => toque(10));
      m.on("drag", (e) => { const v = poli.getLatLngs()[0].slice(); v[k] = e.latlng; poli.setLatLngs(v); });
      m.on("dragend", guardar);
    });
    if (pts.length <= 60) pts.forEach((p, k) => {
      const q = pts[(k + 1) % pts.length];
      const m = L.marker(L.latLng((p.lat + q.lat) / 2, (p.lng + q.lng) / 2), { draggable: true, keyboard: false, icon: asidero("medio"), zIndexOffset: 1999 }).addTo(capa);
      let v = null;
      m.on("dragstart", () => { toque(10); v = poli.getLatLngs()[0].slice(); v.splice(k + 1, 0, m.getLatLng()); });
      m.on("drag", (e) => { v[k + 1] = e.latlng; poli.setLatLngs(v); });
      m.on("dragend", guardar);
    });
  }

  function elegirLugar(i) {
    if (S.selLugar === i) return;
    const x = S.frecuentes[i];
    S.selLugar = i;
    const cont = x.lugar && Array.isArray(x.lugar.contorno) ? x.lugar.contorno.map((v) => v.slice()) : null;
    S.borrador = { radio_m: x.lugar ? x.lugar.radio_m : radioAuto(x), lat: x.lat, lon: x.lon, contorno: cont, forma: cont ? "contorno" : "circulo", modoContorno: null };
    renderLugares();
    dibujarLugares();
    if (cont) volarALimites(cont, 18); else volarA([x.lat, x.lon], Math.max(mapa.getZoom(), 17));
    const li = document.querySelector(`[data-l="${i}"]`);
    if (li) li.scrollIntoView({ block: "nearest" });
  }

  function mostrarRadio(r) {
    const v = $("#valor-radio");
    if (v) v.textContent = r + " m a la redonda";
    document.querySelectorAll("#p-lugares [data-radio]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.radio === r)));
  }

  function fijarRadio(r) {
    const b = S.borrador;
    if (!b) return;
    if (S.circuloLugar) S.circuloLugar.setRadius(r);
    if (S.asideroBorde) S.asideroBorde.setLatLng(alEste(b.lat, b.lon, r));
    mostrarRadio(r);
    aplicarLugar({ radio_m: r });
  }

  // Cambios del lugar elegido: se guardan solos (sin botón) si el lugar ya tiene nombre.
  let esperaGuardar = null;
  function aplicarLugar(cambios) {
    Object.assign(S.borrador, cambios);
    const x = S.frecuentes[S.selLugar];
    if (!x || !x.lugar) return;
    Object.assign(x.lugar, cambios);
    if ("contorno" in cambios) delete x.lugar._area;
    clearTimeout(esperaGuardar);
    esperaGuardar = setTimeout(async () => {
      try {
        await S.fuente.editarLugar(x.lugar.id, cambios);
        const l = S.lugares.find((y) => y.id === x.lugar.id);
        if (l) { Object.assign(l, cambios); delete l._area; }
        avisarGuardado();
      } catch (e) { alert("No se pudo guardar: " + e.message); }
    }, 250);
  }
  function avisarGuardado() {
    const g = $("#guardado");
    if (!g) return;
    g.classList.add("si");
    clearTimeout(avisarGuardado.t);
    avisarGuardado.t = setTimeout(() => g.classList.remove("si"), 1400);
  }

  async function guardarNombreLugar(nombre) {
    nombre = (nombre || "").trim();
    const i = S.selLugar;
    const x = S.frecuentes && S.frecuentes[i];
    if (!x || !nombre || (x.lugar && x.lugar.nombre === nombre)) return;
    try {
      if (x.lugar) {
        await S.fuente.editarLugar(x.lugar.id, { nombre });
        x.lugar.nombre = nombre;
        const l = S.lugares.find((y) => y.id === x.lugar.id);
        if (l) l.nombre = nombre;
        const li = document.querySelector(`[data-l="${i}"] .nombre`);
        if (li) { li.textContent = nombre; li.classList.remove("sin"); }
        avisarGuardado();
      } else {
        const b = S.borrador;
        const nuevo = await S.fuente.crearLugar(Object.assign({ nombre, lat: +b.lat.toFixed(6), lon: +b.lon.toFixed(6), radio_m: b.radio_m }, b.forma === "contorno" && b.contorno ? { contorno: b.contorno } : {}));
        S.lugares = await S.fuente.lugares();
        recalcularFrecuentes();
        S.selLugar = Math.max(0, S.frecuentes.findIndex((c) => c.lugar && c.lugar.id === nuevo.id));
        renderLugares();
        dibujarLugares();
        avisarGuardado();
      }
      renderDia();
    } catch (e) { alert("No se pudo guardar: " + e.message); }
  }

  async function borrarLugar(id) {
    try {
      await S.fuente.borrarLugar(id);
      S.lugares = await S.fuente.lugares();
      recalcularFrecuentes();
      S.selLugar = null;
      S.borrador = null;
      renderLugares();
      dibujarLugares();
      renderDia();
    } catch (e) { alert("No se pudo quitar: " + e.message); }
  }

  // ---------- Conectar ----------
  const DESC_MODOS = {
    equilibrado: ["Equilibrado", "Mientras te mueves, un punto cada 10 segundos (a pie, cada 20 metros); quieto no gasta. Para el día a día."],
    envivo: ["En vivo", "Un punto cada 30 s aunque estés quieto: ves dónde estás al momento. Gasta mucha batería; úsalo por ratos."],
    detallado: ["Detallado", "GPS cada 5 s mientras te mueves. Trayectos finísimos; bastante batería."],
    ahorro: ["Ahorro", "Wifi y antenas, un punto cada 100 metros. Batería mínima; trayectos aproximados."],
  };

  // Configuración de OwnTracks (Android) en un enlace owntracks:///config?inline=<base64>.
  // El modo de rastreo viene del servidor (estado.owntracks) para que coincida con el que tú elegiste.
  const USUARIO_OT = "rastro", DISPOSITIVO_OT = "android", TID_OT = "yo";
  function configOwntracks() {
    if (!S.cfg || !S.cfg.claveEscritura) return null;
    return Object.assign({
      _type: "configuration",
      mode: 3, // HTTP
      url: S.cfg.url.replace(/\/+$/, ""),
      username: USUARIO_OT,
      password: S.cfg.claveEscritura,
      deviceId: DISPOSITIVO_OT,
      tid: TID_OT,
      remoteConfiguration: true, // deja que esta página le cambie el modo de rastreo (los comandos remotos ya vienen activos)
    }, (S.estado && S.estado.owntracks) || { monitoring: 1, locatorPriority: "HighAccuracy", locatorInterval: 30, locatorDisplacement: 30 });
  }
  function enlaceOwntracks() {
    const c = configOwntracks();
    if (!c) return null;
    return "owntracks:///config?inline=" + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(c)))));
  }

  function enlaceOtroDispositivo() {
    if (!S.cfg) return null;
    const datos = btoa(unescape(encodeURIComponent(JSON.stringify({ url: S.cfg.url, clave: S.cfg.clave })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return datos;
  }

  // Página publicada (GitHub Pages, sin datos ni claves). El celular recibe la clave de lectura en el «#»
  // ---------- Llaves de acceso (passkeys) ----------
  // Tu servidor (no es secreto: sin clave no entrega nada). La llave prueba que eres tú y el servidor responde con la clave de lectura.
  const SERVIDOR = (window.RASTRO_CONFIG && window.RASTRO_CONFIG.url) || "https://bkskialonwivuqxmpiau.supabase.co/functions/v1/rastro";
  const URL_WEBAUTHN = "https://unpkg.com/@simplewebauthn/browser@14.0.0/dist/bundle/index.umd.min.js";
  const ORIGEN_PUBLICO = new URL(PAGINA_PUBLICA_DEF).origin;
  const llavesPosibles = () => !!(window.PublicKeyCredential && navigator.credentials);
  async function webauthn() {
    if (!window.SimpleWebAuthnBrowser) await cargarScript(URL_WEBAUTHN);
    return window.SimpleWebAuthnBrowser;
  }
  function errorLlave(e) {
    const n = e && e.name;
    if (n === "NotAllowedError" || n === "AbortError") return "Se canceló o se acabó el tiempo. Vuelve a intentar.";
    if (n === "InvalidStateError") return "Este equipo ya tiene una llave de Locus.";
    return (e && e.message) || "No se pudo usar la llave.";
  }
  function nombreEquipo() {
    const ua = navigator.userAgent;
    const so = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Equipo";
    const nav = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
    return nav ? so + " · " + nav : so;
  }
  async function entrarConLlave(nota) {
    const decir = (t) => { if (nota) nota.textContent = t; };
    if (!llavesPosibles()) return decir("Este navegador no admite llaves de acceso. Usa la clave de lectura.");
    try {
      decir("Esperando tu llave…");
      const W = await webauthn();
      const pedirJson = async (ruta, cuerpo) => {
        const r = await fetch(SERVIDOR + ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) });
        let j = null;
        try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
        if (!r.ok) throw new Error((j && j.error) || "Error " + r.status);
        return j;
      };
      const opciones = await pedirJson("/llave/entrada/opciones");
      const respuesta = await W.startAuthentication({ optionsJSON: opciones });
      decir("Verificando…");
      const j = await pedirJson("/llave/entrada", { respuesta });
      local.guardar("config", { url: SERVIDOR, clave: j.clave });
      location.reload();
    } catch (e) { decir(errorLlave(e)); }
  }
  async function crearLlave() {
    const nota = $("#nota-llave");
    const decir = (t) => { if (nota) nota.textContent = t; };
    try {
      decir("Sigue los pasos de tu equipo…");
      const W = await webauthn();
      const opciones = await S.fuente.opcionesLlave();
      const respuesta = await W.startRegistration({ optionsJSON: opciones });
      await S.fuente.registrarLlave(respuesta, nombreEquipo());
      await pintarLlaves();
      decir("Listo. Desde otro equipo, abre la página y toca «Entrar».");
    } catch (e) { decir(errorLlave(e)); }
  }
  async function pintarLlaves() {
    const ul = $("#lista-llaves");
    if (!ul) return;
    try {
      const L = await S.fuente.llaves();
      ul.innerHTML = L.map((l) => `<li><span>${esc(l.nombre || "Llave")}<small>creada ${esc(fCorta.format(new Date(l.creada)))}${l.usada ? " · usada " + esc(hace(S.fuente.ahora() - Date.parse(l.usada) / 1000)) : ""}</small></span><button type="button" class="boton chico" data-quitar-llave="${esc(l.id)}">Quitar</button></li>`).join("");
      ul.hidden = !L.length;
    } catch (e) { ul.hidden = true; }
  }

  // del enlace: esa parte nunca viaja al servidor y la página la guarda solo en ese navegador.
  const PAGINA_PUBLICA = (window.RASTRO_CONFIG && window.RASTRO_CONFIG.paginaPublica) || PAGINA_PUBLICA_DEF;
  function enlaceCelular() {
    const d = enlaceOtroDispositivo();
    return d && S.cfg.origen === "archivo" ? PAGINA_PUBLICA + "#conectar=" + d : null;
  }

  function htmlEstado() {
    const e = S.estado || {};
    const u = e.ultimo;
    let h = '<h3>Estado</h3><dl class="datos">';
    if (S.errorConexion) h += `<dt>Servidor</dt><dd style="color:var(--bad)">${esc(S.errorConexion)}</dd>`;
    else h += `<dt>Servidor</dt><dd title="${esc(new URL(S.cfg.url).host)}">Conectado</dd>`;
    if (u) {
      const edadU = hace(S.fuente.ahora() - Date.parse(u.t) / 1000);
      h += `<dt>Último punto</dt><dd>${edadU}</dd>`;
      if (u.precision_m != null) h += `<dt>Precisión</dt><dd>${Math.round(u.precision_m)} m</dd>`;
      if (u.bateria != null) h += `<dt>Batería</dt><dd${u.bateria <= 0.15 && u.bateria_estado !== "charging" ? ' style="color:var(--warn)"' : ""}>${Math.round(u.bateria * 100)} %${u.bateria_estado === "charging" ? " · cargando" : ""}</dd>`;
      h += `<dt>Puntos guardados</dt><dd>${fEntero.format(e.total)}</dd>`;
      h += `<dt>Últimas 24 h</dt><dd>${fEntero.format(e.ultimas_24h)}</dd>`;
      h += `<dt>Historial desde</dt><dd>${esc(fCorta.format(new Date(e.primero)))}</dd>`;
    } else if (!S.errorConexion) {
      h += "<dt>Teléfono</dt><dd>todavía no manda datos</dd>";
    }
    return h + "</dl>";
  }

  function renderConectar() {
    const el = $("#p-conectar");
    if (S.fuente.demo) {
      el.innerHTML = `
        <div class="bloque"><h3>Entrar</h3>
          <p>Con tu llave de acceso: tu huella o tu cara. Si este equipo no la tiene, el navegador te muestra un código para aprobarla con el celular.</p>
          <div><button type="button" class="boton primario" data-entrar>Entrar</button></div>
          <p class="nota" id="nota-entrar"></p>
        </div>
        <div class="bloque"><details class="manual"><summary><b>Entrar con la clave de lectura</b></summary>
          <form class="form" id="form-config">
            <input class="campo" name="url" value="${esc(SERVIDOR)}" placeholder="https://…supabase.co/functions/v1/rastro" autocomplete="off" required>
            <input class="campo" name="clave" placeholder="Clave de lectura" autocomplete="off" required>
            <div><button class="boton primario">Conectar</button></div>
          </form>
        </details></div>
        <div class="bloque"><h3>Cómo funciona</h3>
          <p>Tu Android registra la ubicación con la app gratuita <b>OwnTracks</b> y la manda a tu propio servidor (Supabase, a tu nombre) cada vez que te mueves. Esta página lee de ahí y arma tus días: dónde estuviste, cuánto tiempo y cómo te moviste.</p>
          <p>El teléfono usa una clave que solo sirve para escribir; esta página usa otra que solo sirve para leer.</p>
        </div>`;
      return;
    }
    const e = S.estado || {};
    const u = e.ultimo;
    let h = `<div class="bloque" id="bloque-estado">${htmlEstado()}</div>`;
    if (llavesPosibles()) {
      const aqui = location.origin === ORIGEN_PUBLICO;
      h += `<div class="bloque"><h3>Llaves de acceso</h3>
        <p>Entra desde cualquier equipo con tu huella o tu cara, sin claves. Créala en el celular: se guarda en tu cuenta de Google y sirve también en Chrome de la computadora.</p>
        <ul class="llaves" id="lista-llaves" hidden></ul>
        ${aqui ? '<div><button type="button" class="boton" id="crear-llave">Crear llave de acceso</button></div>' : `<p class="nota">Las llaves se crean desde la página publicada (<a href="${esc(PAGINA_PUBLICA)}" target="_blank" rel="noopener">${esc(new URL(PAGINA_PUBLICA).host)}</a>), por ejemplo en tu celular.</p>`}
        <p class="nota" id="nota-llave"></p></div>`;
    }

    const linkCel = enlaceCelular();
    if (linkCel) {
      h += `<div class="bloque"><h3>Verlo en el celular</h3>
        <p>Escanéalo con la cámara del celular: se abre con tus datos y queda guardada en ese navegador. Luego, desde su menú, agrégala a la pantalla de inicio.</p>
        <p class="nota">El código da acceso de lectura a todo tu historial: no lo compartas ni le tomes captura.</p>
        <button type="button" class="boton" id="ver-qr-cel">Mostrar código</button>
        <div class="qr" id="qr-cel" hidden></div></div>`;
    }

    const link = enlaceOwntracks();
    const conectado = !!u;
    h += conectado
      ? '<div class="bloque"><details class="manual"><summary><b>Volver a configurar el Android</b></summary><ol class="pasos">'
      : '<div class="bloque"><h3>Conectar el Android</h3><ol class="pasos">';
    h += '<li>Instala <b>OwnTracks</b> (gratis, código abierto) desde <a href="https://play.google.com/store/apps/details?id=org.owntracks.android" target="_blank" rel="noopener">Google Play</a>.</li>';
    h += "<li>Ábrela y completa la bienvenida. Cuando pida la ubicación elige <b>Permitir todo el tiempo</b> y <b>Ubicación precisa</b>. Permite también las notificaciones: OwnTracks necesita su aviso fijo para seguir funcionando en segundo plano.</li>";
    if (link) {
      const c = configOwntracks();
      h += `<li>Escanea este código con la cámara del teléfono (o Google Lens) y toca el enlace: se abre OwnTracks con tu configuración. Toca <b>✓</b> arriba a la derecha para importarla.<div class="qr" id="qr"></div>
        <details class="manual"><summary>¿La cámara no ofrece abrirlo? Configúralo a mano</summary>
          <p>En OwnTracks: menú → <b>Preferences → Connection</b>.</p>
          <dl class="datos">
            <dt>Mode</dt><dd>HTTP</dd>
            <dt>URL</dt><dd><code class="largo">${esc(c.url)}</code></dd>
            <dt>Username</dt><dd><code>${USUARIO_OT}</code></dd>
            <dt>Password</dt><dd><code id="clave-ot" class="secreto">••••-••••-••••</code> <button type="button" class="boton chico" id="ver-clave">Mostrar</button></dd>
            <dt>Device ID</dt><dd><code>${DISPOSITIVO_OT}</code></dd>
            <dt>Tracker ID</dt><dd><code>${TID_OT}</code></dd>
          </dl>
          <p>Luego en <b>Preferences → Advanced</b> activa <b>Remote configuration</b>, para que el modo de rastreo se cambie desde aquí.</p>
        </details></li>`;
    } else {
      h += "<li>Abre esta página en la Mac donde está <code>config.local.js</code>: ahí aparece el código para escanear.</li>";
    }
    h += '<li>En el teléfono: <b>Ajustes → Apps → OwnTracks → Batería → Sin restricciones</b>. Si no, Android la duerme y deja de mandar puntos. En Samsung, Xiaomi o Huawei revisa también <a href="https://dontkillmyapp.com" target="_blank" rel="noopener">dontkillmyapp.com</a>.</li>';
    h += "<li>Listo. Camina o muévete un poco y arriba dirá «En vivo». Para probar al instante, en el mapa de OwnTracks toca el botón de publicar tu ubicación.</li>";
    h += conectado ? "</ol></details></div>" : "</ol></div>";

    h += '<div class="bloque"><h3>Modo de rastreo</h3><div class="modos" id="modos">';
    for (const m of ["equilibrado", "envivo", "detallado", "ahorro"]) {
      h += `<label class="modo"><input type="radio" name="modo" value="${m}"${e.modo === m ? " checked" : ""}><span><b>${DESC_MODOS[m][0]}</b>${m === "equilibrado" ? '<em class="reco">Recomendado</em>' : ""}<small>${DESC_MODOS[m][1]}</small></span></label>`;
    }
    h += "</div>";
    h += `<p class="nota" id="nota-modo">${e.config_pendiente ? "El teléfono recibirá este modo con el próximo punto que mande." : "El teléfono ya tiene este modo."}</p></div>`;

    const otro = enlaceOtroDispositivo();
    h += '<div class="bloque"><p class="nota">Tus puntos viven solo en tu Supabase personal. El teléfono solo puede escribir; esta página solo puede leer.</p>';
    if (S.cfg.origen === "navegador") h += '<p><button class="boton peligro" id="olvidar">Desconectar este navegador</button></p>';
    if (otro && S.cfg.origen === "archivo") h += '<p class="nota">La clave de lectura está en <code>config.local.js</code>, en esta Mac.</p>';
    h += "</div>";
    el.innerHTML = h;
    pintarLlaves();

    if (window.qrcode) {
      for (const [sel, texto] of [["#qr", link], ["#qr-cel", linkCel]]) {
        if (!texto || !$(sel)) continue;
        const q = qrcode(0, "L");
        q.addData(texto);
        q.make();
        $(sel).innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      }
    }
  }

  // ---------- Estado en vivo ----------
  async function actualizarEstado() {
    try {
      const antes = S.estado && S.estado.ultimo && S.estado.ultimo.t;
      S.estado = await S.fuente.estado();
      S.errorConexion = null;
      const ahora = S.estado.ultimo && S.estado.ultimo.t;
      renderPill();
      return antes !== ahora;
    } catch (e) {
      S.errorConexion = e.message;
      renderPill();
      return false;
    }
  }

  function renderPill() {
    const el = $("#estado");
    const poner = (clase, texto, titulo) => { el.className = "pill " + clase; el.innerHTML = `<i class="punto"></i><span>${esc(texto)}</span>`; el.title = titulo || ""; };
    if (S.fuente.demo) return poner("", "Ejemplo", "Datos inventados");
    if (S.errorConexion) { $("#hud").hidden = true; return poner("bad", "Sin conexión", S.errorConexion); }
    const u = S.estado && S.estado.ultimo;
    if (!u) return poner("", "Esperando al teléfono");
    const edad = S.fuente.ahora() - Date.parse(u.t) / 1000;
    const bat = u.bateria != null ? ` · ${Math.round(u.bateria * 100)} %` : "";
    const bajo = u.bateria != null && u.bateria <= 0.15 && u.bateria_estado !== "charging";
    const titulo = "Último punto: " + new Date(u.t).toLocaleString("es-PE") + (bajo ? " · batería baja" : "");
    renderHud(u, edad);
    // En vivo el teléfono manda cada 30 s; en los demás modos, quieto no manda nada y eso es normal.
    const silencioNormal = S.estado.modo === "envivo" ? 5 * 60 : 12 * 3600;
    if (edad < 3 * 60) poner(bajo ? "warn vivo" : "ok vivo", "En vivo" + bat, titulo);
    else if (edad < silencioNormal) poner(bajo ? "warn" : "ok", hace(edad).replace("hace", "Hace") + bat, titulo);
    else if (edad < 24 * 3600) poner("warn", "Sin señal " + hace(edad) + bat, titulo);
    else poner("bad", "Sin datos " + hace(edad), titulo);
  }

  // Lectura de la última posición, como un instrumento: coordenadas, precisión y hora.
  function renderHud(u, edad) {
    const el = $("#hud");
    if (!u) { el.hidden = true; return; }
    el.hidden = false;
    const nuevo = renderHud.t && renderHud.t !== u.t;
    renderHud.t = u.t;
    el.className = "hud mono" + (edad < 180 ? " vivo" : "") + (nuevo && !sinMovimiento() ? " nuevo" : "");
    el.innerHTML = `<i class="punto"></i><span class="et">LAT</span><b>${u.lat.toFixed(5)}</b><span class="et">LON</span><b>${u.lon.toFixed(5)}</b>${u.precision_m != null ? `<span>±${Math.round(u.precision_m)} m</span>` : ""}<span>${hora(Date.parse(u.t) / 1000)}</span>`;
  }

  // ---------- Eventos ----------
  function enlazar() {
    document.querySelector(".pestanas").addEventListener("click", (e) => { const b = e.target.closest("button[data-p]"); if (b) irA(b.dataset.p); });
    // Ignora el click que sigue a un arrastre.
    document.addEventListener("click", (e) => { if (performance.now() < sinClicksHasta) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    enlazarHoja();
    enlazarDeslizarDia();
    document.addEventListener("click", (e) => { const b = e.target.closest("[data-ir]"); if (b) irA(b.dataset.ir); });
    $("#dia-ant").onclick = () => fijarFecha(sumarDias(S.fecha, -1), "izq");
    $("#dia-sig").onclick = () => fijarFecha(sumarDias(S.fecha, 1), "der");
    $("#dia-hoy").onclick = () => fijarFecha(new Date(S.fuente.ahora() * 1000));
    $("#dia-titulo").onclick = () => { const fi = $("#fecha-input"); try { fi.showPicker(); } catch (err) { fi.focus(); fi.click(); } };
    $("#fecha-input").onchange = (e) => { const v = e.target.value; if (v) { const [y, m, d] = v.split("-").map(Number); fijarFecha(new Date(y, m - 1, d)); } };

    const dia = $("#dia-contenido");
    dia.addEventListener("click", (e) => {
      if (e.target.closest("[data-reintentar]")) { cargarDia(); return; }
      const sug = e.target.closest("[data-sugerido-dia]");
      if (sug) { e.stopPropagation(); guardarNombre(+sug.dataset.sugeridoDia, sug.dataset.nombre); return; }
      const nom = e.target.closest("[data-nombrar]");
      if (nom) { e.stopPropagation(); S.editando = +nom.dataset.nombrar; renderDia(); return; }
      if (e.target.closest("form")) return;
      const li = e.target.closest("[data-i]");
      if (li) seleccionar(+li.dataset.i, li.closest("#franja") ? "franja" : "lista");
    });
    dia.addEventListener("submit", (e) => {
      const f = e.target.closest("[data-form]");
      if (!f) return;
      e.preventDefault();
      guardarNombre(+f.dataset.form, f.querySelector("input").value);
    });
    dia.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.editando != null) { S.editando = null; renderDia(); } });

    const lug = $("#p-lugares");
    lug.addEventListener("click", (e) => {
      const borrar = e.target.closest("[data-borrar]");
      if (borrar) { borrarLugar(+borrar.dataset.borrar); return; }
      const chip = e.target.closest("[data-radio]");
      if (chip) { fijarRadio(+chip.dataset.radio); return; }
      const fm = e.target.closest("[data-forma]");
      if (fm) { cambiarForma(fm.dataset.forma); return; }
      const ac = e.target.closest("[data-contorno]");
      if (ac) { if (!ac.disabled) accionContorno(ac.dataset.contorno); return; }
      const sug = e.target.closest("[data-sugerido]");
      if (sug) { const inp = lug.querySelector('.editor [name="nombre"]'); if (inp) inp.value = sug.dataset.sugerido; guardarNombreLugar(sug.dataset.sugerido); return; }
      if (e.target.closest(".editor")) return;
      const li = e.target.closest("[data-l]");
      if (li) elegirLugar(+li.dataset.l);
    });
    lug.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.name === "nombre") { e.preventDefault(); guardarNombreLugar(e.target.value); } });
    lug.addEventListener("change", (e) => { if (e.target.name === "nombre") guardarNombreLugar(e.target.value); });

    const con = $("#p-conectar");
    con.addEventListener("change", async (e) => {
      if (e.target.name !== "modo") return;
      const nota = $("#nota-modo");
      try {
        await S.fuente.fijarModo(e.target.value);
        await actualizarEstado();
        nota.textContent = S.fuente.demo ? "En el ejemplo no se manda nada." : "Listo. El teléfono lo recibe con el próximo punto que mande.";
      } catch (err) { nota.textContent = "No se pudo cambiar: " + err.message; }
    });
    con.addEventListener("click", (e) => {
      if (e.target.id === "ver-qr-cel") {
        const q = $("#qr-cel");
        q.hidden = !q.hidden;
        e.target.textContent = q.hidden ? "Mostrar código" : "Ocultar código";
        return;
      }
      if (e.target.id !== "ver-clave") return;
      const c = $("#clave-ot"), visible = c.classList.toggle("visible");
      c.textContent = visible ? S.cfg.claveEscritura : "••••-••••-••••";
      e.target.textContent = visible ? "Ocultar" : "Mostrar";
    });
    con.addEventListener("submit", (e) => {
      if (e.target.id !== "form-config") return;
      e.preventDefault();
      const f = e.target;
      local.guardar("config", { url: f.url.value.trim(), clave: f.clave.value.trim() });
      location.reload();
    });
    con.addEventListener("click", async (e) => {
      if (e.target.id === "olvidar") { local.borrar("config"); location.reload(); }
      if (e.target.closest("[data-entrar]")) entrarConLlave($("#nota-entrar"));
      if (e.target.id === "crear-llave") crearLlave();
      const q = e.target.closest("[data-quitar-llave]");
      if (q && confirm("¿Quitar esta llave? Ese equipo ya no podrá entrar con ella.")) {
        try { await S.fuente.borrarLlave(q.dataset.quitarLlave); await pintarLlaves(); } catch (err) { alert("No se pudo quitar: " + err.message); }
      }
    });
    // «Entrar →» del aviso del ejemplo: abre Conexión y pide la llave de una vez.
    document.addEventListener("click", (e) => {
      if (!e.target.closest("[data-entrar-aviso]")) return;
      irA("conectar");
      entrarConLlave($("#nota-entrar"));
    });

    document.addEventListener("keydown", (e) => {
      if (S.pestana !== "dia" || (e.target.closest && e.target.closest("input, select, textarea")) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") fijarFecha(sumarDias(S.fecha, -1), "izq");
      else if (e.key === "ArrowRight" && !$("#dia-sig").disabled) fijarFecha(sumarDias(S.fecha, 1), "der");
      else if (e.key === "Escape" && S.sel != null) seleccionar(S.sel, "lista");
    });

    // Refresco: cada 30 s mira si llegaron puntos nuevos y, si estás viendo hoy o ayer, recarga en silencio.
    setInterval(async () => {
      if (S.fuente.demo || document.hidden) return;
      const hay = await actualizarEstado();
      if (hay) {
        S.frecuentes = null;
        const dif = (seg(medianoche(new Date())) - seg(S.fecha)) / DIA;
        if (dif <= 1) cargarDia(true);
      }
      if (S.pestana === "conectar") { const b = $("#bloque-estado"); if (b) b.innerHTML = htmlEstado(); }
    }, 30000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden || S.fuente.demo) return;
      actualizarEstado().then((hay) => { if (S.errorDia) cargarDia(); else if (hay && esHoy()) cargarDia(true); });
    });
  }

  // ---------- Hoja del celular: se arrastra con el dedo y se acomoda sola ----------
  // Tres alturas: plegada (solo la cabecera), media y alta. Mientras se mueve, la hoja se desplaza entera
  // (solo transform, sin recalcular el contenido en cada cuadro); al soltar se fija la altura final.
  const HOJA = { estado: "medio", anim: null };
  const alturasHoja = () => ({ plegado: 172, medio: Math.round(innerHeight * 0.58), alto: Math.round(innerHeight * 0.88) });
  const ORDEN_HOJA = ["plegado", "medio", "alto"];
  function fijarHoja(estado) {
    const p = $("#panel");
    HOJA.estado = estado;
    HOJA.anim = null;
    p.classList.remove("suelta", "arrastrando");
    p.style.transform = "";
    if (!esCelular()) { p.style.height = ""; document.body.style.removeProperty("--hoja"); return; }
    const h = alturasHoja()[estado];
    p.style.height = h + "px";
    document.body.style.setProperty("--hoja", h + "px");
  }
  function moverHoja(desde, estado) {
    const p = $("#panel"), alt = alturasHoja(), max = alt.alto + 40;
    if (estado !== HOJA.estado) toque(12);
    if (sinMovimiento()) { fijarHoja(estado); return; }
    const token = (HOJA.anim = {});
    p.classList.remove("suelta");
    p.style.height = max + "px";
    p.style.transform = `translateY(${max - desde}px)`;
    void p.offsetWidth;
    p.classList.add("suelta");
    p.style.transform = `translateY(${max - alt[estado]}px)`;
    const terminar = () => { if (HOJA.anim === token) fijarHoja(estado); };
    p.addEventListener("transitionend", terminar, { once: true });
    setTimeout(terminar, 450);
  }
  function enlazarHoja() {
    const p = $("#panel");
    let d = null;
    p.addEventListener("pointerdown", (e) => {
      if (!esCelular() || e.button > 0 || !e.target.closest(".asa, .barra")) return;
      d = { id: e.pointerId, y: e.clientY, mov: false, ty: e.clientY, tt: e.timeStamp, v: 0 };
    });
    addEventListener("pointermove", (e) => {
      if (!d || e.pointerId !== d.id) return;
      const dy = e.clientY - d.y;
      if (!d.mov) {
        if (Math.abs(dy) < 6) return;
        d.mov = true;
        HOJA.anim = null;
        d.h0 = innerHeight - p.getBoundingClientRect().top;
        d.max = alturasHoja().alto + 40;
        p.classList.remove("suelta");
        p.classList.add("arrastrando");
        p.style.height = d.max + "px";
        try { p.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
      }
      const alt = alturasHoja();
      let h = d.h0 - dy;
      if (h > alt.alto) h = alt.alto + (h - alt.alto) / 3;
      if (h < alt.plegado) h = alt.plegado - (alt.plegado - h) / 3;
      d.h = Math.min(h, d.max);
      p.style.transform = `translateY(${d.max - d.h}px)`;
      const dt = e.timeStamp - d.tt;
      if (dt > 0) { d.v = 0.6 * ((e.clientY - d.ty) / dt) + 0.4 * d.v; d.ty = e.clientY; d.tt = e.timeStamp; }
    });
    const soltar = (e) => {
      if (!d || e.pointerId !== d.id) return;
      const s = d;
      d = null;
      if (!s.mov) return;
      suprimirClicks();
      const alt = alturasHoja();
      let destino = ORDEN_HOJA.reduce((a, b) => (Math.abs(alt[b] - s.h) < Math.abs(alt[a] - s.h) ? b : a));
      if (Math.abs(s.v) > 0.45) {
        // Lanzada: va a la siguiente altura en esa dirección (dedo hacia abajo = más chica).
        const hacia = s.v > 0 ? ORDEN_HOJA.slice().reverse().find((k) => alt[k] < s.h - 4) : ORDEN_HOJA.find((k) => alt[k] > s.h + 4);
        destino = hacia || destino;
      }
      moverHoja(s.h, destino);
    };
    addEventListener("pointerup", soltar);
    addEventListener("pointercancel", soltar);
    $("#asa").addEventListener("click", () => {
      if (!esCelular()) return;
      moverHoja(innerHeight - p.getBoundingClientRect().top, HOJA.estado === "plegado" ? "medio" : "plegado");
    });
    addEventListener("resize", () => fijarHoja(HOJA.estado));
    fijarHoja("medio");
  }

  // ---------- Deslizar la fecha con el dedo para cambiar de día ----------
  function enlazarDeslizarDia() {
    const f = $(".fecha"), txt = $("#dia-texto");
    let s = null;
    f.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") s = { id: e.pointerId, x: e.clientX, y: e.clientY, mov: false, dx: 0 }; });
    addEventListener("pointermove", (e) => {
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!s.mov) {
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        s.mov = true;
        try { f.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
      }
      // Hacia el futuro no hay días: resiste.
      s.dx = dx < 0 && $("#dia-sig").disabled ? dx / 4 : dx;
      txt.style.transition = "none";
      txt.style.transform = `translateX(${s.dx * 0.45}px)`;
      txt.style.opacity = String(1 - Math.min(Math.abs(s.dx) / 300, 0.5));
    });
    const fin = (e) => {
      if (!s || e.pointerId !== s.id) return;
      const t = s;
      s = null;
      if (!t.mov) return;
      suprimirClicks();
      const atras = t.dx > 56, adelante = t.dx < -56 && !$("#dia-sig").disabled;
      if (atras || adelante) {
        txt.style.transform = txt.style.opacity = txt.style.transition = "";
        toque(8);
        fijarFecha(sumarDias(S.fecha, atras ? -1 : 1), atras ? "izq" : "der");
      } else {
        txt.style.transition = "transform .2s cubic-bezier(.2, .7, .1, 1), opacity .2s";
        txt.style.transform = txt.style.opacity = "";
      }
    };
    addEventListener("pointerup", fin);
    addEventListener("pointercancel", fin);
  }

  // ---------- Firma de Alignment y emblema de Georgos ----------
  const GLIFOS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#/<>";
  // Texto que se descifra: cada letra gira entre signos al azar hasta asentarse, de izquierda a derecha.
  function descifrar(el, final, paso, retraso) {
    clearInterval(el._cifra);
    const t0 = performance.now(), total = (retraso || 0) + final.length * paso;
    el._cifra = setInterval(() => {
      const t = performance.now() - t0;
      if (t < (retraso || 0)) return;
      let out = "";
      for (let i = 0; i < final.length; i++) out += t >= (retraso || 0) + (i + 1) * paso ? final[i] : GLIFOS[(Math.random() * GLIFOS.length) | 0];
      el.textContent = out;
      if (t >= total) { clearInterval(el._cifra); el.textContent = final; }
    }, 40);
  }
  function enlazarFirma() {
    const f = $("#firma"), txt = f.querySelector(".txt"), cero = f.querySelector("b");
    if (sinMovimiento()) return;
    let ocupada = true;
    const intro = () => {
      f.classList.remove("espera");
      f.classList.add("intro");
      setTimeout(() => { descifrar(txt, "Miembro", 55); descifrar(cero, "0", 90, 7 * 55); }, 850);
      setTimeout(() => { f.classList.remove("intro"); ocupada = false; }, 1700);
    };
    if ("IntersectionObserver" in window) {
      f.classList.add("espera");
      const io = new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) { io.disconnect(); intro(); } }, { threshold: 0.6 });
      io.observe(f);
    } else intro();
    const brillar = () => {
      if (ocupada) return;
      ocupada = true;
      f.classList.add("brilla");
      setTimeout(() => { descifrar(txt, "Miembro", 30); descifrar(cero, "0", 60, 7 * 30); }, 700);
      setTimeout(() => { f.classList.remove("brilla"); ocupada = false; }, 1150);
    };
    f.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") brillar(); });
    f.addEventListener("click", () => { toque(8); brillar(); });
  }
  function presentarEmblema() {
    const e = $(".marca .emblema");
    if (!e || sinMovimiento()) return;
    e.classList.add("entra");
    setTimeout(() => e.classList.remove("entra"), 1400);
  }

  // ---------- Inicio ----------
  async function iniciar() {
    S.cfg = leerConfig();
    if (S.cfg) S.fuente = fuenteReal(S.cfg);
    else {
      await cargarScript("demo.js");
      S.fuente = fuenteDemo(window.RASTRO_DEMO);
    }
    iniciarMapa();
    enlazar();
    mapa.on("click", alTocarMapa);
    presentarEmblema();
    enlazarFirma();
    const [, lugares] = await Promise.all([actualizarEstado(), S.fuente.lugares().catch(() => [])]);
    S.lugares = lugares || [];
    const guardada = local.leer("fecha");
    const hoy = new Date(S.fuente.ahora() * 1000);
    // Al abrir: hoy (o la fecha que mirabas en las últimas horas).
    const desdeHace = Date.now() / 1000 - (local.leer("fecha_vista") || 0);
    fijarFecha(!S.fuente.demo && guardada && desdeHace < 3 * 3600 && guardada <= seg(hoy) ? new Date(guardada * 1000) : hoy);
    local.guardar("fecha_vista", Math.round(Date.now() / 1000));
    if (S.fuente.demo) renderConectar();
  }

  window.RASTRO_DEBUG = { S, get mapa() { return mapa; } };
  iniciar();
})();
