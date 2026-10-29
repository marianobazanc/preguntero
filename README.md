# 🧬 Preguntero

Juego de preguntas y respuestas para **Biología de 4° año** de secundaria. Funciona en compu, tablet y celular.

Los alumnos escriben su nombre, eligen un personaje y responden contra reloj. Al final ven su puntaje y un **ranking** con **podio** para los 3 mejores. El docente carga las preguntas desde un panel propio.

## ✨ Qué tiene

**Para los alumnos**
- Ingreso con nombre y personaje (célula, bacteria, virus, rana, hongo, pez, hoja o ADN).
- 20 segundos por pregunta, con temporizador animado.
- Puntaje: 500 por acertar + hasta 500 extra por velocidad + bonus por **racha** de aciertos.
- Después de cada respuesta se muestra la correcta y una **explicación** para aprender del error.
- Tema claro con colores planos. Mascota animada ("Celu", una célula), sonidos, confeti e ilustraciones SVG propias de biología. No usa emojis, así que se ve igual en Windows, Android y iPhone.
- Ranking que se actualiza solo cada 5 segundos, ideal para proyectar en el aula.
- Sonidos de juego reales (efectos y jingles de [Kenney](https://kenney.nl), licencia CC0) reproducidos con [Howler.js](https://howlerjs.com): tic-tac del contrarreloj que se acelera en los últimos 5 segundos, cuenta regresiva, transiciones entre pantallas, aparición de las opciones, acierto, error, rachas, puntaje que sube contando y fanfarria de steel drum en el podio. Se pueden silenciar con el botón del parlante.

**Para el docente** (`/#/profesor`, protegido con PIN)
- Crear, editar y borrar preguntas con 2 a 4 opciones, marcando la correcta.
- Tema, explicación e imagen opcional (subida desde el dispositivo o por link).
- Elegir cuántas preguntas tiene cada partida y si se mezclan.
- Exportar e importar preguntas en JSON (para respaldar o compartir entre cursos).
- Reiniciar el ranking (por ejemplo, al cambiar de división).

Trae 16 preguntas de ejemplo: célula, ADN y genética, división celular, evolución, ecología, metabolismo y biomoléculas.

## 🚀 Cómo usarlo

Solo hace falta [Node.js](https://nodejs.org) 18 o superior. No hay dependencias que instalar.

```bash
npm start
```

Abrí <http://localhost:3000>. El panel docente está en <http://localhost:3000/#/profesor>.

El PIN por defecto es `biologia`. **Cambialo** con la variable de entorno `ADMIN_PIN`:

```bash
ADMIN_PIN=MiClaveSecreta npm start
```

### Jugar en clase desde los celulares

Si la compu del docente y los celulares están en la misma red Wi-Fi, los alumnos pueden entrar a `http://<IP-de-la-compu>:3000`. Para usarlo desde cualquier lugar, publicalo en un servicio como Render, Railway o Fly.io (ver abajo).

### Variables de entorno

| Variable    | Por defecto | Para qué sirve                               |
|-------------|-------------|----------------------------------------------|
| `PORT`      | `3000`      | Puerto del servidor                          |
| `ADMIN_PIN` | `biologia`  | PIN del panel docente                        |
| `DATA_DIR`  | `./data`    | Carpeta donde se guardan preguntas y ranking |

## ☁️ Publicarlo en internet

Cualquier hosting que corra Node sirve. El comando de inicio es `npm start`.

Las preguntas y el ranking se guardan en archivos JSON dentro de `DATA_DIR`. En servicios con disco efímero (como el plan gratis de Render), esos datos se borran en cada reinicio. Para que no se pierdan, montá un disco persistente y apuntá `DATA_DIR` a esa carpeta. También conviene exportar las preguntas cada tanto desde **Ajustes → Exportar**.

## 🗂️ Estructura

```
server.js                 Servidor HTTP + API (sin dependencias)
data/seed-questions.json  Preguntas de ejemplo (se copian la primera vez)
public/index.html         Página e ilustraciones SVG
public/styles.css         Estilos
public/app.js             Lógica del juego, ranking y panel docente
public/sounds/            Efectos de sonido en MP3 (Kenney, CC0)
public/vendor/            Howler.js (MIT), incluida para no depender de internet
```

La respuesta correcta nunca se envía al navegador del alumno antes de que responda: el servidor corrige cada respuesta y calcula los puntos.

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

`correct` es la posición de la respuesta correcta, empezando en 0.
