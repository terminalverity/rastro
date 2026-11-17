// Convierte los puntos crudos del teléfono en estancias (lugares donde estuviste) y trayectos (cómo te moviste).
// Sin dependencias; funciona igual en el navegador y en Node (para pruebas).
(function (global) {
  "use strict";

  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  function dist(aLat, aLon, bLat, bLon) {
    const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const dP = (a, b) => dist(a.lat, a.lon, b.lat, b.lon);
  // Distancia recorrida sin sumar el temblor del GPS: con un punto cada pocos segundos, el ruido de ±10 m
  // se acumulaba y una vuelta de una cuadra salía de 500 m. Solo cuenta un avance mayor que el error.
  function largo(path, i0, i1) {
    let d = 0, a = path[i0];
    for (let i = i0 + 1; i <= i1; i++) {
      const p = path[i], s = dP(a, p);
      if (s >= Math.max(10, Math.min(50, ((a.acc || 10) + (p.acc || 10)) / 2))) { d += s; a = p; }
    }
    return d + (i1 > i0 && a !== path[i1] ? dP(a, path[i1]) : 0);
  }

  const AJUSTES = {
    precisionMax: 150, // m: puntos peores se descartan
    gruesa: 60, // m: desde este error un punto es de wifi/antenas, no de GPS
    ventanaGps: 180, // s: si en este margen hay un punto el doble de preciso, el grueso se descarta
    radioEstancia: 70, // m: una cuadra de Lima mide ~100 m; con 100 m una salida a la esquina quedaba dentro de casa
    minEstancia: 300, // s: 5 min quieto = estancia
    unirEstancias: 600, // s: dos estancias del mismo sitio separadas por menos de esto se unen
    minTramo: 90, // s: tramos más cortos se absorben en el vecino
    velSalida: 2.5, // m/s: para estimar a qué hora saliste cuando el teléfono estaba en pausa
  };

  // ---- Limpieza ----
  function preparar(d) {
    const P = [];
    let tPrev = -1;
    for (let i = 0; i < d.n; i++) {
      const acc = d.acc[i];
      if (acc != null && acc > AJUSTES.precisionMax) continue;
      if (d.t[i] === tPrev) continue;
      tPrev = d.t[i];
      // OwnTracks repite cada tanto la última posición (misma coordenada y precisión) aunque no tenga una nueva.
      const u = P[P.length - 1];
      const eco = !!u && u.lat === d.lat[i] && u.lon === d.lon[i] && u.acc === acc;
      P.push({ t: d.t[i], lat: d.lat[i], lon: d.lon[i], acc: acc, v: d.v[i], m: d.m[i] || "", b: d.b ? d.b[i] : null, eco });
    }
    // Una repetición solo vale si el siguiente punto real confirma que seguías ahí; si aparece lejos, la repetición
    // fingía una parada (en un bus, por ejemplo) y sobra.
    const sinEcos = P.filter((p, i) => {
      if (!p.eco) return true;
      let j = i + 1;
      while (j < P.length && P[j].eco) j++;
      return j >= P.length || dP(p, P[j]) <= AJUSTES.radioEstancia;
    });
    return quitarSaltos(preferirGps(sinEcos));
  }

  // Android mezcla posiciones por wifi/antenas (error de 60–200 m, a veces siempre la misma coordenada) con las del GPS.
  // Si cerca en el tiempo hay un punto al menos el doble de preciso, el impreciso sobra: es el que dibuja picos.
  function preferirGps(P) {
    const { gruesa, ventanaGps } = AJUSTES;
    return P.filter((p, i) => {
      if (p.acc == null || p.acc < gruesa) return true;
      for (let j = i - 1; j >= 0 && p.t - P[j].t <= ventanaGps; j--) if (P[j].acc != null && P[j].acc <= p.acc / 2) return false;
      for (let j = i + 1; j < P.length && P[j].t - p.t <= ventanaGps; j++) if (P[j].acc != null && P[j].acc <= p.acc / 2) return false;
      return true;
    });
  }

  // Un punto que se aparta de la línea y vuelve, cuando recorrer ese desvío exigiría ir mucho más rápido que el trayecto,
  // es un error de posición (un bus no hace picos). Se repite porque al sacar uno cambian los vecinos.
  function quitarSaltos(P) {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const out = [];
      let quitados = 0;
      for (let i = 0; i < P.length; i++) {
        const p = P[i], a = out[out.length - 1], c = P[i + 1];
        if (a && c && c.t - a.t <= 600) {
          const dap = dP(a, p), dpc = dP(p, c), dac = dP(a, c), dt = Math.max(1, c.t - a.t);
          const desvio = dap + dpc - dac;
          const vDesvio = (dap + dpc) / dt, vRecta = dac / dt;
          const imposible = dap / Math.max(1, p.t - a.t) > 50 && dpc / Math.max(1, c.t - p.t) > 50 && vRecta < 25;
          const pico = desvio > Math.max(60, 3 * (p.acc || 15)) && vDesvio > Math.max(6, 2.5 * vRecta + 3);
          if (imposible || pico) { quitados++; continue; }
        }
        out.push(p);
      }
      P = out;
      if (!quitados) break;
    }
    return P;
  }

  const seMueve = (m) => /[dwrc]/.test(m);
  function estaQuieto(p) {
    if (seMueve(p.m)) return false;
    if (p.m.includes("s")) return true;
    return p.v == null || p.v < 0.6;
  }

  // ---- Estancias ----
  function estancias(P) {
    const { radioEstancia: radio, minEstancia: minDur } = AJUSTES;
    const E = [];
    const n = P.length;
    let i = 0;
    while (i < n) {
      let sLat = P[i].lat, sLon = P[i].lon, k = 1, j = i + 1;
      while (j < n && dist(sLat / k, sLon / k, P[j].lat, P[j].lon) <= radio) {
        sLat += P[j].lat; sLon += P[j].lon; k++; j++;
      }
      const lat = sLat / k, lon = sLon / k;
      let fin = P[j - 1].t;
      // Si después viene un hueco (el iPhone pausa el GPS cuando estás quieto), seguías ahí hasta poco antes del siguiente punto.
      if (j < n) {
        const hueco = P[j].t - P[j - 1].t;
        if (hueco > minDur) fin = Math.max(fin, P[j].t - Math.min(hueco, dist(lat, lon, P[j].lat, P[j].lon) / AJUSTES.velSalida));
      }
      // Un atasco largo dentro de un auto no es una estancia (se mide en tiempo, no en número de puntos:
      // al llegar o salir en auto hay muchos puntos seguidos pero duran segundos).
      let segAuto = 0;
      for (let x = i; x < j - 1; x++) if (P[x].m.includes("d")) segAuto += P[x + 1].t - P[x].t;
      if (fin - P[i].t >= minDur && segAuto <= (fin - P[i].t) / 2) {
        E.push({ ini: P[i].t, fin: fin, lat: lat, lon: lon, i0: i, i1: j - 1, n: k });
        i = j;
      } else i++;
    }
    // Une estancias contiguas en el mismo sitio (el GPS bajo techo a veces salta fuera del radio).
    // Solo si la distancia entre ambas cabe en el error del GPS: con buena señal, 100 m es una salida de verdad.
    const precision = (e) => {
      const a = [];
      for (let x = e.i0; x <= e.i1; x++) if (P[x].acc != null && !P[x].virtual) a.push(P[x].acc);
      if (!a.length) return 25;
      a.sort((p, q) => p - q);
      return a[a.length >> 1];
    };
    for (const e of E) e.acc = precision(e);
    const M = [];
    for (const e of E) {
      const u = M[M.length - 1];
      // El teléfono calló un rato y reapareció cerca, sin ningún punto en movimiento entre medio: no hay salida que mostrar
      // (si no, sale un «viaje» falso de pocos metros). Con puntos seguidos, en cambio, una cuadra sí es una salida.
      const silencio = u && e.i0 - u.i1 <= 1 && P[e.i0].t - P[u.i1].t >= minDur;
      const juntar = u && (silencio ? radio * 2 : Math.min(radio * 1.5, Math.max(radio * 0.5, 2.5 * Math.max(u.acc, e.acc))));
      if (u && e.ini - u.fin < AJUSTES.unirEstancias && dist(u.lat, u.lon, e.lat, e.lon) < juntar) {
        u.lat = (u.lat * u.n + e.lat * e.n) / (u.n + e.n);
        u.lon = (u.lon * u.n + e.lon * e.n) / (u.n + e.n);
        u.n += e.n; u.fin = e.fin; u.i1 = e.i1;
      } else M.push(Object.assign({}, e));
    }
    return M;
  }

  // ---- Modo de cada punto y tramos ----
  function modoPunto(p, vCalc) {
    // Android manda velocidad 0 cuando no la conoce: sin letras de movimiento, manda la calculada entre puntos.
    const v = p.v != null && (p.v > 0 || p.m || vCalc == null) ? p.v : vCalc;
    const m = p.m;
    if (m.includes("c")) return "bici";
    if (m.includes("d")) return "vehiculo";
    if (m.includes("w") || m.includes("r")) return v != null && v > 7 ? "vehiculo" : "pie";
    if (v == null || v < 0.4) return "parado";
    if (v < 2.5) return "pie";
    return "vehiculo";
  }

  function tramos(path) {
    if (path.length < 2) return [];
    // Velocidad calculada centrada (punto anterior → siguiente): suaviza el pare-y-siga del tráfico.
    const et = path.map((p, i) => {
      const a = path[i - 1] || p, c = path[i + 1] || p;
      const vCalc = a !== c ? dP(a, c) / Math.max(1, c.t - a.t) : null;
      return modoPunto(p, vCalc);
    });
    // Los puntos "parado" (semáforos, esperas) toman el modo del vecino.
    let ultimo = et.find((x) => x !== "parado") || "desconocido";
    for (let i = 0; i < et.length; i++) {
      if (et[i] === "parado") et[i] = ultimo; else ultimo = et[i];
    }
    let runs = [];
    for (let i = 0; i < et.length; i++) {
      const r = runs[runs.length - 1];
      if (r && r.modo === et[i]) r.i1 = i; else runs.push({ modo: et[i], i0: i, i1: i });
    }
    const dur = (r) => path[r.i1].t - path[r.i0].t + (r.i1 + 1 < path.length ? path[r.i1 + 1].t - path[r.i1].t : 0);
    // Absorbe tramos muy cortos en el vecino más largo.
    let cambio = true;
    while (cambio && runs.length > 1) {
      cambio = false;
      let peor = -1, durPeor = Infinity;
      runs.forEach((r, k) => { const d = dur(r); if (d < AJUSTES.minTramo && d < durPeor) { peor = k; durPeor = d; } });
      if (peor >= 0) {
        const r = runs[peor], a = runs[peor - 1], b = runs[peor + 1];
        const dest = !a ? b : !b ? a : dur(a) >= dur(b) ? a : b;
        dest.i0 = Math.min(dest.i0, r.i0); dest.i1 = Math.max(dest.i1, r.i1);
        runs.splice(peor, 1);
        // Junta vecinos que quedaron con el mismo modo.
        const J = [];
        for (const x of runs) { const u = J[J.length - 1]; if (u && u.modo === x.modo) u.i1 = x.i1; else J.push(x); }
        runs = J;
        cambio = true;
      }
    }
    // Sin sensor de movimiento (Android), un tramo «a pie» entre dos en vehículo, sin parada entre medio, es tráfico lento si dura menos de 8 min
    // o si tiene arrancones que nadie hace caminando (dos o más pasos a más de 16 km/h, más largos que el error del GPS).
    const arrancones = (r) => {
      let n = 0;
      for (let i = Math.max(1, r.i0); i <= r.i1 + 1 && i < path.length; i++) {
        const a = path[i - 1], b = path[i], dt = b.t - a.t;
        const d = dP(a, b), err = Math.max(a.acc || 20, b.acc || 20);
        if (dt >= 4 && err <= 55 && d > 1.5 * err && d / dt > 4.5) n++;
      }
      return n;
    };
    for (let k = 1; k < runs.length - 1; k++) {
      const r = runs[k];
      if (r.modo === "pie" && runs[k - 1].modo === "vehiculo" && runs[k + 1].modo === "vehiculo" && (dur(r) < 480 || arrancones(r) >= 2) &&
          !path.slice(r.i0, r.i1 + 1).some((p) => /[wr]/.test(p.m))) r.modo = "vehiculo";
    }
    const J = [];
    for (const x of runs) { const u = J[J.length - 1]; if (u && u.modo === x.modo) u.i1 = x.i1; else J.push(x); }
    runs = J;
    return runs.map((r, k) => {
      const fin = k + 1 < runs.length ? runs[k + 1].i0 : r.i1;
      return { modo: r.modo, ini: path[r.i0].t, fin: path[fin].t, dist: largo(path, r.i0, fin), i0: r.i0, i1: fin };
    });
  }

  // Tramos acotados al trayecto: el primer punto suele ser el último de la estancia anterior
  // (con el teléfono quieto puede ser de horas antes) y no debe contar como tiempo en movimiento.
  function tramosEn(path, ini, fin) {
    const T = tramos(path);
    for (const t of T) { t.ini = Math.min(Math.max(t.ini, ini), fin); t.fin = Math.max(Math.min(t.fin, fin), t.ini); }
    const utiles = T.filter((t) => t.fin > t.ini);
    return utiles.length ? utiles : T.slice(0, 1);
  }

  function trayecto(path, ini, fin, abiertoIni, abiertoFin) {
    const d = largo(path, 0, path.length - 1);
    const T = tramosEn(path, ini, fin);
    const porModo = {};
    for (const t of T) porModo[t.modo] = (porModo[t.modo] || 0) + (t.fin - t.ini);
    let modo = "desconocido", max = -1;
    for (const k in porModo) if (porModo[k] > max) { max = porModo[k]; modo = k; }
    // Nadie camina a más de 8 km/h de promedio: con puntos escasos (modo Ahorro) el trayecto es en vehículo.
    if (modo === "pie" && fin > ini && d / (fin - ini) > 2.2) {
      modo = "vehiculo";
      // Y el mapa debe decir lo mismo que la lista: sin tramos en vehículo, los «a pie» pasan a vehículo.
      if (T.every((t) => t.modo !== "vehiculo")) for (const t of T) if (t.modo === "pie") t.modo = "vehiculo";
    }
    const sinDatos = path.length <= 2 && fin - ini > 120;
    return { tipo: "trayecto", ini: ini, fin: fin, dist: d, path: path, tramos: T, modo: sinDatos ? "desconocido" : modo, sinDatos: sinDatos, abiertoIni: !!abiertoIni, abiertoFin: !!abiertoFin };
  }

  // ---- Todo junto ----
  function analizar(datos, opciones) {
    opciones = opciones || {};
    const P = preparar(datos);
    const ahora = opciones.ahora;
    let enVivo = null;
    if (P.length && ahora && ahora > P[P.length - 1].t) {
      const u = P[P.length - 1];
      if (estaQuieto(u)) {
        P.push({ t: ahora, lat: u.lat, lon: u.lon, acc: u.acc, v: 0, m: "s", b: u.b, virtual: true });
        enVivo = { quieto: true, desde: u.t };
      } else enVivo = { quieto: false, desde: u.t };
    }
    const E = estancias(P);
    const items = [];
    let prev = null;
    for (const e of E) {
      if (prev) {
        const path = P.slice(prev.i1, e.i0 + 1);
        items.push(trayecto(path, prev.fin, e.ini));
      } else if (e.i0 > 0) {
        items.push(trayecto(P.slice(0, e.i0 + 1), P[0].t, e.ini, true, false));
      }
      items.push({ tipo: "estancia", ini: e.ini, fin: e.fin, lat: e.lat, lon: e.lon, n: e.n, i0: e.i0, i1: e.i1, sigue: !!(P[e.i1] && P[e.i1].virtual) });
      prev = e;
    }
    const desdeIdx = prev ? prev.i1 : 0;
    if (P.length - 1 > desdeIdx || (!prev && P.length > 1)) {
      const path = P.slice(desdeIdx);
      if (path.length > 1) items.push(trayecto(path, prev ? prev.fin : P[0].t, P[P.length - 1].t, !prev, true));
    }
    return { puntos: P, items: items, enVivo: enVivo };
  }

  // Recorta al día [a, b): lo que empezó antes o termina después queda marcado.
  function delDia(an, a, b) {
    const out = [];
    for (const it of an.items) {
      if (it.fin <= a || it.ini >= b) continue;
      const c = Object.assign({}, it);
      c.cortaIni = it.ini < a;
      c.cortaFin = it.fin > b;
      c.ini = Math.max(it.ini, a);
      c.fin = Math.min(it.fin, b);
      if (it.tipo === "trayecto") {
        const path = it.path.filter((p) => p.t >= a && p.t < b);
        if (c.cortaIni || c.cortaFin) {
          c.path = path.length ? path : it.path;
          c.dist = largo(c.path, 0, c.path.length - 1);
          c.tramos = tramosEn(c.path, c.ini, c.fin);
        }
      }
      if (c.fin - c.ini < 30 && it.tipo === "trayecto") continue;
      out.push(c);
    }
    return out;
  }

  function resumen(items) {
    const r = { dist: 0, mov: 0, quieto: 0, lugares: 0, porModo: {} };
    for (const it of items) {
      if (it.tipo === "estancia") { r.quieto += it.fin - it.ini; r.lugares++; continue; }
      r.dist += it.dist;
      r.mov += it.fin - it.ini;
      for (const t of it.tramos) {
        const m = r.porModo[t.modo] || (r.porModo[t.modo] = { dist: 0, seg: 0 });
        m.dist += t.dist; m.seg += t.fin - t.ini;
      }
    }
    return r;
  }

  // ---- Formas de los lugares ----
  // Plano local en metros alrededor de un punto (basta para lugares de unos pocos km).
  function aPlano(lat0, lon0) {
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
    return (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
  }
  // Distancia en metros de un punto a un contorno: 0 si está dentro.
  function distContorno(lat, lon, contorno) {
    const pl = aPlano(lat, lon);
    const V = contorno.map((v) => pl(v[0], v[1]));
    let dentro = false, dmin = Infinity;
    for (let i = 0, j = V.length - 1; i < V.length; j = i++) {
      const [xi, yi] = V[i], [xj, yj] = V[j];
      if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) dentro = !dentro;
      const dx = xj - xi, dy = yj - yi, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(xi * dx + yi * dy) / L2)) : 0;
      dmin = Math.min(dmin, Math.hypot(xi + t * dx, yi + t * dy));
    }
    return dentro ? 0 : dmin;
  }
  function areaContorno(contorno) {
    const pl = aPlano(contorno[0][0], contorno[0][1]);
    const V = contorno.map((v) => pl(v[0], v[1]));
    let a = 0;
    for (let i = 0, j = V.length - 1; i < V.length; j = i++) a += V[j][0] * V[i][1] - V[i][0] * V[j][1];
    return Math.abs(a) / 2;
  }
  const tieneContorno = (l) => Array.isArray(l.contorno) && l.contorno.length >= 3;

  // Lugar con nombre que contiene la posición. Con contorno: dentro o a menos de 20 m del borde (error del GPS);
  // con círculo: dentro del radio más 30 m. Si varios la contienen (una casa dentro de un parque), gana el más chico.
  function lugarDe(lat, lon, lugares) {
    let mejor = null, fueraMejor = Infinity, areaMejor = Infinity;
    for (const l of lugares || []) {
      let fuera, area;
      if (tieneContorno(l)) {
        fuera = distContorno(lat, lon, l.contorno);
        if (fuera > 20) continue;
        area = l._area || (l._area = areaContorno(l.contorno));
      } else {
        const r = l.radio_m || 120;
        const d = dist(lat, lon, l.lat, l.lon);
        if (d > r + 30) continue;
        fuera = Math.max(0, d - r);
        area = Math.PI * r * r;
      }
      if (fuera < fueraMejor - 1e-9 || (Math.abs(fuera - fueraMejor) < 1e-9 && area < areaMejor)) { mejor = l; fueraMejor = fuera; areaMejor = area; }
    }
    return mejor;
  }

  // Agrupa estancias de muchos días en lugares frecuentes.
  function lugaresFrecuentes(items, lugares, radio) {
    radio = radio || 150;
    const C = [];
    const est = items.filter((x) => x.tipo === "estancia").sort((a, b) => (b.fin - b.ini) - (a.fin - a.ini));
    for (const e of est) {
      const nombrado = lugarDe(e.lat, e.lon, lugares);
      let c = nombrado ? C.find((x) => x.lugar === nombrado) : C.find((x) => !x.lugar && dist(x.lat, x.lon, e.lat, e.lon) < radio);
      if (!c) { c = { lat: e.lat, lon: e.lon, seg: 0, visitas: [], lugar: nombrado }; C.push(c); }
      const w = Math.max(1, e.fin - e.ini);
      c.lat = (c.lat * c.seg + e.lat * w) / (c.seg + w);
      c.lon = (c.lon * c.seg + e.lon * w) / (c.seg + w);
      c.seg += w;
      c.visitas.push(e);
    }
    for (const c of C) {
      c.visitas.sort((a, b) => a.ini - b.ini);
      c.ultima = c.visitas[c.visitas.length - 1].fin;
      if (c.lugar) { c.lat = c.lugar.lat; c.lon = c.lugar.lon; }
    }
    return C.sort((a, b) => b.seg - a.seg);
  }

  const api = { dist, preparar, estancias, tramos, analizar, delDia, resumen, lugarDe, lugaresFrecuentes, distContorno, areaContorno, AJUSTES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.Analisis = api;
})(typeof window !== "undefined" ? window : globalThis);
