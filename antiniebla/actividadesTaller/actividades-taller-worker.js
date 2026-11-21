/* =====================================================================
   ANTINIEBLA · ACTIVIDADES DEL TALLER · WORKER

   Es el que guarda y sirve todo: las consignas programadas y los textos
   de la gente. Las dos páginas (index.html y admin.html) le hablan a este
   Worker y a nada más.

   SE EDITA A MANO. No lo genera ningún armar-*.js, a diferencia de los
   workers de los juegos: acá no hay motor que esconder, hay datos que
   guardar. Lo pegás tal cual en Cloudflare.

   LO QUE NECESITA EN CLOUDFLARE (detalle en LEEME.md):
   · Nombre del Worker: actividades-taller  → la URL queda
     https://actividades-taller.thepablix.workers.dev, que es la que está
     escrita en las dos páginas. Si le ponés otro nombre, cambiá API allá.
   · Binding D1 con el nombre DB, apuntando a la base con esquema.sql.
   · Secreto CLAVE_ADMIN: la contraseña del panel. Larga, que no sea una
     que uses en otro lado.

   POR QUÉ LAS CONSIGNAS VIVEN ACÁ Y NO EN UN XML DEL HOSTING:
   un archivo estático se puede abrir entero, y cualquiera que mire el
   código vería las consignas de toda la semana que viene. Acá el Worker
   decide qué día es y no entrega nada del futuro. Ni el calendario dice
   si mañana hay consigna.
   ===================================================================== */

/* Los orígenes que pueden escribir. El de localhost es para probar con
   un servidor local; no molesta tenerlo. */
const ORIGENES = [
  'https://www.pablocristin.com.ar',
  'https://pablocristin.com.ar',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

/* Si lo pasás a false, la gente puede responder consignas de días
   anteriores desde el calendario. Lo dejé en true porque la gracia es
   el día: todos escribiendo sobre lo mismo al mismo tiempo. */
const RESPONDER_SOLO_HOY = true;

const MAX_TEXTO = 3000;       // caracteres. Un poema largo entra holgado
const MAX_RENGLONES = 80;
const TOPE_POR_IP = 4;        // envíos por cada 10 minutos desde la misma conexión

/* Argentina no tiene horario de verano desde 2009: UTC−3 fijo. Si eso
   cambia algún día, es esta línea. Se calcula siempre en el servidor
   para que el día cambie a la medianoche argentina para todos, aunque
   alguien tenga la hora del celular mal o esté en otro país. */
function hoyArgentina() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

const esFecha = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const esMes = s => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);

/* Las reglas de Instagram para un usuario: letras, números, punto y
   guion bajo, hasta 30. No podemos verificar que la cuenta sea de quien
   la escribe — eso pediría que se loguee con Instagram, y rompe el "sin
   registro". Para el que se haga pasar por otro está el panel. */
function limpiarUsuario(u) {
  u = String(u || '').trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(u) && !/^\.|\.$|\.\./.test(u) ? u : null;
}

function cabecerasCors(req) {
  const o = req.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Clave',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (o && ORIGENES.includes(o)) h['Access-Control-Allow-Origin'] = o;
  return h;
}

function responder(req, datos, estado = 200, extra = {}) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cabecerasCors(req), ...extra }
  });
}
const error = (req, msj, estado = 400) => responder(req, { error: msj }, estado);

