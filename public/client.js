const socket = io();

let nombreJugador = '';
let personajeSeleccionado = null;
let salaActual = null;
let soyHost = false;
let estadoJuegoActual = {};
let mapaActual = null;
let canvas, ctx, minimapa, mCtx;
let animFrame;
let camara = { x: 0, y: 0 };
let teclas = {};
let mensajeTrampaTemporizador = null;

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

const views = {
  menu: document.getElementById('view-menu'),
  bots: document.getElementById('view-bots'),
  online: document.getElementById('view-online'),
  lobby: document.getElementById('view-lobby'),
  rules: document.getElementById('view-rules'),
  countdown: document.getElementById('view-countdown'),
  game: document.getElementById('view-game'),
  podium: document.getElementById('view-podium')
};

function mostrarView(nombre) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  if (views[nombre]) views[nombre].classList.add('active');
}

const audioOverlay = document.getElementById('audio-overlay');
const btnActivarAudio = document.getElementById('btn-activar-audio');
btnActivarAudio.addEventListener('click', () => {
  audioOverlay.style.display = 'none';
});

// VISTA 1: MENÚ
const inputNombre = document.getElementById('input-nombre');
const btnJugarOnline = document.getElementById('btn-jugar-online');
const btnJugarBots = document.getElementById('btn-jugar-bots');

btnJugarOnline.addEventListener('click', () => {
  const nombre = inputNombre.value.trim();
  if (!nombre) return alert('Introduce tu nombre');
  nombreJugador = nombre;
  mostrarView('online');
});

btnJugarBots.addEventListener('click', () => {
  const nombre = inputNombre.value.trim();
  if (!nombre) return alert('Introduce tu nombre');
  nombreJugador = nombre;
  personajeSeleccionado = PERSONAJES[0];
  renderizarCarruselBots();
  mostrarView('bots');
});

// VISTA 1.B: BOTS - Carrusel
let indiceCarruselBots = 0;
const trackBots = document.getElementById('carousel-bots-track');
const infoBots = document.getElementById('carousel-bots-info');
const btnIniciarBots = document.getElementById('btn-iniciar-bots');

function renderizarCarruselBots() {
  trackBots.innerHTML = '';
  PERSONAJES.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = `personaje-card ${i === indiceCarruselBots ? 'selected' : ''}`;
    card.innerHTML = `
      <span class="avatar-badge">${p.avatar}</span>
      <div class="nombre-personaje">${p.nombre}</div>
      <div class="color-chip" style="background:${p.color}"></div>
    `;
    card.onclick = () => { indiceCarruselBots = i; personajeSeleccionado = p; renderizarCarruselBots(); };
    trackBots.appendChild(card);
  });
  infoBots.textContent = `Seleccionado: ${personajeSeleccionado.nombre}`;
  btnIniciarBots.disabled = false;
}

document.getElementById('carousel-prev').onclick = () => {
  indiceCarruselBots = (indiceCarruselBots - 1 + PERSONAJES.length) % PERSONAJES.length;
  personajeSeleccionado = PERSONAJES[indiceCarruselBots];
  renderizarCarruselBots();
};
document.getElementById('carousel-next').onclick = () => {
  indiceCarruselBots = (indiceCarruselBots + 1) % PERSONAJES.length;
  personajeSeleccionado = PERSONAJES[indiceCarruselBots];
  renderizarCarruselBots();
};

btnIniciarBots.onclick = () => {
  socket.emit('crearSala', { nombre: nombreJugador, max: 10 });
  socket.once('salaCreada', ({ codigo }) => {
    salaActual = codigo;
    soyHost = true;
    socket.emit('elegirPersonaje', { codigo, nombrePersonaje: personajeSeleccionado.nombre });
    const ocupados = [personajeSeleccionado.nombre];
    const libres = PERSONAJES.filter(p => !ocupados.includes(p.nombre));
    const bots = libres.slice(0, 9);
    bots.forEach((p, i) => {
      const botId = 'bot_' + Date.now() + '_' + i;
      socket.emit('agregarBot', { codigo, nombre: p.nombre, personaje: p.nombre, color: p.color, avatar: p.avatar, id: botId });
    });
    setTimeout(() => {
      socket.emit('iniciarPartida', { codigo });
    }, 500);
  });
  mostrarView('bots');
};

