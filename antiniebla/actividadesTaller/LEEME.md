# Una consigna por día — cómo se pone en marcha

Cuatro archivos:

| Archivo | Qué es | Dónde va |
|---|---|---|
| `index.html` | La página pública | Hosting, en `antiniebla/actividadesTaller/` |
| `admin.html` | Tu panel para cargar consignas y moderar | Hosting, misma carpeta |
| `actividades-taller-worker.js` | El Worker que guarda y sirve todo | Cloudflare |
| `esquema.sql` | Las tablas de la base | Se corre una vez en la consola de D1 |

A diferencia de los juegos, acá **no hay build**: no se corre ningún
`armar-*.js`, no hay `?v=` ni sello de versión. Se edita y se sube.

## Primera vez (unos 10 minutos, todo desde el panel de Cloudflare)

1. **Crear la base.** Storage & Databases → D1 → *Create database*.
   Nombre: `actividades-taller`.
2. **Crear las tablas.** Entrá a la base → *Console* → pegá todo
   `esquema.sql` → *Execute*.
3. **Crear el Worker.** Workers & Pages → *Create* → *Worker*.
   Nombre exacto: **`actividades-taller`** (de ahí sale la URL que está
   escrita en las dos páginas). Pegá `actividades-taller-worker.js` en el
   editor y *Deploy*.
4. **Conectar la base al Worker.** En el Worker → Settings → Bindings →
   *Add* → D1 database. Variable name: **`DB`**. Base: `actividades-taller`.
5. **La clave del panel.** Settings → Variables and Secrets → *Add* →
   tipo **Secret**, nombre **`CLAVE_ADMIN`**, valor: una frase larga que no
   uses en otro lado.
6. **Probar.** Abrí `https://actividades-taller.thepablix.workers.dev/` —
   tiene que responder `{"ok":true,"hoy":"…"}`. Si dice *Falta el binding
   DB*, es el paso 4.
7. **Subir** `index.html` y `admin.html` al hosting.
8. **Cargar la primera consigna** desde `…/antiniebla/actividadesTaller/admin.html`.

Opcional: sumar la página al `sitemap.xml` y una tarjeta en la portada de
AntiNiebla. `admin.html` **no** va al sitemap.

## El día a día

- **Programar** es cargar con fecha futura. Aparece sola a las 00:00 de
  Argentina, igual para todos, sin importar la hora del celular de cada uno.
- Lo programado **no se filtra**: ni la página, ni el calendario, ni
  preguntándole al Worker a mano se puede ver una consigna antes de su día.
- **Cargar en tanda** te deja programar un mes de una sentada (el formato
  está explicado en el panel).
- **Moderar**: en «Las que hay» → *Ver textos*. *Ocultar* se puede deshacer;
  *Borrar* no.

## Decisiones que conviene saber

- **Solo se responde la consigna del día.** Las anteriores se leen desde el
  calendario pero no se contestan. Si querés que sí, en el Worker:
  `RESPONDER_SOLO_HOY = false`.
- **Uno por usuario por día.** Si alguien quiere corregir, borrás el suyo y
  lo vuelve a subir.
- **El usuario de Instagram no se verifica.** Cualquiera puede escribir
  `@peblix`. Verificarlo pediría login con Instagram, y eso rompe el «sin
  registro». Para el que se haga pasar por otro está *Ocultar*.
- **Contra el spam:** campo trampa para robots, tope de 4 envíos cada 10
  minutos por conexión, 3000 caracteres y 80 renglones como máximo. No se
  guarda la IP, solo un hash que no se puede revertir.
- **Compartir:** en el celular abre el menú de compartir del sistema con la
  imagen (ahí aparecen historia de Instagram y WhatsApp). Desde una web no
  existe forma de mandar una imagen *directo* a una historia de IG: Instagram
  no lo permite. En la compu se descarga.
- **Si cambiás el dominio de la página**, actualizá `ORIGENES` en el Worker:
  el Worker solo acepta textos que vengan desde ahí.

## Costos

D1 y Workers en plan gratis: 5 millones de lecturas y 100.000 escrituras por
día. Un taller con cientos de personas no llega ni al 1%.
