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

const PERSONAJES = [
  { nombre: 'Salvador', color: '#e74c3c', avatar: '👷‍♂️' },
  { nombre: 'Sablador', color: '#f39c12', avatar: '👨‍🔧' },
  { nombre: 'Marta', color: '#9b59b6', avatar: '👷‍♀️' },
  { nombre: 'Larin', color: '#3498db', avatar: '👨‍💼' },
  { nombre: 'Arquitecto Jefe', color: '#2ecc71', avatar: '🏗️' },
  { nombre: 'Aparejadora', color: '#e67e22', avatar: '👷‍♀️' },
  { nombre: 'Jefe de Obra', color: '#c0392b', avatar: '🦺' },
  { nombre: 'Topógrafo', color: '#27ae60', avatar: '🧭' },
  { nombre: 'Delineante', color: '#8e44ad', avatar: '📐' },
  { nombre: 'Ingeniera', color: '#16a085', avatar: '👩‍🔧' },
  { nombre: 'Becario', color: '#7f8c8d', avatar: '📋' },
  { nombre: 'Inspectora', color: '#d35400', avatar: '🔍' },
  { nombre: 'Diseñadora', color: '#2980b9', avatar: '🎨' },
  { nombre: 'Constructora', color: '#c0392b', avatar: '🚧' },
  { nombre: 'Promotor', color: '#95a5a6', avatar: '💼' }
];

const MAP_SIZE = 2400;
const VISADOS_TOTAL = 50;
const VISADOS_GANAR = 15;
const TRAMPAS_TOTAL = 12;

const salas = {};