// VISTA 2: ONLINE
const selectMax = document.getElementById('select-max-jugadores');
const btnCrearSala = document.getElementById('btn-crear-sala');
const btnUnirseSala = document.getElementById('btn-unirse-sala');
const inputCodigo = document.getElementById('input-codigo-sala');

btnCrearSala.onclick = () => {
  const max = selectMax.value;
  socket.emit('crearSala', { nombre: nombreJugador, max });
};

btnUnirseSala.onclick = () => {
  const codigo = inputCodigo.value.trim().toUpperCase();
  if (!codigo) return alert('Introduce un código');
  socket.emit('unirseSala', { nombre: nombreJugador, codigo });
};

socket.on('salaCreada', ({ codigo, jugador }) => {
  salaActual = codigo;
  soyHost = true;
  personajeSeleccionado = PERSONAJES.find(p => p.nombre === jugador.personaje);
  renderizarCarruselLobby();
  mostrarView('lobby');
});

socket.on('salaUnida', ({ codigo, jugador }) => {
  salaActual = codigo;
  soyHost = false;
  personajeSeleccionado = PERSONAJES.find(p => p.nombre === jugador.personaje);
  renderizarCarruselLobby();
  mostrarView('lobby');
});

socket.on('errorSala', (msg) => {
  document.getElementById('mensaje-error-online').textContent = msg;
  setTimeout(() => { document.getElementById('mensaje-error-online').textContent = ''; }, 3000);
});

// VISTA 3: LOBBY
let indiceCarruselLobby = 0;
const trackLobby = document.getElementById('carousel-lobby-track');

function renderizarCarruselLobby() {
  trackLobby.innerHTML = '';
  PERSONAJES.forEach((p, i) => {
    const ocupado = window.estadoJugadoresLobby && window.estadoJugadoresLobby.some(j => j.personaje === p.nombre && j.nombre !== nombreJugador);
    const card = document.createElement('div');
    card.className = `personaje-card ${i === indiceCarruselLobby ? 'selected' : ''} ${ocupado ? 'locked' : ''}`;
    card.innerHTML = `
      <span class="avatar-badge">${p.avatar}</span>
      <div class="nombre-personaje">${p.nombre}</div>
      <div class="color-chip" style="background:${p.color}"></div>
      ${ocupado ? '<div style="color:#c0392b;font-size:0.75rem;margin-top:0.25rem">Ocupado</div>' : ''}
    `;
    if (!ocupado) card.onclick = () => {
      indiceCarruselLobby = i;
      personajeSeleccionado = p;
      renderizarCarruselLobby();
      socket.emit('elegirPersonaje', { codigo: salaActual, nombrePersonaje: p.nombre });
    };
    trackLobby.appendChild(card);
  });
}

window.estadoJugadoresLobby = [];

socket.on('actualizarLobby', (sala) => {
  window.estadoJugadoresLobby = sala.jugadores;
  const grid = document.getElementById('jugadores-grid');
  grid.innerHTML = '';
  const codigoDisplay = document.getElementById('display-codigo-sala');
  if (codigoDisplay) codigoDisplay.textContent = sala.codigo;
  sala.jugadores.forEach(j => {
    const card = document.createElement('div');
    card.className = `jugador-card ${j.host ? 'host' : ''}`;
    const estado = j.listo ? 'listo' : 'no-listado';
    const icono = j.listo ? '✅' : '❌';
    card.innerHTML = `
      <span class="avatar-jugador">${j.avatar}</span>
      <div class="nombre-jugador">${j.nombre}</div>
      <div class="personaje-jugador">${j.personaje}</div>
      <div class="estado-listado ${estado}">${icono} ${j.listo ? 'Listo' : 'Esperando'}</div>
    `;
    grid.appendChild(card);
  });
  const btnIniciar = document.getElementById('btn-iniciar-partida-host');
  if (btnIniciar) {
    btnIniciar.disabled = !soyHost || sala.jugadores.some(j => !j.listo && !j.bot);
  }
});

document.getElementById('carousel-lobby-prev').onclick = () => {
  indiceCarruselLobby = (indiceCarruselLobby - 1 + PERSONAJES.length) % PERSONAJES.length;
  personajeSeleccionado = PERSONAJES[indiceCarruselLobby];
  renderizarCarruselLobby();
  socket.emit('elegirPersonaje', { codigo: salaActual, nombrePersonaje: personajeSeleccionado.nombre });
};
document.getElementById('carousel-lobby-next').onclick = () => {
  indiceCarruselLobby = (indiceCarruselLobby + 1) % PERSONAJES.length;
  personajeSeleccionado = PERSONAJES[indiceCarruselLobby];
  renderizarCarruselLobby();
  socket.emit('elegirPersonaje', { codigo: salaActual, nombrePersonaje: personajeSeleccionado.nombre });
};

