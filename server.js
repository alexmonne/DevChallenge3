const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Dificultades de bots
// ---------------------------------------------------------------------------
const DIFICULTADES = [
  { id: 'facil', nombre: 'Fácil', velocidad: 2.5, reaccion: 60, radioObjeto: 220, ruido: 0.5 },
  { id: 'medio', velocidad: 5, reaccion: 45, radioObjeto: 300, ruido: 0.25 },
  { id: 'dificil', velocidad: 7.5, reaccion: 30, radioObjeto: 450, ruido: 0.08 },
  { id: 'extremo', velocidad: 9.5, reaccion: 12, radioObjeto: Infinity, ruido: 0 }
];
const DIFICULTAD_DEFAULT = 'medio';

function dificultadDeSala(sala) {
  return DIFICULTADES.find(d => d.id === sala.dificultad) || DIFICULTADES.find(d => d.id === DIFICULTAD_DEFAULT);
}

// ---------------------------------------------------------------------------
// Habilidades y personajes (solo se muestra el ROL al usuario)
// ---------------------------------------------------------------------------
const HABLIDADES = {
  obstruir: { id: 'obstruir', nombre: 'Obstruir', descripcion: 'Pone una barrera temporal que bloquea el paso de los demás' },
  promocionar: { id: 'promocionar', nombre: 'Promoción', descripcion: 'Contabiliza el doble de contratos al recogerlos mientras está activa' }
};

const PERSONAJES = [
  { nombre: 'Severo', rol: 'Arquitecto Jefe', color: '#2ecc71', avatar: '🏗️' },
  { nombre: 'Nígel', rol: 'Aparejadora', color: '#e67e22', avatar: '👷‍♀️' },
  { nombre: 'Gragras', rol: 'Jefe de Obra', color: '#c0392b', avatar: '👨‍🏭' },
  { nombre: 'Inés', rol: 'Diseñadora', color: '#2980b9', avatar: '👩‍🎨' },
  { nombre: 'Larin', rol: 'Sablador', color: '#f39c12', avatar: '👨‍🔧' },
  { nombre: 'Alfonso', rol: 'Promotor', color: '#95a5a6', avatar: '💼' },
  { nombre: 'Aarón', rol: 'Salvador', color: '#e74c3c', avatar: '🦺' },
  { nombre: 'Marta', rol: 'Topógrafo', color: '#27ae60', avatar: '🧭' },
  { nombre: 'Pedro', rol: 'Oficial Primera', color: '#3498db', avatar: '🔨' },
  { nombre: 'Domingo', rol: 'Delineante', color: '#8e44ad', avatar: '📐' },
  { nombre: 'Yara', rol: 'Ingeniera', color: '#16a085', avatar: '👩‍🔧' },
  { nombre: 'César', rol: 'Becario', color: '#7f8c8d', avatar: '📋' },
  { nombre: 'Estefanía', rol: 'Inspectora', color: '#d35400', avatar: '🔍' },
  { nombre: 'Mateo', rol: 'Constructora', color: '#c0392b', avatar: '🚧' },
  { nombre: 'Teresa', rol: 'Oficial de Seguridad', color: '#9b59b6', avatar: '🛠️' }
];

// ---------------------------------------------------------------------------
// Constantes del mapa y juego
// ---------------------------------------------------------------------------
const MAP_SIZE = 2400;
const CONTRATOS_TOTAL = 50;
const CONTRATOS_MAX = 60;
const CONTRATOS_GANAR = 20;
const CONTRATO_RESPAWN_MS = 2000;   // respawn 2s tras recogida
const TRAMPAS_TOTAL = 36;
const COFRES_TOTAL = 3;
const COFRE_RESPAWN_MS = 15000;

const TRAMPA_TIEMPO = { inspeccion: 5000, cemento: 4000, multa: 4000, luz: 5000 };
const PICKUP_RADIUS = 40; // radio efectivo de recogida (centro a centro)

const salas = {};

app.post('/api/game/finish', (req, res) => {
  const { sala, jugadores } = req.body;
  if (!sala || !jugadores || !Array.isArray(jugadores)) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  const ranking = [...jugadores]
    .filter(j => j.contratos > 0)
    .sort((a, b) => b.contratos - a.contratos || (a.tiempo || 0) - (b.tiempo || 0))
    .slice(0, 3)
    .map((j, i) => ({
      puesto: i + 1,
      jugador: j.nombre,
      personaje: j.personaje,
      contratos: j.contratos,
      tiempo: j.tiempo || 0
    }));
  res.json({ podio: ranking, sala, estado: 'oficial', timestamp: Date.now() });
});