app.post('/api/game/finish', (req, res) => {
  const { sala, jugadores } = req.body;
  if (!sala || !jugadores || !Array.isArray(jugadores)) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  const ranking = [...jugadores]
    .filter(j => j.visados > 0)
    .sort((a, b) => b.visados - a.visados || (a.tiempo || 0) - (b.tiempo || 0))
    .slice(0, 3)
    .map((j, i) => ({
      puesto: i + 1,
      jugador: j.nombre,
      personaje: j.personaje,
      visados: j.visados,
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

function generarMapa(numSpawns) {
  const paredes = [];
  const numParedes = 45;
  for (let i = 0; i < numParedes; i++) {
    paredes.push({
      id: 'p' + i,
      x: Math.floor(Math.random() * (MAP_SIZE - 300)),
      y: Math.floor(Math.random() * (MAP_SIZE - 300)),
      w: 50 + Math.random() * 120,
      h: 50 + Math.random() * 120,
      tipo: Math.random() > 0.5 ? 'muro' : 'valla'
    });
  }

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

  const visados = [];
  for (let i = 0; i < VISADOS_TOTAL; i++) {
    visados.push({
      id: 'v' + i,
      x: margin + Math.random() * (MAP_SIZE - margin * 2),
      y: margin + Math.random() * (MAP_SIZE - margin * 2),
      recogido: false
    });
  }

  const tiposTrampa = ['inspeccion', 'cemento', 'multa', 'luz'];
  const emojisTrampa = { inspeccion: '👮‍♂️', cemento: '🥣', multa: '💸', luz: '🔌' };
  const trampas = [];
  for (let i = 0; i < TRAMPAS_TOTAL; i++) {
    const tipo = tiposTrampa[i % tiposTrampa.length];
    trampas.push({
      id: 't' + i,
      tipo,
      emoji: emojisTrampa[tipo],
      x: margin + Math.random() * (MAP_SIZE - margin * 2),
      y: margin + Math.random() * (MAP_SIZE - margin * 2),
      activa: true
    });
  }

  return { paredes, spawns, visados, trampas };
}

function colisionRect(r1, r2) {
  return r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
}

io.on('connection', (socket) => {
  let jugadorActual = null;
  let salaActual = null;

  socket.on('crearSala', ({ nombre, max }) => {
    const codigo = generarCodigoSala();
    const p = PERSONAJES[0];
    const jugador = {
      id: socket.id,
      nombre,
      personaje: p.nombre,
      color: p.color,
      avatar: p.avatar,
      listo: false,
      host: true,
      visados: 0,
      x: 0, y: 0,
      bot: false
    };
    salas[codigo] = {
      codigo,
      host: socket.id,
      max: parseInt(max) || 10,
      jugadores: [jugador],
      estado: 'lobby',
      partida: null
    };
    jugadorActual = jugador;
    salaActual = codigo;
    socket.join(codigo);
    socket.emit('salaCreada', { codigo, jugador, personajes: PERSONAJES });
    io.to(codigo).emit('actualizarLobby', salas[codigo]);
  });

  socket.on('unirseSala', ({ nombre, codigo }) => {
    const sala = salas[codigo];
    if (!sala) return socket.emit('errorSala', 'Sala no encontrada');
    if (sala.jugadores.length >= sala.max) return socket.emit('errorSala', 'Sala llena');
    if (sala.estado !== 'lobby') return socket.emit('errorSala', 'Partida en curso');
    const p = PERSONAJES[0];
    const jugador = {
      id: socket.id,
      nombre,
      personaje: p.nombre,
      color: p.color,
      avatar: p.avatar,
      listo: false,
      host: false,
      visados: 0,
      x: 0, y: 0,
      bot: false
    };
    sala.jugadores.push(jugador);
    jugadorActual = jugador;
    salaActual = codigo;
    socket.join(codigo);
    socket.emit('salaUnida', { codigo, jugador, personajes: PERSONAJES });
    io.to(codigo).emit('actualizarLobby', sala);
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
      jugador.personaje = p.nombre;
      jugador.color = p.color;
      jugador.avatar = p.avatar;
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

  socket.on('iniciarPartida', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala || sala.host !== socket.id) return;
    if (sala.estado !== 'lobby') return;

    const maxBots = Math.min(sala.max, 10);
    while (sala.jugadores.filter(j => !j.bot).length < maxBots) {
      const ocupados = sala.jugadores.map(j => j.personaje);
      const libres = PERSONAJES.filter(p => !ocupados.includes(p.nombre));
      if (libres.length === 0) break;
      const p = libres[Math.floor(Math.random() * libres.length)];
      const bot = {
        id: 'bot_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        nombre: p.nombre,
        personaje: p.nombre,
        color: p.color,
        avatar: p.avatar,
        listo: true,
        host: false,
        visados: 0,
        x: 0, y: 0,
        bot: true,
        dirX: 0, dirY: 0, cambiarDir: 0
      };
      sala.jugadores.push(bot);
    }

    sala.estado = 'reglas';
    sala.partida = {
      mapa: generarMapa(sala.jugadores.length),
      spawnsAsignados: {},
      visadosRecogidos: {},
      fin: false,
      ganador: null,
      tiempoInicio: Date.now()
    };

    sala.jugadores.forEach((j, i) => {
      const spawn = sala.partida.mapa.spawns[i % sala.partida.mapa.spawns.length];
      sala.partida.spawnsAsignados[j.id] = { x: spawn.x, y: spawn.y };
      j.x = spawn.x;
      j.y = spawn.y;
      j.visados = 0;
    });

    io.to(codigo).emit('mostrarReglas', { sala, personajes: PERSONAJES });
  });

  socket.on('aceptarReglas', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    const jugador = sala.jugadores.find(j => j.id === socket.id);
    if (jugador) jugador.reglasAceptadas = true;
    const aceptantes = sala.jugadores.filter(j => j.reglasAceptadas || j.bot).length;
    if (aceptantes >= sala.jugadores.length) {
      sala.estado = 'countdown';
      io.to(codigo).emit('iniciarCuentaAtras', { codigo });
      setTimeout(() => {
        const s = salas[codigo];
        if (!s || s.estado !== 'countdown') return;
        s.estado = 'juego';
        io.to(codigo).emit('comenzarJuego', {
          mapa: s.partida.mapa,
          jugadores: s.jugadores.map(j => ({
            id: j.id, nombre: j.nombre, personaje: j.personaje,
            color: j.color, avatar: j.avatar, x: j.x, y: j.y,
            visados: j.visados, bot: j.bot
          }))
        });
        iniciarLoopJuego(codigo);
      }, 5000);
    } else {
      io.to(codigo).emit('actualizarReglas', {
        aceptantes,
        total: sala.jugadores.length
      });
    }
  });

  socket.on('input', ({ codigo, teclas }) => {
    const sala = salas[codigo];
    if (!sala || sala.estado !== 'juego' || sala.partida.fin) return;
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
    const jugadorRect = { x: nx - 12, y: ny - 12, w: 24, h: 24 };

    let colision = false;
    for (const pared of sala.partida.mapa.paredes) {
      if (colisionRect(jugadorRect, pared)) { colision = true; break; }
    }

    if (!colision) {
      jugador.x = Math.max(0, Math.min(MAP_SIZE, nx));
      jugador.y = Math.max(0, Math.min(MAP_SIZE, ny));
    }

    for (const visado of sala.partida.mapa.visados) {
      if (!visado.recogido && Math.hypot(jugador.x - visado.x, jugador.y - visado.y) < 20) {
        visado.recogido = true;
        jugador.visados += 1;
        sala.partida.visadosRecogidos[visado.id] = socket.id;
        io.to(codigo).emit('visadoRecogido', { visadoId: visado.id, jugadorId: socket.id, visados: jugador.visados });
        if (jugador.visados >= VISADOS_GANAR && !sala.partida.fin) {
          sala.partida.fin = true;
          sala.partida.ganador = jugador;
          finalizarPartida(codigo);
        }
      }
    }

    for (const trampa of sala.partida.mapa.trampas) {
      if (trampa.activa && Math.hypot(jugador.x - trampa.x, jugador.y - trampa.y) < 20) {
        trampa.activa = false;
        aplicarTrampa(jugador, trampa.tipo, codigo);
        io.to(codigo).emit('trampaPisada', { trampaId: trampa.id, jugadorId: socket.id, tipo: trampa.tipo });
      }
    }
  });

  function aplicarTrampa(jugador, tipo, codigo) {
    if (tipo === 'inspeccion') {
      jugador.efectoCongelado = true;
      setTimeout(() => { jugador.efectoCongelado = false; }, 3000);
    } else if (tipo === 'cemento') {
      jugador.efectoCemento = true;
      setTimeout(() => { jugador.efectoCemento = false; }, 4000);
    } else if (tipo === 'multa') {
      if (jugador.visados >= 2) {
        jugador.visados -= 2;
        const mapa = salas[salaActual].partida.mapa;
        let restaurados = 0;
        for (let i = 0; i < mapa.visados.length && restaurados < 2; i++) {
          if (!mapa.visados[i].recogido && !mapa.visados[i].reapparicion) {
            mapa.visados[i].recogido = false;
            restaurados++;
          }
        }
        io.to(codigo).emit('visadosPerdidos', { jugadorId: socket.id, visados: jugador.visados });
      }
    } else if (tipo === 'luz') {
      jugador.efectoLuz = true;
      setTimeout(() => { jugador.efectoLuz = false; }, 3000);
    }
  }

  function iniciarLoopJuego(codigo) {
    const intervalo = setInterval(() => {
      const sala = salas[codigo];
      if (!sala || sala.estado !== 'juego') { clearInterval(intervalo); return; }

      sala.jugadores.forEach(j => {
        if (!j.bot || sala.partida.fin) return;
        if (j.efectoCongelado) return;
        if (j.cambiarDir <= 0) {
          j.dirX = (Math.random() - 0.5) * 2;
          j.dirY = (Math.random() - 0.5) * 2;
          j.cambiarDir = 60 + Math.random() * 60;
        }
        j.cambiarDir--;
        let vel = j.efectoCemento ? 2.5 : 5;
        let nx = j.x + j.dirX * vel;
        let ny = j.y + j.dirY * vel;
        const rect = { x: nx - 12, y: ny - 12, w: 24, h: 24 };
        let col = false;
        for (const pared of sala.partida.mapa.paredes) {
          if (colisionRect(rect, pared)) { col = true; break; }
        }
        if (!col) {
          j.x = Math.max(0, Math.min(MAP_SIZE, nx));
          j.y = Math.max(0, Math.min(MAP_SIZE, ny));
        } else {
          j.cambiarDir = 0;
        }

        for (const visado of sala.partida.mapa.visados) {
          if (!visado.recogido && Math.hypot(j.x - visado.x, j.y - visado.y) < 20) {
            visado.recogido = true;
            j.visados += 1;
            sala.partida.visadosRecogidos[visado.id] = j.id;
            io.to(codigo).emit('visadoRecogido', { visadoId: visado.id, jugadorId: j.id, visados: j.visados });
            if (j.visados >= VISADOS_GANAR && !sala.partida.fin) {
              sala.partida.fin = true;
              sala.partida.ganador = j;
              finalizarPartida(codigo);
            }
          }
        }

        for (const trampa of sala.partida.mapa.trampas) {
          if (trampa.activa && Math.hypot(j.x - trampa.x, j.y - trampa.y) < 20) {
            trampa.activa = false;
            aplicarTrampa(j, trampa.tipo, codigo);
            io.to(codigo).emit('trampaPisada', { trampaId: trampa.id, jugadorId: j.id, tipo: trampa.tipo });
          }
        }
      });

      if (!sala.partida.fin) {
        io.to(codigo).emit('estadoJuego', {
          jugadores: sala.jugadores.map(j => ({
            id: j.id, nombre: j.nombre, personaje: j.personaje,
            color: j.color, avatar: j.avatar, x: j.x, y: j.y,
            visados: j.visados, bot: j.bot,
            efectoCongelado: j.efectoCongelado, efectoCemento: j.efectoCemento, efectoLuz: j.efectoLuz
          })),
          visados: sala.partida.mapa.visados.map(v => ({ id: v.id, x: v.x, y: v.y, recogido: v.recogido })),
          trampas: sala.partida.mapa.trampas.map(t => ({ id: t.id, tipo: t.tipo, x: t.x, y: t.y, activa: t.activa }))
        });
      }
    }, 1000 / 30);
  }

  function finalizarPartida(codigo) {
    const sala = salas[codigo];
    if (!sala) return;
    sala.estado = 'fin';
    const jugadoresRanking = sala.jugadores
      .sort((a, b) => b.visados - a.visados)
      .map(j => ({
        nombre: j.nombre,
        personaje: j.personaje,
        visados: j.visados,
        avatar: j.avatar,
        bot: j.bot
      }));
    io.to(codigo).emit('partidaFinalizada', {
      podio: jugadoresRanking.slice(0, 3),
      sala: codigo,
      todos: jugadoresRanking
    });
  }

  socket.on('volverLobby', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala) return;
    sala.estado = 'lobby';
    sala.partida = null;
    sala.jugadores.forEach(j => {
      j.visados = 0;
      j.reglasAceptadas = false;
      j.efectoCongelado = false;
      j.efectoCemento = false;
      j.efectoLuz = false;
      delete j.x; delete j.y;
    });
    io.to(codigo).emit('actualizarLobby', sala);
  });

  socket.on('volverMenu', () => {
    if (salaActual && salas[salaActual]) {
      const sala = salas[salaActual];
      sala.jugadores = sala.jugadores.filter(j => j.id !== socket.id);
      if (sala.host === socket.id && sala.jugadores.length > 0) {
        sala.host = sala.jugadores[0].id;
        sala.jugadores[0].host = true;
      }
      if (sala.jugadores.length === 0) {
        delete salas[salaActual];
      } else {
        io.to(salaActual).emit('actualizarLobby', sala);
      }
    }
    socket.leave(salaActual);
    jugadorActual = null;
    salaActual = null;
    socket.emit('volverMenuConfirmado');
  });

  socket.on('disconnect', () => {
    if (salaActual && salas[salaActual]) {
      const sala = salas[salaActual];
      sala.jugadores = sala.jugadores.filter(j => j.id !== socket.id);
      if (sala.host === socket.id && sala.jugadores.length > 0) {
        sala.host = sala.jugadores[0].id;
        sala.jugadores[0].host = true;
      }
      if (sala.jugadores.length === 0) {
        delete salas[salaActual];
      } else {
        io.to(salaActual).emit('actualizarLobby', sala);
        io.to(salaActual).emit('jugadorDesconectado', socket.id);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor Habitalia Rush corriendo en http://localhost:${PORT}`);
});