const btnListo = document.getElementById('btn-listo-lobby');
let listo = false;
btnListo.onclick = () => {
  listo = !listo;
  btnListo.textContent = listo ? '✅ LISTO' : '❌ NO LISTO';
  btnListo.className = listo ? 'btn btn-primary' : 'btn btn-outline';
  socket.emit('toggleListo', { codigo: salaActual });
};

const btnIniciarHost = document.getElementById('btn-iniciar-partida-host');
btnIniciarHost.onclick = () => {
  socket.emit('iniciarPartida', { codigo: salaActual });
};

document.getElementById('btn-abandonar-lobby').onclick = () => {
  socket.emit('volverMenu');
  salaActual = null;
  mostrarView('menu');
};

document.getElementById('btn-copiar-codigo').onclick = () => {
  const codigo = document.getElementById('display-codigo-sala').textContent;
  navigator.clipboard.writeText(codigo);
};

document.getElementById('btn-back-menu').onclick = () => { mostrarView('menu'); };
document.getElementById('btn-back-menu-online').onclick = () => { mostrarView('menu'); };

// VISTA 4: REGLAS
const btnAceptarReglas = document.getElementById('btn-aceptar-reglas');
const btnSaltarReglas = document.getElementById('btn-saltar-reglas');

socket.on('mostrarReglas', ({ sala }) => {
  document.getElementById('reglas-total').textContent = sala.jugadores.length;
  mostrarView('rules');
});

socket.on('actualizarReglas', ({ aceptantes, total }) => {
  document.getElementById('reglas-num').textContent = aceptantes;
  document.getElementById('reglas-total').textContent = total;
});

btnAceptarReglas.onclick = () => {
  socket.emit('aceptarReglas', { codigo: salaActual });
};

btnSaltarReglas.onclick = () => {
  socket.emit('aceptarReglas', { codigo: salaActual });
};

// VISTA 5: CUENTA ATRÁS
socket.on('iniciarCuentaAtras', () => {
  mostrarView('countdown');
  let n = 5;
  const display = document.getElementById('countdown-num');
  const msg = document.getElementById('countdown-msg');
  display.textContent = n;
  const intervalo = setInterval(() => {
    n--;
    if (n > 0) {
      display.textContent = n;
      msg.textContent = '¡Prepárate!';
    } else {
      display.textContent = '¡A LA OBRA!';
      msg.textContent = '';
      clearInterval(intervalo);
    }
  }, 1000);
});

// VISTA 5: JUEGO
socket.on('comenzarJuego', ({ mapa, jugadores }) => {
  mapaActual = mapa;
  estadoJuegoActual = {};
  jugadores.forEach(j => { estadoJuegoActual[j.id] = j; });
  mostrarView('game');
  canvas = document.getElementById('canvas-juego');
  ctx = canvas.getContext('2d');
  minimapa = document.getElementById('minimapa');
  mCtx = minimapa.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('keydown', e => { teclas[e.key] = true; });
  window.addEventListener('keyup', e => { teclas[e.key] = false; });
  bucleJuego();
});

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

socket.on('estadoJuego', ({ jugadores, visados, trampas }) => {
  estadoJuegoActual = {};
  jugadores.forEach(j => { estadoJuegoActual[j.id] = j; });
  if (mapaActual) {
    mapaActual.visados.forEach(v => {
      const actual = visados.find(vv => vv.id === v.id);
      if (actual) v.recogido = actual.recogido;
    });
    mapaActual.trampas.forEach(t => {
      const actual = trampas.find(tt => tt.id === t.id);
      if (actual) t.activa = actual.activa;
    });
  }
});

