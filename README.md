# Oficina Virtual

Una oficina de agentes de IA en tu Mac. Cada agente tiene su escritorio en 3D, su conversación, su memoria, sus rutinas y sus accesos. Funcionan con **Claude Code y tu suscripción de Claude**: no necesitas clave de API.

> *Versión francesa más abajo · Version française plus bas.*

## Lo que trae

- **La oficina en 3D**: un escritorio por agente, plantas, vista 2D o 3D. Varias oficinas (una por empresa), se pasa de una a otra por la puerta.
- **Mensajería integrada**: una conversación por agente, con todas tus oficinas en la barra lateral. Dictado por voz (opcional, en local).
- **Agentes**: botón «+ Agente». Cada uno es una carpeta con su `CLAUDE.md` (quién es y su misión), su memoria y sus archivos.
- **Rutinas**: tareas que el agente hace solo, a la hora que elijas, con la app abierta. Para que corran también con la app cerrada: `bash scripts/install-launchd.sh` (y otra vez tras cambiar un horario).
- **«Para ti»**: las preguntas e infos que un agente te deja fuera de la conversación, con pastillas rojas en su escritorio.
- **Informes**: nunca más de un informe sin leer por agente; los antiguos se condensan.
- **Accesos**: claves API e identificantes guardados en el **Llavero de macOS**, nunca en un archivo. El agente los recibe como variables de entorno y tiene la orden de no mostrarlos nunca (los comandos `env` y `printenv` están bloqueados).
- **Ajustes por agente**: carpetas autorizadas, herramientas permitidas, conectores, modelo.
- **Reuniones de equipo**: los agentes hablan entre ellos dos rondas y cada uno anota lo que retiene.

Al primer arranque se crea una oficina «Mi oficina» con una agente de ejemplo, Sofía. Todo lo demás lo creas tú.

## Requisitos

- Un Mac con macOS 13 o más reciente.
- Una suscripción **Claude Pro o Max**.
- [Node.js](https://nodejs.org) (versión LTS).
- [Claude Code](https://code.claude.com/docs/en/getting-started/installation), instalado y conectado a tu cuenta.

## Instalación

### Opción 1: que Claude Code lo instale por ti (recomendado)

En la Terminal:

```bash
claude
```

y pega:

```
Instala la Oficina Virtual desde https://github.com/elfrancesautomatiza/oficina-virtual en ~/oficina-virtual: clona el repo, lee INSTALAR.md, instala las dependencias, lanza la app y arregla cualquier error que aparezca.
```

### Opción 2: a mano

```bash
git clone https://github.com/elfrancesautomatiza/oficina-virtual.git ~/oficina-virtual
cd ~/oficina-virtual
npm install
npm start
```

Los días siguientes: `cd ~/oficina-virtual && npm start`.

Para tener una app de verdad en Aplicaciones: clona el repo en `~/oficina-virtual`, lanza `npm start` una vez, luego `npm run package` y copia `dist/mac*/Oficina Virtual.app` en la carpeta Aplicaciones. La app guarda tus datos en `~/oficina-virtual/offices/`.

## Crear agentes hablando, con Claude Cowork

Si tienes la app de escritorio de Claude, crea un proyecto de Cowork conectado a la carpeta `oficina-virtual` y pega en sus instrucciones el texto de [COWORK.md](COWORK.md). Le explicas lo que quieres y él crea los agentes y sus rutinas; aparecen en la oficina en cuanto vuelves a la ventana de la app.

## Cómo funciona

```
offices/<oficina>/
  office.json              nombre, dueño, color
  agents/<agente>/
    agent.json             nombre, puesto, avatar, carpetas, herramientas, rutinas
    CLAUDE.md              personalidad y misión (Claude Code lo lee solo)
    memory/MEMORY.md       memoria larga, el agente la lee y la actualiza
    routines/*.md          instrucciones de cada rutina
    inbox/                 lo que el agente tiene que decirte → pastilla
    reports/               sus informes
    workspace/             sus archivos de trabajo
    access.json            la lista de sus accesos (nunca un secreto)
```

- Cada mensaje lanza `claude -p --resume <sesión>` dentro de la carpeta del agente: cada agente tiene su conversación separada.
- El agente trabaja en su carpeta y en las que le autorizas en sus ajustes. Las herramientas (web, Terminal…) se activan agente por agente: no le des la Terminal a un agente en el que todavía no confías.
- Los agentes preparan, tú validas: antes de publicar, enviar, borrar o pagar, piden confirmación.

## Privacidad

- Todo vive en tu Mac, en `offices/`. Esa carpeta está en `.gitignore`: tus agentes y conversaciones nunca se suben a GitHub.
- Las claves y contraseñas van al Llavero de macOS (servicio `oficina-virtual`).

## Dictado por voz (opcional)

Botón micrófono → Instalar. Instala ffmpeg, whisper.cpp y un modelo de unos 470 MB (necesita [Homebrew](https://brew.sh)). Todo se transcribe en local, sin internet. Sin eso, el dictado de macOS (pulsa dos veces la tecla fn) también funciona.

## Problemas frecuentes

| Problema | Solución |
|---|---|
| `claude: command not found` | `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc` |
| `npm: command not found` | Instala Node.js (LTS) y vuelve a abrir la Terminal. |
| La app dice «Claude Code no accesible» | Abre la Terminal, escribe `claude`, conéctate, sal con `/exit` y pulsa «Volver a comprobar». |
| Un agente no responde | Mira el error en su conversación; pégaselo a Claude Code en la Terminal y pídele que lo arregle. |

Solo Mac por ahora. La interfaz y los agentes están en español.

---

## Version française

Un bureau d'agents IA sur ton Mac : bureau 3D, une conversation par agent, mémoire, routines, « Para ti », accès rangés dans le Trousseau macOS. Les agents tournent avec Claude Code et ton abonnement Claude (pas de clé API).

Installation : Node.js LTS + Claude Code connecté, puis

```bash
git clone https://github.com/elfrancesautomatiza/oficina-virtual.git ~/oficina-virtual
cd ~/oficina-virtual && npm install && npm start
```

L'interface est en espagnol.

## Licencia

MIT.