function generarCodigoSala() {
  let codigo;
  do {
    codigo = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (salas[codigo]);
  return codigo;
}

function rectaSolapada(r1, r2) {
  return r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
}

function colisionRect(r1, r2) {
  return r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
}

// Posición libre de paredes y de otros objetos
function posicionLibre(mapa, excluir = []) {
  const margin = 100;
  for (let intentos = 0; intentos < 100; intentos++) {
    const x = margin + Math.random() * (MAP_SIZE - margin * 2 - 30);
    const y = margin + Math.random() * (MAP_SIZE - margin * 2 - 30);
    const okPared = mapa.paredes.every(p => !rectaSolapada({ x, y, w: 30, h: 30 }, p));
    const okResto = excluir.every(o => !rectaSolapada({ x, y, w: 30, h: 30 }, o));
    if (okPared && okResto) return { x, y };
  }
  return null;
}

function mapaExcluir(mapa) {
  return [
    ...mapa.contratos.filter(c => !c.recogido).map(c => ({ x: c.x - 12, y: c.y - 12, w: 24, h: 24 })),
    ...mapa.trampas.filter(t => t.activa).map(t => ({ x: t.x - 10, y: t.y - 10, w: 20, h: 20 })),
    ...mapa.cofres.filter(c => c.activa && !c.recogido).map(c => ({ x: c.x - 12, y: c.y - 12, w: 24, h: 24 }))
  ];
}

function generarMapa(numSpawns) {
  const spawns = [];
  const margin = 250;
  const cols = Math.ceil(Math.sqrt(numSpawns));
  const rows = Math.ceil(numSpawns / cols);
  const stepX = (MAP_SIZE - margin * 2) / cols;
  const stepY = (MAP_SIZE - margin * 2) / rows;
  for (let i = 0; i < numSpawns; i++) {
    spawns.push({
      x: margin + (i % cols) * stepX + stepX / 2,
      y: margin + Math.floor(i / cols) * stepY + stepY / 2
    });
  }

  const paredes = [];
  const numParedes = 45;
  for (let i = 0; i < numParedes && paredes.length < numParedes; i++) {
    for (let intentos = 0; intentos < 20; intentos++) {
      const p = {
        id: 'p' + i,
        x: Math.floor(Math.random() * (MAP_SIZE - 300)),
        y: Math.floor(Math.random() * (MAP_SIZE - 300)),
        w: 50 + Math.random() * 120,
        h: 50 + Math.random() * 120,
        tipo: Math.random() > 0.5 ? 'muro' : 'valla'
      };
      const avoid = spawns.some(s => rectaSolapada(
        { x: p.x - 35, y: p.y - 35, w: p.w + 70, h: p.h + 70 },
        { x: s.x - 35, y: s.y - 35, w: 70, h: 70 }
      ));
      if (!paredes.some(p2 => rectaSolapada(p, p2)) && !avoid) {
        paredes.push(p);
        break;
      }
    }
  }

  const contratos = [];
  for (let i = 0; i < CONTRATOS_TOTAL; i++) {
    const pos = posicionLibre({ paredes, spawns }, contratos.map(c => ({ x: c.x - 12, y: c.y - 12, w: 24, h: 24 })));
    const x = pos ? pos.x : margin + Math.random() * (MAP_SIZE - margin * 2);
    const y = pos ? pos.y : margin + Math.random() * (MAP_SIZE - margin * 2);
    contratos.push({ id: 'c' + i, x, y, recogido: false });
  }

  const tiposTrampa = ['inspeccion', 'cemento', 'multa', 'luz'];
  const emojisTrampa = { inspeccion: '👮‍♂️', cemento: '🥣', multa: '💸', luz: '🔌' };
  const trampas = [];
  for (let i = 0; i < TRAMPAS_TOTAL; i++) {
    const tipo = tiposTrampa[i % tiposTrampa.length];
    const pos = posicionLibre({ paredes, spawns }, trampas.map(t => ({ x: t.x - 10, y: t.y - 10, w: 20, h: 20 })));
    const x = pos ? pos.x : margin + Math.random() * (MAP_SIZE - margin * 2);
    const y = pos ? pos.y : margin + Math.random() * (MAP_SIZE - margin * 2);
    trampas.push({ id: 't' + i, tipo, emoji: emojisTrampa[tipo], x, y, activa: true });
  }

  const cofres = [];
  const excluirCofres = trampas.map(t => ({ x: t.x - 12, y: t.y - 12, w: 24, h: 24 }));
  for (let i = 0; i < COFRES_TOTAL; i++) {
    const pos = posicionLibre({ paredes, spawns }, excluirCofres);
    const x = pos ? pos.x : margin + Math.random() * (MAP_SIZE - margin * 2);
    const y = pos ? pos.y : margin + Math.random() * (MAP_SIZE - margin * 2);
    if (pos) excluirCofres.push({ x: x - 12, y: y - 12, w: 24, h: 24 });
    cofres.push({ id: 'k' + i, x, y, activa: true, recogido: false, reaparicion: 0 });
  }

  return { paredes, spawns, contratos, trampas, cofres };
}

// ---------------------------------------------------------------------------
// Trampas y cofres
// ---------------------------------------------------------------------------
function aplicarTrampa(jugador, tipo, codigo) {
  const sala = salas[codigo];
  if (!sala) return;
  const mapa = sala.partida.mapa;
  if (tipo === 'inspeccion') {
    jugador.efectoCongelado = true;
    setTimeout(() => { jugador.efectoCongelado = false; }, TRAMPA_TIEMPO.inspeccion);
  } else if (tipo === 'cemento') {
    jugador.efectoCemento = true;
    setTimeout(() => { jugador.efectoCemento = false; }, TRAMPA_TIEMPO.cemento);
  } else if (tipo === 'multa') {
    const perder = Math.min(4, jugador.contratos);
    jugador.contratos -= perder;
    for (let k = 0; k < perder; k++) {
      const pos = posicionLibre(mapa, mapaExcluir(mapa));
      if (pos) {
        const contratoNuevo = { id: 'cR_' + Date.now() + '_' + k, x: pos.x, y: pos.y, recogido: false };
        mapa.contratos.push(contratoNuevo);
        io.to(codigo).emit('contratoCreado', { contratoId: contratoNuevo.id, x: pos.x, y: pos.y });
      }
    }
    io.to(codigo).emit('contratosPerdidos', { jugadorId: jugador.id, contratos: jugador.contratos, perder });
  } else if (tipo === 'luz') {
    jugador.efectoLuz = true;
    setTimeout(() => { jugador.efectoLuz = false; }, TRAMPA_TIEMPO.luz);
  }
}

function recogerCofre(sala, jugadorId, cofre, codigo) {
  cofre.activa = false;
  cofre.recogido = true;
  cofre.reaparicion = Date.now() + COFRE_RESPAWN_MS;

  const jugador = sala.jugadores.find(j => j.id === jugadorId);
  const nombreJugador = jugador ? jugador.nombre : '';

  const r = Math.random();
  let tipo;
  if (r < 0.35) tipo = 'cemento';
  else if (r < 0.70) tipo = 'luz';
  else if (r < 0.90) tipo = 'inspeccion';
  else tipo = 'multa';

  sala.jugadores.forEach(other => {
    if (other.id === jugadorId) return;
    aplicarTrampa(other, tipo, codigo);
  });

  io.to(codigo).emit('cofreRecogido', { cofreId: cofre.id, jugadorId, nombre: nombreJugador, tipo });
}

// ---------------------------------------------------------------------------
// IA de bots
// ---------------------------------------------------------------------------
function buscarObjetivoBot(sala, j, confDif, tipoObjeto = 'contrato') {
  let objetivo = null;
  let mejorDistancia = Infinity;
  const lista = tipoObjeto === 'contrato'
    ? sala.partida.mapa.contratos.filter(c => !c.recogido)
    : tipoObjeto === 'cofre'
      ? sala.partida.mapa.cofres.filter(c => c.activa && !c.recogido)
      : [];
  for (const obj of lista) {
    const d = Math.hypot(j.x - obj.x, j.y - obj.y);
    if (d <= confDif.radioObjeto && d < mejorDistancia) {
      mejorDistancia = d;
      objetivo = obj;
    }
  }
  return { objetivo, mejorDistancia };
}

// Ángulos de escape en abanico cuando hay colisión inminente
const ANGULOS_ESCAPE = [35, -35, 70, -70, 110, -110, 150];

function decidirDireccionBot(sala, j) {
  const confDif = dificultadDeSala(sala);
  const { objetivo, mejorDistancia } = buscarObjetivoBot(sala, j, confDif, 'contrato');

  let angulo;
  if (objetivo && mejorDistancia > 0) {
    angulo = Math.atan2(objetivo.y - j.y, objetivo.x - j.x);
    angulo += (Math.random() - 0.5) * confDif.ruido * 2;
  } else {
    angulo = Math.random() * Math.PI * 2;
  }

  const sensor = 14 + 15 + Math.max(1, confDif.velocidad) * 2; // radio + margen 15px
  const pruebaDireccion = (a) => {
    const dx = Math.cos(a), dy = Math.sin(a);
    const rx = j.x + dx * sensor, ry = j.y + dy * sensor;
    const rrect = { x: rx - 12, y: ry - 12, w: 24, h: 24 };
    for (const pared of sala.partida.mapa.paredes) {
      if (colisionRect(rrect, pared)) return false;
    }
    // bordes del mapa
    if (rx < 10 || rx > MAP_SIZE - 10 || ry < 10 || ry > MAP_SIZE - 10) return false;
    return true;
  };

  let dirX = Math.cos(angulo), dirY = Math.sin(angulo);
  if (!pruebaDireccion(angulo)) {
    for (const deg of ANGULOS_ESCAPE) {
      const a = angulo + (deg * Math.PI / 180);
      if (pruebaDireccion(a)) { dirX = Math.cos(a); dirY = Math.sin(a); break; }
    }
    // si ninguno sirve, buscar cualquiera de 360°
    if (dirX === Math.cos(angulo) && dirY === Math.sin(angulo) && !pruebaDireccion(angulo)) {
      for (let k = 0; k < 12; k++) {
        const a = angulo + (k * 30 * Math.PI / 180);
        if (pruebaDireccion(a)) { dirX = Math.cos(a); dirY = Math.sin(a); break; }
      }
    }
  }

  const norm = Math.hypot(dirX, dirY) || 1;
  j.dirX = dirX / norm;
  j.dirY = dirY / norm;
  j.cambiarDir = confDif.reaccion + Math.floor(Math.random() * 20);
}

// ---------------------------------------------------------------------------
// Bucle de juego
// ---------------------------------------------------------------------------
function iniciarLoopJuego(codigo) {
  const intervalo = setInterval(() => {
    const sala = salas[codigo];
    if (!sala || sala.estado !== 'juego') { clearInterval(intervalo); return; }
    if (sala.partida.pausada) return;

    const confDif = dificultadDeSala(sala);
    const mapaDin = sala.partida.mapa;
    const ahora = Date.now();

    // Spawn dinámico de contratos (máximo CONTRATOS_MAX)
    if (mapaDin.contratos.filter(c => !c.recogido).length < CONTRATOS_MAX &&
      ahora - sala.partida.ultimoSpawnContrato > sala.partida.intervaloSpawnContrato) {
      sala.partida.ultimoSpawnContrato = ahora;
      sala.partida.intervaloSpawnContrato = Math.max(4000, sala.partida.intervaloSpawnContrato - 500);
      const pos = posicionLibre(mapaDin, mapaExcluir(mapaDin));
      if (pos) {
        const contratoNuevo = { id: 'cDyn_' + ahora + '_' + Math.floor(Math.random() * 1000), x: pos.x, y: pos.y, recogido: false };
        mapaDin.contratos.push(contratoNuevo);
        io.to(codigo).emit('contratoCreado', { contratoId: contratoNuevo.id, x: pos.x, y: pos.y });
      }
    }

    // Respawn de contratos recogidos (2s, nunca desaparecen solos)
    mapaDin.contratos.forEach(c => {
      if (c.recogido && c.reaparicion && ahora > c.reaparicion) {
        const pos = posicionLibre(mapaDin, mapaExcluir(mapaDin));
        if (pos) {
          c.x = pos.x; c.y = pos.y; c.recogido = false; c.reaparicion = 0;
          io.to(codigo).emit('contratoCreado', { contratoId: c.id, x: pos.x, y: pos.y });
        }
      }
    });

    // Respawn de cofres (15s)
    mapaDin.cofres.forEach(cofre => {
      if (cofre.recogido && cofre.reaparicion && ahora > cofre.reaparicion) {
        const pos = posicionLibre(mapaDin, mapaExcluir(mapaDin));
        if (pos) {
          cofre.x = pos.x; cofre.y = pos.y; cofre.activa = true; cofre.recogido = false; cofre.reaparicion = 0;
          io.to(codigo).emit('cofreCreado', { cofreId: cofre.id, x: pos.x, y: pos.y });
        }
      }
    });

    sala.jugadores.forEach(j => {
      if (!j.bot || sala.partida.fin) return;
      if (j.efectoCongelado) return;

      // ----- Anti-atasco: registrar posici?n cada 0.5s -----
      if (!j._ultimoCheck) j._ultimoCheck = ahora;
      if (ahora - j._ultimoCheck >= 500) {
        if (!j._ultimaPos) j._ultimaPos = { x: j.x, y: j.y };
        const movido = Math.hypot(j.x - j._ultimaPos.x, j.y - j._ultimaPos.y);
        if (movido < 10) {
          j._escapeHasta = ahora + 800;
          const base = Math.atan2(j.dirY || 0, j.dirX || 1);
          const escape = base + Math.PI / 2 + (Math.random() > 0.5 ? Math.PI : 0);
          j.dirX = Math.cos(escape); j.dirY = Math.sin(escape);
          j.cambiarDir = 12;
        }
        j._ultimaPos = { x: j.x, y: j.y };
        j._ultimoCheck = ahora;
      }
      if (j._escapeHasta && ahora < j._escapeHasta) j.cambiarDir = Math.max(j.cambiarDir, 1);
      else if (j._escapeHasta && ahora >= j._escapeHasta) j._escapeHasta = 0;

      if (j.cambiarDir <= 0) decidirDireccionBot(sala, j);
      j.cambiarDir--;

      let vel = j.efectoCemento ? confDif.velocidad * 0.5 : confDif.velocidad;
      let nx = j.x + j.dirX * vel;
      let ny = j.y + j.dirY * vel;
      const rect = { x: nx - 14, y: ny - 14, w: 28, h: 28 };
      let col = false;
      for (const pared of mapaDin.paredes) {
        if (colisionRect(rect, { x: pared.x - 2, y: pared.y - 2, w: pared.w + 4, h: pared.h + 4 })) { col = true; break; }
      }
      if (!col && nx >= 10 && nx <= MAP_SIZE - 10 && ny >= 10 && ny <= MAP_SIZE - 10) {
        j.x = nx;
        j.y = ny;
      } else {
        j.cambiarDir = 0;
        decidirDireccionBot(sala, j);
        const nx2 = j.x + j.dirX * vel;
        const ny2 = j.y + j.dirY * vel;
        const rect2 = { x: nx2 - 14, y: ny2 - 14, w: 28, h: 28 };
        let col2 = false;
        for (const pared of mapaDin.paredes) {
          if (colisionRect(rect2, { x: pared.x - 2, y: pared.y - 2, w: pared.w + 4, h: pared.h + 4 })) { col2 = true; break; }
        }
        if (!col2 && nx2 >= 10 && nx2 <= MAP_SIZE - 10 && ny2 >= 10 && ny2 <= MAP_SIZE - 10) {
          j.x = nx2; j.y = ny2;
        }
      }

      // Evadir trampas (Medio+)
      if (confDif.id !== 'facil') {
        for (const t of mapaDin.trampas) {
          if (t.activa && Math.hypot(j.x - t.x, j.y - t.y) <= 40) {
            const dx = j.x - t.x, dy = j.y - t.y;
            const d = Math.hypot(dx, dy) || 1;
            j.dirX = dx / d; j.dirY = dy / d;
            j.cambiarDir = 0;
          }
        }
      }

      // Ir por cofres (Medio+)
      if (confDif.id !== 'facil') {
        const { objetivo: cofreObj } = buscarObjetivoBot(sala, j, confDif, 'cofre');
        if (cofreObj && Math.hypot(j.x - cofreObj.x, j.y - cofreObj.y) < confDif.radioObjeto) {
          const a = Math.atan2(cofreObj.y - j.y, cofreObj.x - j.x);
          j.dirX = Math.cos(a); j.dirY = Math.sin(a);
          j.cambiarDir = 0;
        }
      }

      // Recoger contratos (bot)
      for (const contrato of mapaDin.contratos) {
        if (!contrato.recogido && Math.hypot(j.x - contrato.x, j.y - contrato.y) < PICKUP_RADIUS) {
          contrato.recogido = true;
          contrato.reaparicion = ahora + CONTRATO_RESPAWN_MS;
          const ganancia = (j.habilidadActiva && j.habilidad && j.habilidad.id === 'promocionar') ? 2 : 1;
          j.contratos += ganancia;
          sala.partida.contratosRecogidos[contrato.id] = j.id;
          io.to(codigo).emit('contratoRecogido', { contratoId: contrato.id, jugadorId: j.id, contratos: j.contratos });
          if (j.contratos >= CONTRATOS_GANAR && !sala.partida.fin) {
            sala.partida.fin = true; sala.partida.ganador = j; finalizarPartida(codigo);
          }
        }
      }

      // Recoger cofres (bot)
      for (const cofre of mapaDin.cofres) {
        if (cofre.activa && !cofre.recogido && Math.hypot(j.x - cofre.x, j.y - cofre.y) < PICKUP_RADIUS) {
          recogerCofre(sala, j.id, cofre, codigo);
        }
      }

      // Pisar trampas (bot)
      for (const trampa of mapaDin.trampas) {
        if (trampa.activa && Math.hypot(j.x - trampa.x, j.y - trampa.y) < PICKUP_RADIUS) {
          trampa.activa = false;
          aplicarTrampa(j, trampa.tipo, codigo);
          io.to(codigo).emit('trampaPisada', { trampaId: trampa.id, jugadorId: j.id, tipo: trampa.tipo });
        }
      }
    });

    if (!sala.partida.fin) {
      io.to(codigo).emit('estadoJuego', {
        jugadores: sala.jugadores.map(j => ({
          id: j.id, nombre: j.nombre, personaje: j.personaje, rol: j.rol || null,
          color: j.color, avatar: j.avatar, x: j.x, y: j.y,
          contratos: j.contratos, bot: j.bot,
          efectoCongelado: j.efectoCongelado, efectoCemento: j.efectoCemento, efectoLuz: j.efectoLuz,
          habilidadActiva: !!j.habilidadActiva
        })),
        contratos: mapaDin.contratos.map(c => ({ id: c.id, x: c.x, y: c.y, recogido: c.recogido })),
        trampas: mapaDin.trampas.map(t => ({ id: t.id, tipo: t.tipo, x: t.x, y: t.y, activa: t.activa })),
        cofres: mapaDin.cofres.map(c => ({ id: c.id, x: c.x, y: c.y, activa: c.activa && !c.recogido }))
      });
    }
  }, 1000 / 30);
}

function finalizarPartida(codigo) {
  const sala = salas[codigo];
  if (!sala) return;
  sala.estado = 'fin';
  const jugadoresRanking = sala.jugadores
    .sort((a, b) => b.contratos - a.contratos)
    .map(j => ({
      nombre: j.nombre, personaje: j.personaje, rol: j.rol || null,
      contratos: j.contratos, avatar: j.avatar, bot: j.bot
    }));
  io.to(codigo).emit('partidaFinalizada', {
    podio: jugadoresRanking.slice(0, 3), sala: codigo, todos: jugadoresRanking
  });
}

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  let jugadorActual = null;
  let salaActual = null;

  socket.on('crearSala', ({ nombre, max, dificultad, modoBots }) => {
    const codigo = generarCodigoSala();
    const p = PERSONAJES[0];
    const dif = DIFICULTADES.find(d => d.id === dificultad);
    const jugador = {
      id: socket.id, nombre, personaje: p.nombre, rol: p.rol || null,
      color: p.color, avatar: p.avatar, habilidad: p.habilidad || null,
      habilidadActiva: false, habilidadUsada: 0, listo: false, host: true,
      contratos: 0, x: 0, y: 0, bot: false
    };
    salas[codigo] = {
      codigo, host: socket.id, max: parseInt(max) || 10,
      dificultad: dif ? dif.id : DIFICULTAD_DEFAULT, modoBots: !!modoBots,
      jugadores: [jugador], estado: 'lobby', partida: null
    };
    jugadorActual = jugador; salaActual = codigo;
    socket.join(codigo);
    socket.emit('salaCreada', { codigo, jugador, personajes: PERSONAJES, modoBots: !!modoBots });
    io.to(codigo).emit('actualizarLobby', salas[codigo]);
  });

  socket.on('unirseSala', ({ nombre, codigo }) => {
    const sala = salas[codigo];
    if (!sala) return socket.emit('errorSala', '⚠️ Código incorrecto: no existe ninguna sala con ese código');
    if (sala.jugadores.length >= sala.max) return socket.emit('errorSala', '⚠️ La sala está llena');
    if (sala.estado !== 'lobby') return socket.emit('errorSala', '⚠️ Partida en curso');
    const p = PERSONAJES[0];
    const jugador = {
      id: socket.id, nombre, personaje: p.nombre, rol: p.rol || null,
      color: p.color, avatar: p.avatar, habilidad: p.habilidad || null,
      habilidadActiva: false, habilidadUsada: 0, listo: false, host: false,
      contratos: 0, x: 0, y: 0, bot: false
    };
    sala.jugadores.push(jugador);
    jugadorActual = jugador; salaActual = codigo;
    socket.join(codigo);
    socket.emit('salaEncontrada', { codigo });
    setTimeout(() => {
      const s = salas[codigo];
      if (!s || s.estado !== 'lobby') return;
      if (!s.jugadores.find(j => j.id === socket.id)) return;
      socket.emit('salaUnida', { codigo, jugador, personajes: PERSONAJES });
      io.to(codigo).emit('actualizarLobby', s);
    }, 3000);
  });

  socket.on('elegirDificultad', ({ codigo, dificultad }) => {
    const sala = salas[codigo];
    if (!sala || sala.estado !== 'lobby') return;
    const dif = DIFICULTADES.find(d => d.id === dificultad);
    if (dif) sala.dificultad = dif.id;
  });

  socket.on('elegirPersonaje', ({ codigo, nombrePersonaje }) => {
    const sala = salas[codigo];
    if (!sala) return;
    const jugador = sala.jugadores.find(j => j.id === socket.id);
    if (!jugador) return;
    const ocupado = sala.jugadores.find(j => j.id !== socket.id && j.personaje === nombrePersonaje);
    if (ocupado) return socket.emit('personajeOcupado', nombrePersonaje);
    const p = PERSONAJES.find(p => p.nombre === nombrePersonaje);
    if (p) {
      jugador.personaje = p.nombre; jugador.rol = p.rol || null;
      jugador.color = p.color; jugador.avatar = p.avatar;
      jugador.habilidad = p.habilidad || null;
      io.to(codigo).emit('actualizarLobby', sala);
    }
  });

  socket.on('toggleListo', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    const jugador = sala.jugadores.find(j => j.id === socket.id);
    if (jugador && !jugador.bot) {
      jugador.listo = !jugador.listo;
      io.to(codigo).emit('actualizarLobby', sala);
    }
  });

  socket.on('iniciarPartida', ({ codigo, dificultad }) => {
    const sala = salas[codigo];
    if (!sala || sala.host !== socket.id) return;
    if (sala.estado !== 'lobby') return;

    const dif = DIFICULTADES.find(d => d.id === dificultad);
    if (dif) sala.dificultad = dif.id;

    const maxBots = Math.min(sala.max, 10);
    while (sala.jugadores.filter(j => !j.bot).length < maxBots) {
      const ocupados = sala.jugadores.map(j => j.personaje);
      const libres = PERSONAJES.filter(p => !ocupados.includes(p.nombre));
      if (libres.length === 0) break;
      const p = libres[Math.floor(Math.random() * libres.length)];
      sala.jugadores.push({
        id: 'bot_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        nombre: p.rol, personaje: p.nombre, rol: p.rol || null,
        color: p.color, avatar: p.avatar, habilidad: p.habilidad || null,
        habilidadActiva: false, habilidadUsada: 0, listo: true, host: false,
        contratos: 0, x: 0, y: 0, bot: true,
        dirX: 0, dirY: 0, cambiarDir: 0, ultimoX: 0, ultimoY: 0, ultimoMove: 0
      });
    }

    sala.estado = 'reglas';
    sala.partida = {
      mapa: generarMapa(sala.jugadores.length), spawnsAsignados: {},
      contratosRecogidos: {}, fin: false, ganador: null,
      tiempoInicio: Date.now(), pausada: false,
      ultimoSpawnContrato: 0, intervaloSpawnContrato: 12000
    };

    sala.jugadores.forEach((j, i) => {
      const spawn = sala.partida.mapa.spawns[i % sala.partida.mapa.spawns.length];
      sala.partida.spawnsAsignados[j.id] = { x: spawn.x, y: spawn.y };
      j.x = spawn.x; j.y = spawn.y; j.contratos = 0;
      if (j.bot) { j.ultimoX = j.x; j.ultimoY = j.y; j.ultimoMove = Date.now(); }
    });

    io.to(codigo).emit('mostrarReglas', { sala, personajes: PERSONAJES });
    setTimeout(() => {
      const s = salas[codigo];
      if (!s || s.estado !== 'reglas') return;
      s.estado = 'countdown';
      io.to(codigo).emit('iniciarCuentaAtras', { codigo });
      setTimeout(() => {
        const s2 = salas[codigo];
        if (!s2 || s2.estado !== 'countdown') return;
        s2.estado = 'juego';
        io.to(s2.codigo).emit('comenzarJuego', {
          mapa: s2.partida.mapa, dificultad: s2.dificultad,
          jugadores: s2.jugadores.map(j => ({
            id: j.id, nombre: j.nombre, personaje: j.personaje, rol: j.rol || null,
            color: j.color, avatar: j.avatar, x: j.x, y: j.y,
            contratos: j.contratos, bot: j.bot, habilidadActiva: !!j.habilidadActiva
          }))
        });
        iniciarLoopJuego(codigo);
      }, 5000);
    }, 7000);
  });

  socket.on('input', ({ codigo, teclas }) => {
    const sala = salas[codigo];
    if (!sala || sala.estado !== 'juego' || sala.partida.fin) return;
    if (sala.partida.pausada) return;
    const jugador = sala.jugadores.find(j => j.id === socket.id);
    if (!jugador || jugador.bot) return;

    let vel = 5;
    if (jugador.efectoCemento) vel *= 0.5;
    if (jugador.efectoCongelado) vel = 0;

    let dx = 0, dy = 0;
    if (teclas.ArrowUp || teclas.w) dy = -1;
    if (teclas.ArrowDown || teclas.s) dy = 1;
    if (teclas.ArrowLeft || teclas.a) dx = -1;
    if (teclas.ArrowRight || teclas.d) dx = 1;
    if (jugador.efectoLuz) { dx = -dx; dy = -dy; }

    const nx = jugador.x + dx * vel;
    const ny = jugador.y + dy * vel;
    const colisionJugador = (x, y) => sala.partida.mapa.paredes.some(pared =>
      colisionRect({ x: x - 12, y: y - 12, w: 24, h: 24 }, pared)
    );
    const colisionActual = colisionJugador(jugador.x, jugador.y);
    const colisionObjetivo = colisionJugador(nx, ny);

    if (!colisionObjetivo || !colisionActual) {
      jugador.x = Math.max(0, Math.min(MAP_SIZE, nx));
      jugador.y = Math.max(0, Math.min(MAP_SIZE, ny));
    }

    // Contratos (hitbox unificada PICKUP_RADIUS)
    for (const contrato of sala.partida.mapa.contratos) {
      if (!contrato.recogido && Math.hypot(jugador.x - contrato.x, jugador.y - contrato.y) < PICKUP_RADIUS) {
        contrato.recogido = true;
        contrato.reaparicion = Date.now() + CONTRATO_RESPAWN_MS;
        const ganancia = (jugador.habilidadActiva && jugador.habilidad && jugador.habilidad.id === 'promocionar') ? 2 : 1;
        jugador.contratos += ganancia;
        sala.partida.contratosRecogidos[contrato.id] = socket.id;
        io.to(codigo).emit('contratoRecogido', { contratoId: contrato.id, jugadorId: socket.id, contratos: jugador.contratos });
        if (jugador.contratos >= CONTRATOS_GANAR && !sala.partida.fin) {
          sala.partida.fin = true; sala.partida.ganador = jugador; finalizarPartida(codigo);
        }
      }
    }

    // Cofres
    for (const cofre of sala.partida.mapa.cofres) {
      if (cofre.activa && !cofre.recogido && Math.hypot(jugador.x - cofre.x, jugador.y - cofre.y) < PICKUP_RADIUS) {
        recogerCofre(sala, socket.id, cofre, codigo);
      }
    }

    // Trampas
    for (const trampa of sala.partida.mapa.trampas) {
      if (trampa.activa && Math.hypot(jugador.x - trampa.x, jugador.y - trampa.y) < PICKUP_RADIUS) {
        trampa.activa = false;
        aplicarTrampa(jugador, trampa.tipo, codigo);
        io.to(codigo).emit('trampaPisada', { trampaId: trampa.id, jugadorId: socket.id, tipo: trampa.tipo });
      }
    }
  });

  socket.on('usarHabilidad', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala || sala.estado !== 'juego' || sala.partida.fin) return;
    const jugador = sala.jugadores.find(j => j.id === socket.id);
    if (!jugador || jugador.bot || !jugador.habilidad) return;
    if (jugador.habilidadUsada && Date.now() < jugador.habilidadUsada) return;
    jugador.habilidadUsada = Date.now() + 8000;
    jugador.habilidadActiva = true;
    setTimeout(() => { jugador.habilidadActiva = false; }, 8000);
    if (jugador.habilidad.id === 'obstruir') {
      const pared = {
        id: 'temp_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        x: jugador.x - 40, y: jugador.y - 25, w: 80, h: 50, tipo: 'muro', temporal: true
      };
      sala.partida.mapa.paredes.push(pared);
      setTimeout(() => {
        const i = sala.partida.mapa.paredes.indexOf(pared);
        if (i !== -1) sala.partida.mapa.paredes.splice(i, 1);
      }, 6000);
    }
    io.to(codigo).emit('habilidadActivada', { jugadorId: jugador.id, habilidad: jugador.habilidad.id });
  });

  socket.on('pausarPartida', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala || sala.estado !== 'juego' || sala.partida.fin) return;
    sala.partida.pausada = true; io.to(codigo).emit('partidaPausada');
  });

  socket.on('reanudarPartida', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala || sala.estado !== 'juego' || sala.partida.fin) return;
    sala.partida.pausada = false; io.to(codigo).emit('partidaReanudada');
  });

  socket.on('volverLobby', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    sala.estado = 'lobby'; sala.partida = null;
    sala.jugadores = sala.jugadores.filter(j => !j.bot);
    sala.jugadores.forEach(j => {
      j.contratos = 0; j.listo = false;
      j.efectoCongelado = false; j.efectoCemento = false; j.efectoLuz = false;
      j.habilidadActiva = false; j.habilidadUsada = 0;
      delete j.x; delete j.y;
    });
    io.to(codigo).emit('actualizarLobby', sala);
  });

  socket.on('volverMenu', () => {
    if (salaActual && salas[salaActual]) {
      const sala = salas[salaActual];
      sala.jugadores = sala.jugadores.filter(j => j.id !== socket.id);
      if (sala.host === socket.id && sala.jugadores.length > 0) {
        sala.host = sala.jugadores[0].id; sala.jugadores[0].host = true;
      }
      sala.jugadores = sala.jugadores.filter(j => !j.bot || sala.jugadores.some(h => !h.bot));
      if (sala.jugadores.length === 0 || !sala.jugadores.some(j => !j.bot)) { delete salas[salaActual]; }
      else { io.to(salaActual).emit('actualizarLobby', sala); }
    }
    socket.leave(salaActual);
    jugadorActual = null; salaActual = null;
    socket.emit('volverMenuConfirmado');
  });

  socket.on('disconnect', () => {
    if (salaActual && salas[salaActual]) {
      const sala = salas[salaActual];
      sala.jugadores = sala.jugadores.filter(j => j.id !== socket.id);
      if (sala.host === socket.id && sala.jugadores.length > 0) {
        sala.host = sala.jugadores[0].id; sala.jugadores[0].host = true;
      }
      if (sala.jugadores.length === 0) { delete salas[salaActual]; }
      else {
        io.to(salaActual).emit('actualizarLobby', sala);
        io.to(salaActual).emit('jugadorDesconectado', socket.id);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor Habitalia Rush corriendo en http://localhost:${PORT}`);
});