function bucleJuego() {
  if (!canvas) return;
  const miId = socket.id;
  const yo = estadoJuegoActual[miId];
  if (yo) {
    camara.x = yo.x - canvas.width / 2;
    camara.y = yo.y - canvas.height / 2;
    camara.x = Math.max(0, Math.min(2400 - canvas.width, camara.x));
    camara.y = Math.max(0, Math.min(2400 - canvas.height, camara.y));
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(-camara.x, -camara.y);

  ctx.fillStyle = '#7f8c8d';
  if (mapaActual) {
    mapaActual.paredes.forEach(p => {
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = '#2c3e50';
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    });

    ctx.fillStyle = '#f1c40f';
    mapaActual.visados.forEach(v => {
      if (!v.recogido) {
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('📄', v.x, v.y);
      }
    });

    mapaActual.trampas.forEach(t => {
      if (t.activa) {
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.emoji, t.x, t.y);
      }
    });

    Object.values(estadoJuegoActual).forEach(j => {
      ctx.fillStyle = j.color;
      ctx.beginPath();
      ctx.arc(j.x, j.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(j.nombre, j.x, j.y - 22);
      ctx.fillStyle = j.color;
      ctx.fillText(j.personaje, j.x, j.y + 30);
      if (j.id === miId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.strokeRect(j.x - 20, j.y - 20, 40, 40);
      }
    });
  }

  ctx.restore();

  if (yo) {
    document.getElementById('hud-visados').textContent = `${yo.visados} / 15`;
    document.getElementById('hud-personaje').textContent = yo.personaje;
  }

  const escala = 150 / 2400;
  mCtx.clearRect(0, 0, 150, 150);
  mCtx.fillStyle = 'rgba(255,255,255,0.2)';
  mCtx.fillRect(0, 0, 150, 150);
  if (mapaActual) {
    mapaActual.paredes.forEach(p => {
      mCtx.fillStyle = '#7f8c8d';
      mCtx.fillRect(p.x * escala, p.y * escala, p.w * escala, p.h * escala);
    });
    Object.values(estadoJuegoActual).forEach(j => {
      mCtx.fillStyle = j.id === miId ? '#fff' : j.color;
      mCtx.fillRect(j.x * escala - 2, j.y * escala - 2, 4, 4);
    });
  }

  animFrame = requestAnimationFrame(bucleJuego);
}

socket.on('visadoRecogido', ({ jugadorId, visados }) => {
  const j = estadoJuegoActual[jugadorId];
  if (j) j.visados = visados;
});

socket.on('trampaPisada', ({ jugadorId, tipo }) => {
  const j = estadoJuegoActual[jugadorId];
  if (!j) return;
  const nombres = { inspeccion: 'Inspección de Trabajo', cemento: 'Cemento Fresco', multa: 'Multa Urbanística', luz: 'Corte de Luz' };
  const msg = document.getElementById('mensaje-trampa');
  msg.textContent = `${j.nombre}: ${nombres[tipo]}`;
  msg.style.display = 'block';
  if (mensajeTrampaTemporizador) clearTimeout(mensajeTrampaTemporizador);
  mensajeTrampaTemporizador = setTimeout(() => { msg.style.display = 'none'; }, 3000);
});

setInterval(() => {
  if (socket.id && estadoJuegoActual && estadoJuegoActual[socket.id]) {
    socket.emit('input', { codigo: salaActual, teclas });
  }
}, 1000 / 30);

// VISTA 6: PODIO
socket.on('partidaFinalizada', ({ podio, sala }) => {
  cancelAnimationFrame(animFrame);
  mostrarView('podium');
  const contenedor = document.getElementById('podio');
  contenedor.innerHTML = '';
  const puestos = ['primero', 'segundo', 'tercero'];
  podio.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = `podio-escalon ${puestos[i]}`;
    div.innerHTML = `
      <div class="puesto">${i + 1}º PUESTO</div>
      <div class="avatar-podio">${p.avatar || '👤'}</div>
      <div class="nombre-podio-podio">${p.nombre}</div>
      <div class="visados-podio">${p.visados} visados</div>
    `;
    contenedor.appendChild(div);
  });
});

document.getElementById('btn-volver-jugar').onclick = () => {
  socket.emit('volverLobby', { codigo: salaActual });
  mostrarView('lobby');
};

document.getElementById('btn-menu-principal').onclick = () => {
  socket.emit('volverMenu');
  salaActual = null;
  mostrarView('menu');
};

socket.on('volverMenuConfirmado', () => {
  salaActual = null;
  mostrarView('menu');
});

socket.on('jugadorDesconectado', (id) => {
  delete estadoJuegoActual[id];
});

socket.on('personajeOcupado', (nombre) => {
  alert(`El personaje ${nombre} ya está ocupado por otro jugador`);
});

renderizarCarruselBots();
