# 🧬 Preguntero

Juego de preguntas y respuestas de **Biología** pensado para un **stand de feria** o un aula, con **una sola compu**. Las personas se acercan, escriben su nombre, responden contra reloj y al final ven su puntaje y su **posición en el ranking**. Después la pantalla vuelve sola al inicio para el siguiente jugador.

Es una **app web instalable (PWA)**: se instala una vez y después **funciona sin internet**. Todos los datos quedan en la compu, en el navegador y en un **archivo de respaldo** que se guarda solo.

## ✨ Qué tiene

**En el stand**
- Pantalla de inicio con el **top 5** del ranking para llamar la atención.
- Ingreso con **nombre** y **curso opcional**, más un personaje (célula, bacteria, virus, rana, hongo, pez, hoja o ADN).
- **6 preguntas por persona** (se puede cambiar), 20 segundos cada una, con temporizador animado.
- Puntaje: 500 por acertar + hasta 500 extra por velocidad + bonus por **racha** de aciertos.
- Después de cada respuesta se muestra la correcta y una **explicación**.
- Al final: puntaje, **"Quedaste 7° de 43"** y vuelta automática al inicio a los 20 segundos.
- Si alguien abandona a mitad de partida, a los 90 segundos sin tocar nada vuelve al inicio.
- **Ranking total** con podio para los 3 mejores.
- Mascota animada ("Celu"), confeti, sonidos (se pueden silenciar) e ilustraciones SVG propias.

**Panel docente** (candado chiquito abajo en el inicio, o `#/profesor`; protegido con PIN)
- Crear, editar y borrar preguntas con 2 a 4 opciones, tema, explicación e imagen opcional.
- Elegir cuántas preguntas responde cada persona (por defecto 6) y si se mezclan.
- Cambiar el PIN (el inicial es `biologia`).
- **Archivo de respaldo automático**, copia completa, restauración, importar y exportar preguntas y reiniciar el ranking.
- Botones de **pantalla completa** e **instalar app**.
- Al salir del panel se cierra la sesión, así el público nunca lo encuentra abierto.

Trae 16 preguntas de ejemplo: célula, ADN y genética, división celular, evolución, ecología, metabolismo y biomoléculas.

## 💾 Dónde se guardan los datos

1. **En el navegador (IndexedDB).** Cerrar la pestaña, el navegador o apagar la compu **no borra nada**. La app además pide almacenamiento "protegido" para que el navegador no lo libere por falta de espacio. Solo se pierde si alguien borra los datos de navegación o si se usa en modo incógnito.
2. **En un archivo de la compu** (por ejemplo `Documentos/preguntero-datos.json`). Se configura una vez en **Panel docente → Datos y respaldo → Crear archivo de respaldo**. Desde ahí, cada partida y cada cambio se escriben solos en ese archivo.
   - Funciona en **Chrome** y **Edge** de escritorio. En otros navegadores se puede usar **Descargar copia** a mano.
   - Cuando se vuelve a abrir el navegador, Chrome puede pedir permiso de nuevo para escribir en el archivo. En ese caso aparece arriba el aviso **"El guardado en archivo está en pausa · Reanudar"**: un clic y listo. Si Chrome ofrece **"Permitir en cada visita"**, elegilo y no vuelve a preguntar.
3. **Si se borraron los datos del navegador**: Panel docente → Datos y respaldo → **Usar un archivo existente** (elegí `preguntero-datos.json` y aceptá cargar sus datos) o **Restaurar desde archivo**.

El mismo archivo sirve para pasar todo a otra compu.

## 🚀 Instalarlo

La compu del stand necesita internet **solo la primera vez**, para instalar la app.

1. Publicá la carpeta `public/` en un sitio con **HTTPS** (ver abajo).
2. En la compu del stand, abrí el link en **Chrome** o **Edge** y entrá al panel docente → **Instalar app** (o el ícono de instalar en la barra de direcciones).
3. En el panel: cambiá el PIN, revisá las preguntas y creá el **archivo de respaldo**.
4. Listo: la app queda con su ícono en el escritorio y anda sin conexión.

Cuando publiques una versión nueva, la app se actualiza sola la próxima vez que la compu tenga internet (se aplica al volver a la pantalla de inicio, nunca a mitad de una partida). Al cambiar archivos de `public/`, subí el número de `VERSION` en `public/sw.js`.

### Publicarla en tu VPS

La app son archivos estáticos: alcanza con cualquier servidor web. Con Nginx:

```nginx
server {
    server_name preguntero.tudominio.com;
    root /var/www/preguntero/public;
    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ /index.html;
    }
}
```

Para el HTTPS (obligatorio para instalar la app), usá Let's Encrypt:

```bash
sudo certbot --nginx -d preguntero.tudominio.com
```

También sirve cualquier hosting estático gratis, como GitHub Pages, Netlify o Cloudflare Pages: la app usa rutas relativas y funciona en una subcarpeta.

### Probarla en tu compu

Con [Node.js](https://nodejs.org) 18 o superior (no hay dependencias que instalar):

```bash
npm start
```

Abrí <http://localhost:3000>. En `localhost` también se puede instalar y probar sin conexión. `server.js` solo entrega los archivos de `public/`; el puerto se cambia con la variable `PORT`.

### Modo kiosco (opcional)

Para que el público no pueda salir de la app, abrí Chrome en modo kiosco con el link de la app:

```bash
chrome --kiosk https://preguntero.tudominio.com
```

En Windows se puede crear un acceso directo con `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk https://preguntero.tudominio.com`. Para salir: `Alt+F4`. Si no, alcanza con el botón **Pantalla completa** del panel.

## 🗂️ Estructura

```
public/index.html            Página e ilustraciones SVG
public/styles.css            Estilos
public/app.js                Juego, ranking y panel docente
public/db.js                 Datos (IndexedDB) y archivo de respaldo automático
public/sw.js                 Service worker: guarda la app para usarla sin internet
public/manifest.webmanifest  Datos para instalar la app
public/seed-questions.json   Preguntas de ejemplo (se cargan la primera vez)
public/fonts/                Baloo 2 y Nunito (SIL OFL), incluidas para no depender de internet
public/img/                  Íconos de la app
public/sounds/, vendor/      Efectos de Kenney (CC0) y Howler.js (MIT); hoy app.js usa tonos generados con Web Audio
server.js                    Servidor estático mínimo para probar en la compu
```

## 📄 Formato para importar preguntas

```json
[
  {
    "text": "¿Qué organela realiza la fotosíntesis?",
    "answers": ["Mitocondria", "Cloroplasto", "Ribosoma", "Núcleo"],
    "correct": 1,
    "topic": "Célula",
    "explanation": "Los cloroplastos tienen clorofila, que capta la luz."
  }
]
```

`correct` es la posición de la respuesta correcta, empezando en 0. Las imágenes subidas desde la compu quedan guardadas y se ven sin internet; las que se cargan por link necesitan conexión.
