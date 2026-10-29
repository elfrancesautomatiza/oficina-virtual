# Instrucciones de instalación (para Claude Code)

Estás instalando la Oficina Virtual en el Mac de alguien que puede no saber nada de programación. Explica cada paso en una frase simple, en su idioma.

1. Comprueba los requisitos:
   - `sw_vers -productVersion` → macOS 13 o más.
   - `node -v` → si falta, pídele que instale la versión LTS desde https://nodejs.org y que vuelva a abrir la Terminal. No instales Node tú mismo con sudo.
   - `claude --version` → ya estás corriendo, así que existe. Anota su ruta con `command -v claude`.
   - Si macOS pide instalar las «herramientas de desarrollo de línea de comandos», dile que acepte.
2. En la carpeta del repo: `npm install`. Si falla, lee el error y arréglalo (no uses `sudo npm`).
3. `npm run typecheck` y `npm test` deben pasar. Si algo falla, explica qué y no cambies el código sin decirlo.
4. Lanza la app: `npm start`. Se abre la ventana «Oficina Virtual» con la oficina «Mi oficina» y la agente Sofía.
5. Si la app dice que Claude Code no es accesible: comprueba que `claude` funciona en la Terminal y que el usuario está conectado.
6. Al final, dile:
   - cómo abrirla los días siguientes: `cd <carpeta> && npm start`;
   - que haga clic en Sofía y le escriba un primer mensaje;
   - que sus datos viven en `offices/` y nunca se suben a GitHub.

Nunca pidas ni escribas una contraseña o una clave API. Los accesos se añaden desde la app (pestaña Accesos de cada agente) y van al Llavero de macOS.
