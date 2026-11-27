const socket = io();

let nombreJugador = '';
let personajeSeleccionado = null;
let salaActual = null;
let soyHost = false;
let modoBots = false;
let estadoJuegoActual = {};
let mapaActual = null;
let canvas, ctx, minimapa, mCtx;
let animFrame;
let camara = { x: 0, y: 0 };
let teclas = {};
let mensajeTrampaTemporizador = null;
let juegoPausado = false;
let joinTransitionTimer = null;
let joinTransitionInterval = null;
let errorOnlineTimer = null;
let pendingJoin = null;

// Personajes: nombre interno = identificador, rol = cargo que se muestra, avatar único y sin repetir
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

const TRAMPA_NOMBRE = {
  inspeccion: 'Inspección de Trabajo',
  cemento: 'Cemento Fresco',
  multa: 'Multa Urbanística',
  luz: 'Corte de Luz'
};

const views = {
  menu: document.getElementById('view-menu'),

  online: document.getElementById('view-online'),
  joinTransition: document.getElementById('view-join-transition'),
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

function resetEstadoClienteSala() {
  salaActual = null; soyHost = false; modoBots = false; listo = false;
  personajeSeleccionado = null; estadoJuegoActual = {}; mapaActual = null;
  pendingJoin = null;
  const btnListo = document.getElementById('btn-listo-lobby');
  if (btnListo) { btnListo.textContent = 'NO LISTO'; btnListo.className = 'btn btn-outline'; }
  const codigoDisplay = document.getElementById('display-codigo-sala');
  if (codigoDisplay) codigoDisplay.textContent = '';
  const grid = document.getElementById('jugadores-grid');
  if (grid) grid.innerHTML = '';
  window.estadoJugadoresLobby = [];
  ocultarErrorOnline();
  limpiarJoinTransition();
}

function mostrarErrorOnline(msg) {
  const el = document.getElementById('mensaje-error-online');
  const input = document.getElementById('input-codigo-sala');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.classList.remove('shake'); input && input.classList.remove('shake');
  void el.offsetWidth; // restart animation
  el.classList.add('shake'); input && input.classList.add('shake');
  clearTimeout(errorOnlineTimer);
  errorOnlineTimer = setTimeout(() => ocultarErrorOnline(), 4000);
}
function ocultarErrorOnline() {
  const el = document.getElementById('mensaje-error-online');
  if (el) { el.style.display = 'none'; el.textContent = ''; el.classList.remove('shake'); }
  document.getElementById('input-codigo-sala')?.classList.remove('shake');
  clearTimeout(errorOnlineTimer);
}

function limpiarJoinTransition() {
  clearInterval(joinTransitionInterval); clearTimeout(joinTransitionTimer);
  joinTransitionInterval = null; joinTransitionTimer = null;
}
function iniciarTransicionUnion(codigo) {
  limpiarJoinTransition();
  mostrarView('joinTransition');
  const codeEl = document.getElementById('join-transition-code');
  const countEl = document.getElementById('join-transition-count');
  const bar = document.getElementById('join-transition-bar');
  if (codeEl) codeEl.textContent = `Sala: ${codigo}`;
  let n = 3;
  if (countEl) { countEl.textContent = n; countEl.classList.remove('pop'); }
  if (bar) { bar.style.transition = 'none'; bar.style.width = '0%'; setTimeout(() => { bar.style.transition = 'width 1s linear'; bar.style.width = '33.34%'; }, 30); }
  joinTransitionInterval = setInterval(() => {
    n--;
    if (countEl) { countEl.textContent = n; countEl.classList.remove('pop'); void countEl.offsetWidth; countEl.classList.add('pop'); }
    if (bar) bar.style.width = `${((3 - n) / 3) * 100}%`;
    if (n <= 0) { clearInterval(joinTransitionInterval); joinTransitionInterval = null; }
  }, 1000);
  joinTransitionTimer = setTimeout(() => {
    limpiarJoinTransition();
    if (pendingJoin) {
      const data = pendingJoin; pendingJoin = null;
      aplicarSalaUnida(data);
    }
  }, 3000);
}

// SISTEMA DE AUDIO: se desbloquea con el primer clic en cualquier parte de la pantalla
let volumenActivado = localStorage.getItem('habitaliaVolumen') !== '0';
let audioDesbloqueado = false;

function actualizarIconoVolumen() {
  const btnVol = document.getElementById('btn-volumen');
  if (btnVol) {
    btnVol.textContent = volumenActivado ? '🔊' : '🔇';
    btnVol.title = volumenActivado ? 'Desactivar sonido' : 'Activar sonido';
  }
}

function desbloquearAudio() {
  if (audioDesbloqueado) return;
  audioDesbloqueado = true;
  if (typeof window.AudioContext !== 'undefined' && window.__habitaliaAudioContext === undefined) {
    window.__habitaliaAudioContext = new window.AudioContext();
  }
}

document.addEventListener('click', desbloquearAudio);

const btnVolumen = document.getElementById('btn-volumen');
if (btnVolumen) {
  btnVolumen.addEventListener('click', (e) => {
    e.stopPropagation();
    desbloquearAudio();
    volumenActivado = !volumenActivado;
    localStorage.setItem('habitaliaVolumen', volumenActivado ? '1' : '0');
    actualizarIconoVolumen();
  });
}
actualizarIconoVolumen();

// VISTA 1: MENÚ
const inputNombre = document.getElementById('input-nombre');
const btnJugarOnline = document.getElementById('btn-jugar-online');
const btnJugarBots = document.getElementById('btn-jugar-bots');

btnJugarOnline.addEventListener('click', () => {
  const nombre = inputNombre.value.trim();
  if (!nombre) return alert('Introduce tu nombre');
  nombreJugador = nombre;
  resetEstadoClienteSala();
  ocultarErrorOnline();
  mostrarView('online');
});

btnJugarBots.addEventListener('click', () => {
  const nombre = inputNombre.value.trim();
  if (!nombre) return alert('Introduce tu nombre');
  nombreJugador = nombre;
  resetEstadoClienteSala();
  modoBots = true;
  personajeSeleccionado = PERSONAJES[0];
  socket.emit('crearSala', { nombre: nombreJugador, max: 10, dificultad: selectDificultadLobby?.value || 'medio', modoBots: true });
});

// VISTA 2: ONLINE
const selectMax = document.getElementById('select-max-jugadores');
const btnCrearSala = document.getElementById('btn-crear-sala');
const btnUnirseSala = document.getElementById('btn-unirse-sala');
const inputCodigo = document.getElementById('input-codigo-sala');

btnCrearSala.onclick = () => {
  const max = selectMax.value;
  modoBots = false;
  socket.emit('crearSala', { nombre: nombreJugador, max, modoBots: false });
};

inputCodigo.addEventListener('input', () => ocultarErrorOnline());

btnUnirseSala.onclick = () => {
  const codigo = inputCodigo.value.trim().toUpperCase();
  if (!codigo) { mostrarErrorOnline('?? Introduce un c?digo de sala'); return; }
  ocultarErrorOnline();
  socket.emit('unirseSala', { nombre: nombreJugador, codigo });
};

socket.on('salaCreada', ({ codigo, jugador, modoBots: esBots }) => {
  salaActual = codigo;
  soyHost = true;
  modoBots = !!esBots;
  personajeSeleccionado = PERSONAJES.find(p => p.nombre === jugador.personaje) || PERSONAJES[0];
  indiceCarruselLobby = Math.max(0, PERSONAJES.findIndex(p => p.nombre === personajeSeleccionado.nombre));
  if (modoBots) socket.emit('elegirPersonaje', { codigo, nombrePersonaje: personajeSeleccionado.nombre });
  renderizarCarruselLobby();
  mostrarView('lobby');
});

function aplicarSalaUnida({ codigo, jugador }) {
  salaActual = codigo;
  soyHost = false;
  modoBots = false;
  personajeSeleccionado = PERSONAJES.find(p => p.nombre === jugador.personaje) || PERSONAJES[0];
  renderizarCarruselLobby();
  mostrarView('lobby');
}

socket.on('salaEncontrada', ({ codigo }) => {
  iniciarTransicionUnion(codigo);
});

socket.on('salaUnida', (data) => {
  if (views.joinTransition.classList.contains('active')) {
    pendingJoin = data;
  } else {
    aplicarSalaUnida(data);
  }
});

socket.on('errorSala', (msg) => {
  limpiarJoinTransition();
  pendingJoin = null;
  if (views.joinTransition.classList.contains('active')) mostrarView('online');
  mostrarErrorOnline(msg || '?? C?digo incorrecto: no existe ninguna sala con ese c?digo');
});

// VISTA 3: LOBBY
let indiceCarruselLobby = 0;
const trackLobby = document.getElementById('carousel-lobby-track');
const selectDificultadLobby = document.getElementById('select-dificultad-lobby');

if (selectDificultadLobby) {
  selectDificultadLobby.addEventListener('change', () => {
    socket.emit('elegirDificultad', { codigo: salaActual, dificultad: selectDificultadLobby.value });
  });
}

function scrollCarruselLobby(delta) {
  const track = document.getElementById('carousel-lobby-track');
  track.scrollTo({ left: track.scrollLeft + delta, behavior: 'smooth' });
}

function mostrarPanelDificultadLobby() {
  const panel = document.getElementById('lobby-dificultad');
  const codigoBox = document.querySelector('.codigo-sala-display');
  if (panel) panel.style.display = modoBots ? 'block' : 'none';
  if (codigoBox) codigoBox.style.display = modoBots ? 'none' : 'flex';
}

function renderizarCarruselLobby() {
  trackLobby.innerHTML = '';
  mostrarPanelDificultadLobby();
  PERSONAJES.forEach((p, i) => {
    const ocupado = window.estadoJugadoresLobby && window.estadoJugadoresLobby.some(j => j.personaje === p.nombre && j.nombre !== nombreJugador);
    const card = document.createElement('div');
    card.className = `personaje-card ${i === indiceCarruselLobby ? 'selected' : ''} ${ocupado ? 'locked' : ''}`;
    card.innerHTML = `
      <span class="avatar-badge">${p.avatar}</span>
      <div class="nombre-personaje">${p.rol}</div>
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
  modoBots = !!sala.modoBots;
  mostrarPanelDificultadLobby();
  const grid = document.getElementById('jugadores-grid');
  grid.innerHTML = '';
  const codigoDisplay = document.getElementById('display-codigo-sala');
  const codigoBox = document.querySelector('.codigo-sala-display');
  if (codigoDisplay) codigoDisplay.textContent = sala.codigo || '';
  if (codigoBox) codigoBox.style.display = modoBots ? 'none' : 'flex';
  sala.jugadores.forEach(j => {
    const card = document.createElement('div');
    card.className = `jugador-card ${j.host ? 'host' : ''}`;
    const estado = j.listo ? 'listo' : 'no-listado';
    const icono = j.listo ? '✅' : '❌';
    card.innerHTML = `
      <span class="avatar-jugador">${j.avatar}</span>
      <div class="nombre-jugador">${j.nombre}</div>
      <div class="personaje-jugador">${j.rol}</div>
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
  scrollCarruselLobby(-130);
  socket.emit('elegirPersonaje', { codigo: salaActual, nombrePersonaje: personajeSeleccionado.nombre });
};
document.getElementById('carousel-lobby-next').onclick = () => {
  indiceCarruselLobby = (indiceCarruselLobby + 1) % PERSONAJES.length;
  personajeSeleccionado = PERSONAJES[indiceCarruselLobby];
  renderizarCarruselLobby();
  scrollCarruselLobby(130);
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
  socket.emit('iniciarPartida', { codigo: salaActual, dificultad: modoBots ? (selectDificultadLobby?.value || 'medio') : undefined });
};

document.getElementById('btn-abandonar-lobby').onclick = () => {
  socket.emit('volverMenu');
  resetEstadoClienteSala();
  mostrarView('menu');
};

document.getElementById('btn-copiar-codigo').onclick = () => {
  const codigo = document.getElementById('display-codigo-sala').textContent;
  navigator.clipboard.writeText(codigo);
};

document.getElementById('btn-back-menu-online').onclick = () => { resetEstadoClienteSala(); mostrarView('menu'); };

// VISTA 4: REGLAS
socket.on('mostrarReglas', () => {
  mostrarView('rules');
});

// VISTA 5: CUENTA ATRÁS
socket.on('iniciarCuentaAtras', () => {
  mostrarView('countdown');
  let n = 5;
  const display = document.getElementById('countdown-num');
  const msg = document.getElementById('countdown-msg');
  display.textContent = n;
  msg.textContent = '¡Prepárate!';
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

// VISTA 6: JUEGO
const btnJuegoAbandonar = document.getElementById('btn-juego-abandonar');
const btnJuegoPausar = document.getElementById('btn-juego-pausar');

function actualizarIconoPausa() {
  if (!btnJuegoPausar) return;
  btnJuegoPausar.textContent = juegoPausado ? '▶️ Reanudar partida' : '⏸️ Pausar partida';
  btnJuegoPausar.title = juegoPausado ? 'Reanudar la partida' : 'Pausar la partida (congela el juego)';
}

function mostrarPanelJuego(mostrar) {
  if (btnJuegoPausar) btnJuegoPausar.style.display = (mostrar && modoBots) ? 'inline-block' : 'none';
  if (btnJuegoAbandonar) btnJuegoAbandonar.style.display = mostrar ? 'block' : 'none';
}

btnJuegoAbandonar.addEventListener('click', () => {
  socket.emit('volverMenu');
  resetEstadoClienteSala();
  mostrarView('menu');
});

btnJuegoPausar && btnJuegoPausar.addEventListener('click', () => {
  juegoPausado = !juegoPausado;
  socket.emit(juegoPausado ? 'pausarPartida' : 'reanudarPartida', { codigo: salaActual });
  actualizarIconoPausa();
});

socket.on('partidaPausada', () => { juegoPausado = true; actualizarIconoPausa(); });
socket.on('partidaReanudada', () => { juegoPausado = false; actualizarIconoPausa(); });

socket.on('comenzarJuego', ({ mapa, jugadores }) => {
  mapaActual = mapa;
  estadoJuegoActual = {};
  jugadores.forEach(j => { estadoJuegoActual[j.id] = j; });
  mostrarView('game');
  mostrarPanelJuego(true);
  canvas = document.getElementById('canvas-juego');
  ctx = canvas.getContext('2d');
  minimapa = document.getElementById('minimapa');
  mCtx = minimapa.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('keydown', e => {
    teclas[e.key] = true;
    const yo = estadoJuegoActual[socket.id];
    if ((e.key === 'e' || e.key === 'E') && yo && yo.habilidad && !yo.habilidadActiva) {
      socket.emit('usarHabilidad', { codigo: salaActual });
    }
  });
  window.addEventListener('keyup', e => { teclas[e.key] = false; });
  bucleJuego();
});

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

socket.on('estadoJuego', ({ jugadores, contratos, trampas, cofres }) => {
  estadoJuegoActual = {};
  jugadores.forEach(j => { estadoJuegoActual[j.id] = j; });
  if (mapaActual) {
    mapaActual.contratos.forEach(c => {
      const actual = contratos.find(cc => cc.id === c.id);
      if (actual) c.recogido = actual.recogido;
    });
    mapaActual.trampas.forEach(t => {
      const actual = trampas.find(tt => tt.id === t.id);
      if (actual) t.activa = actual.activa;
    });
    mapaActual.cofres.forEach(k => {
      const actual = cofres.find(kk => kk.id === k.id);
      if (actual) k.activa = actual.activa;
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

    // Contratos (📄)
    ctx.fillStyle = '#f1c40f';
    mapaActual.contratos.forEach(c => {
      if (!c.recogido) {
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('📄', c.x, c.y);
      }
    });

    // Trampas
    mapaActual.trampas.forEach(t => {
      if (t.activa) {
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.emoji, t.x, t.y);
      }
    });

    // Cofres Sorpresa (dibujo cridaner con brillo)
    mapaActual.cofres.forEach(k => {
      if (k.activa && !k.recogido) {
        const grad = ctx.createRadialGradient(k.x, k.y, 4, k.x, k.y, 26);
        grad.addColorStop(0, 'rgba(243,156,18,0.9)');
        grad.addColorStop(1, 'rgba(243,156,18,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(k.x, k.y, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f1c40f';
        ctx.fillRect(k.x - 11, k.y - 11, 22, 22);
        ctx.strokeStyle = '#d35400';
        ctx.lineWidth = 2;
        ctx.strokeRect(k.x - 11, k.y - 11, 22, 22);
        ctx.fillStyle = '#fff';
        ctx.font = '18px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💎', k.x, k.y + 2);
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
      // Nombre superior: nombre real del humano / rol del bot (sin nombre de personaje predefinido)
      const etiqueta = j.bot ? (j.rol || j.nombre) : j.nombre;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(etiqueta, j.x, j.y - 22);
      if (j.id === miId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.strokeRect(j.x - 20, j.y - 20, 40, 40);
      }
    });
  }

  ctx.restore();

  if (yo) {
    document.getElementById('hud-contratos').textContent = `${yo.contratos} / 20`;
    document.getElementById('hud-personaje').textContent = yo.rol;
    const hudHab = document.getElementById('hud-habilidad');
    if (hudHab) hudHab.textContent = yo.habilidad ? (yo.habilidadActiva ? '· ' + yo.habilidad.nombre : yo.habilidad.nombre + ' ✓') : '';
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
    mapaActual.contratos.forEach(c => {
      if (!c.recogido) {
        mCtx.fillStyle = '#f1c40f';
        mCtx.fillRect(c.x * escala - 1, c.y * escala - 1, 2, 2);
      }
    });
    mapaActual.cofres.forEach(k => {
      if (k.activa && !k.recogido) {
        mCtx.fillStyle = '#f39c12';
        mCtx.fillRect(k.x * escala - 2, k.y * escala - 2, 4, 4);
      }
    });
    Object.values(estadoJuegoActual).forEach(j => {
      mCtx.fillStyle = j.id === miId ? '#fff' : j.color;
      mCtx.fillRect(j.x * escala - 2, j.y * escala - 2, 4, 4);
    });
  }

  animFrame = requestAnimationFrame(bucleJuego);
}

socket.on('habilidadActivada', ({ jugadorId, habilidad }) => {
  const j = estadoJuegoActual[jugadorId];
  if (!j) return;
  j.habilidadActiva = true;
  const msg = document.getElementById('mensaje-habilidad');
  if (msg) {
    msg.textContent = `${j.nombre}: ${habilidad}`;
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 3000);
  }
});

// Contratos que aparecen dinámicamente durante la partida
socket.on('contratoCreado', ({ contratoId, x, y }) => {
  if (!mapaActual) return;
  if (mapaActual.contratos.some(c => c.id === contratoId)) return;
  mapaActual.contratos.push({ id: contratoId, x, y, recogido: false });
});

socket.on('contratoRecogido', ({ jugadorId, contratos }) => {
  const j = estadoJuegoActual[jugadorId];
  if (j) j.contratos = contratos;
});

socket.on('contratosPerdidos', ({ jugadorId, contratos }) => {
  const j = estadoJuegoActual[jugadorId];
  if (j) j.contratos = contratos;
});

socket.on('trampaPisada', ({ jugadorId, tipo }) => {
  const j = estadoJuegoActual[jugadorId];
  if (!j) return;
  const msg = document.getElementById('mensaje-trampa');
  msg.textContent = `${j.nombre}: ${TRAMPA_NOMBRE[tipo] || tipo}`;
  msg.style.display = 'block';
  if (mensajeTrampaTemporizador) clearTimeout(mensajeTrampaTemporizador);
  mensajeTrampaTemporizador = setTimeout(() => { msg.style.display = 'none'; }, 3000);
});

// Cofre Sorpresa recogido: notificación visible para todos
socket.on('cofreRecogido', ({ jugadorId, nombre, tipo }) => {
  const j = estadoJuegoActual[jugadorId];
  const quien = nombre || (j ? j.nombre : 'Un jugador');
  const msg = document.getElementById('mensaje-trampa');
  msg.textContent = `${quien} abrió el Cofre Sorpresa y activó ${TRAMPA_NOMBRE[tipo] || tipo} para todos los demás`;
  msg.style.display = 'block';
  if (mensajeTrampaTemporizador) clearTimeout(mensajeTrampaTemporizador);
  mensajeTrampaTemporizador = setTimeout(() => { msg.style.display = 'none'; }, 5000);
});

socket.on('cofreCreado', ({ cofreId, x, y }) => {
  if (!mapaActual) return;
  const existente = mapaActual.cofres.find(c => c.id === cofreId);
  if (existente) {
    existente.x = x; existente.y = y; existente.activa = true; existente.recogido = false;
  }
});

setInterval(() => {
  if (socket.id && estadoJuegoActual && estadoJuegoActual[socket.id]) {
    socket.emit('input', { codigo: salaActual, teclas });
  }
}, 1000 / 30);

// VISTA 7: PODIO
socket.on('partidaFinalizada', ({ podio, sala }) => {
  cancelAnimationFrame(animFrame);
  mostrarView('podium');
  mostrarPanelJuego(false);
  const contenedor = document.getElementById('podio');
  contenedor.innerHTML = '';
  podio.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = `podio-escalon`;
    div.style.transitionDelay = `${i * 0.12}s`;
    div.innerHTML = `
      <div class="puesto">${i + 1}º PUESTO</div>
      <div class="avatar-podio">${p.avatar || '👤'}</div>
      <div class="nombre-podio">${p.nombre}</div>
      ${!p.bot && p.rol ? `<div class="rol-podio">${p.rol}</div>` : ''}
      <div class="contratos-podio">${p.contratos} contratos</div>
    `;
    contenedor.appendChild(div);
  });
  setTimeout(() => {
    document.querySelectorAll('.podio-escalon').forEach(el => el.classList.add('podio-animado'));
  }, 120);
});

document.getElementById('btn-volver-jugar').onclick = () => {
  socket.emit('volverLobby', { codigo: salaActual });
  listo = false;
  const btnListoEl = document.getElementById('btn-listo-lobby');
  if (btnListoEl) { btnListoEl.textContent = 'NO LISTO'; btnListoEl.className = 'btn btn-outline'; }
  mostrarView('lobby');
};

document.getElementById('btn-menu-principal').onclick = () => {
  socket.emit('volverMenu');
  resetEstadoClienteSala();
  mostrarView('menu');
};

socket.on('volverMenuConfirmado', () => {
  resetEstadoClienteSala();
  mostrarView('menu');
});

socket.on('jugadorDesconectado', (id) => {
  delete estadoJuegoActual[id];
});

socket.on('personajeOcupado', (nombre) => {
  alert(`El personaje ${nombre} ya está ocupado por otro jugador`);
});

renderizarCarruselBots();