async function hash(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/* Comparación de largo fijo: con un === común, en teoría se puede ir
   adivinando la clave midiendo cuánto tarda en fallar. En la práctica,
   por internet, es casi imposible; pero cuesta tres líneas no dejarlo. */
function claveOk(env, dada) {
  const real = String(env.CLAVE_ADMIN || '');
  dada = String(dada || '');
  if (!real || real.length !== dada.length) return false;
  let d = 0;
  for (let i = 0; i < real.length; i++) d |= real.charCodeAt(i) ^ dada.charCodeAt(i);
  return d === 0;
}

async function leerJson(req) {
  try { return await req.json(); } catch { return null; }
}

/* ---------------------------------------------------------------------
   LECTURAS PÚBLICAS
   --------------------------------------------------------------------- */
async function consignaYRespuestas(env, fecha) {
  const consigna = await env.DB
    .prepare('SELECT fecha, titulo, texto, regla, pista FROM consignas WHERE fecha = ?')
    .bind(fecha).first();
  const { results } = await env.DB
    .prepare('SELECT id, usuario, texto, creada FROM respuestas WHERE fecha = ? AND oculta = 0 ORDER BY creada DESC')
    .bind(fecha).all();
  return { consigna: consigna || null, respuestas: results || [] };
}

async function rutaDia(req, env, url) {
  const hoy = hoyArgentina();
  const fecha = url.searchParams.get('fecha') || hoy;
  if (!esFecha(fecha)) return error(req, 'Fecha inválida.');
  /* un día futuro responde exactamente igual que un día sin consigna:
     así no se puede saber, preguntando, qué días ya están programados */
  if (fecha > hoy) return responder(req, { hoy, fecha, consigna: null, respuestas: [], abierta: false });
  const d = await consignaYRespuestas(env, fecha);
  const abierta = !!d.consigna && (fecha === hoy || !RESPONDER_SOLO_HOY);
  /* sin caché: un texto recién subido tiene que aparecer al toque. D1
     aguanta de sobra el tráfico de un taller sin ayuda */
  return responder(req, { hoy, fecha, abierta, ...d }, 200, { 'Cache-Control': 'no-store' });
}

async function rutaMes(req, env, url) {
  const hoy = hoyArgentina();
  const mes = url.searchParams.get('mes') || hoy.slice(0, 7);
  if (!esMes(mes)) return error(req, 'Mes inválido.');
  const { results } = await env.DB.prepare(
    `SELECT c.fecha, c.titulo,
            (SELECT COUNT(*) FROM respuestas r WHERE r.fecha = c.fecha AND r.oculta = 0) AS cantidad
       FROM consignas c
      WHERE c.fecha LIKE ? AND c.fecha <= ?
      ORDER BY c.fecha`
  ).bind(mes + '-%', hoy).all();
  return responder(req, { hoy, mes, dias: results || [] }, 200, { 'Cache-Control': 'no-store' });
}

/* ---------------------------------------------------------------------
   SUBIR UN TEXTO
   --------------------------------------------------------------------- */
async function rutaResponder(req, env) {
  const o = req.headers.get('Origin');
  if (!o || !ORIGENES.includes(o)) return error(req, 'Origen no permitido.', 403);

  const b = await leerJson(req);
  if (!b) return error(req, 'No llegó nada.');

  /* el campo "sitio" está escondido en la página: una persona no lo ve
     y no lo llena; un robot que completa todo, sí. Le decimos que salió
     bien para que no aprenda nada. */
  if (b.sitio) return responder(req, { ok: true });

  const hoy = hoyArgentina();
  const fecha = b.fecha || hoy;
  if (!esFecha(fecha) || fecha > hoy) return error(req, 'Ese día todavía no llegó.');
  if (RESPONDER_SOLO_HOY && fecha !== hoy)
    return error(req, 'Esa consigna ya cerró. Hoy hay otra.', 409);

  const usuario = limpiarUsuario(b.usuario);
  if (!usuario) return error(req, 'Ese usuario de Instagram no parece válido: letras, números, punto y guion bajo.');

  let texto = String(b.texto || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
  texto = texto.replace(/\n{4,}/g, '\n\n\n');   // tres saltos alcanzan para cualquier estrofa
  if (texto.length < 3) return error(req, 'El texto está vacío.');
  if (texto.length > MAX_TEXTO) return error(req, `Te pasaste: el tope es ${MAX_TEXTO} caracteres.`);
  if (texto.split('\n').length > MAX_RENGLONES) return error(req, `Te pasaste: el tope es ${MAX_RENGLONES} renglones.`);

  const consigna = await env.DB.prepare('SELECT fecha FROM consignas WHERE fecha = ?').bind(fecha).first();
  if (!consigna) return error(req, 'Ese día no tiene consigna.', 404);

  const ip = req.headers.get('CF-Connecting-IP') || '';
  const ipHash = await hash(ip + '|' + (env.CLAVE_ADMIN || 'sal'));
  const hace10 = Date.now() - 10 * 60 * 1000;
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM respuestas WHERE ip_hash = ? AND creada > ?')
    .bind(ipHash, hace10).first('n');
  if (n >= TOPE_POR_IP) return error(req, 'Muchos envíos seguidos. Esperá unos minutos.', 429);

  try {
    const r = await env.DB.prepare(
      'INSERT INTO respuestas (fecha, usuario, texto, creada, ip_hash) VALUES (?, ?, ?, ?, ?)'
    ).bind(fecha, usuario, texto, Date.now(), ipHash).run();
    return responder(req, { ok: true, id: r.meta.last_row_id, usuario, texto, fecha });
  } catch (e) {
    if (String(e).includes('UNIQUE'))
      return error(req, `@${usuario} ya subió un texto hoy. Uno por día.`, 409);
    throw e;
  }
}

/* ---------------------------------------------------------------------
   PANEL (todo lo que sigue pide la clave en la cabecera X-Clave)
   --------------------------------------------------------------------- */
async function rutaAdmin(req, env, url, ruta) {
  if (!claveOk(env, req.headers.get('X-Clave'))) return error(req, 'Clave incorrecta.', 401);
  const m = req.method;

  if (ruta === '/admin/consignas' && m === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM respuestas r WHERE r.fecha = c.fecha) AS cantidad
         FROM consignas c ORDER BY c.fecha DESC`
    ).all();
    return responder(req, { hoy: hoyArgentina(), consignas: results || [] });
  }

  if (ruta === '/admin/consigna' && m === 'POST') {
    const b = await leerJson(req);
    if (!b || !esFecha(b.fecha)) return error(req, 'Falta la fecha.');
    const texto = String(b.texto || '').trim();
    if (!texto) return error(req, 'Falta el texto de la consigna.');
    /* INSERT ... ON CONFLICT: guardar sobre una fecha que ya tiene
       consigna la reemplaza. Así editar y crear son el mismo botón. */
    await env.DB.prepare(
      `INSERT INTO consignas (fecha, titulo, texto, regla, pista, creada) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(fecha) DO UPDATE SET titulo = excluded.titulo, texto = excluded.texto,
                                        regla = excluded.regla, pista = excluded.pista`
    ).bind(b.fecha, String(b.titulo || '').trim(), texto,
           String(b.regla || '').trim(), String(b.pista || '').trim(), Date.now()).run();
    return responder(req, { ok: true });
  }

  if (ruta === '/admin/consigna' && m === 'DELETE') {
    const fecha = url.searchParams.get('fecha');
    if (!esFecha(fecha)) return error(req, 'Fecha inválida.');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM respuestas WHERE fecha = ?').bind(fecha).first('n');
    /* borrar una consigna con textos dejaría poemas huérfanos que nadie
       vería nunca más. Mejor que el panel lo frene y lo diga. */
    if (n > 0 && url.searchParams.get('forzar') !== '1')
      return error(req, `Esa consigna tiene ${n} texto(s). Borralos primero o confirmá.`, 409);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM respuestas WHERE fecha = ?').bind(fecha),
      env.DB.prepare('DELETE FROM consignas WHERE fecha = ?').bind(fecha)
    ]);
    return responder(req, { ok: true });
  }

  if (ruta === '/admin/respuestas' && m === 'GET') {
    const fecha = url.searchParams.get('fecha');
    if (!esFecha(fecha)) return error(req, 'Fecha inválida.');
    const { results } = await env.DB.prepare(
      'SELECT id, usuario, texto, creada, oculta FROM respuestas WHERE fecha = ? ORDER BY creada DESC'
    ).bind(fecha).all();
    return responder(req, { respuestas: results || [] });
  }

  if (ruta === '/admin/ocultar' && m === 'POST') {
    const b = await leerJson(req);
    if (!b || !Number.isInteger(b.id)) return error(req, 'Falta el id.');
    await env.DB.prepare('UPDATE respuestas SET oculta = ? WHERE id = ?').bind(b.oculta ? 1 : 0, b.id).run();
    return responder(req, { ok: true });
  }

  if (ruta === '/admin/respuesta' && m === 'DELETE') {
    const id = parseInt(url.searchParams.get('id'), 10);
    if (!id) return error(req, 'Falta el id.');
    await env.DB.prepare('DELETE FROM respuestas WHERE id = ?').bind(id).run();
    return responder(req, { ok: true });
  }

  return error(req, 'No existe.', 404);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecerasCors(req) });
    const url = new URL(req.url);
    const ruta = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (!env.DB) return error(req, 'Falta el binding DB en el Worker.', 500);
      if (ruta === '/dia' && req.method === 'GET') return await rutaDia(req, env, url);
      if (ruta === '/mes' && req.method === 'GET') return await rutaMes(req, env, url);
      if (ruta === '/responder' && req.method === 'POST') return await rutaResponder(req, env);
      if (ruta.startsWith('/admin/')) return await rutaAdmin(req, env, url, ruta);
      if (ruta === '/') return responder(req, { ok: true, hoy: hoyArgentina() });
      return error(req, 'No existe.', 404);
    } catch (e) {
      /* el detalle va al log de Cloudflare, no al visitante */
      console.error(e);
      return error(req, 'Algo se rompió del lado del servidor. Probá de nuevo en un rato.', 500);
    }
  }
};
