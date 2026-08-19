// Service worker mínimo: só o suficiente pra instalar como app no celular.
//
// Guarda a casca (HTML, CSS, JS, ícones) e nunca toca em /api — resposta de
// API com token e stream de conversa não podem sair de cache.

const CACHE = 'iaunifier-v6';
// Módulo que o app importa e não está aqui só falta quando a rede cai — que é
// exatamente quando o cache tinha que servir. O test/sw.test.mjs compara esta
// lista com os arquivos de web/ pra não ficar pra trás de novo.
const SHELL = [
  '/', '/index.html', '/styles.css',
  '/app.js', '/core.js', '/views.js', '/icons.js', '/md.js', '/glow.js', '/format.js', '/i18n.js',
  '/requisitos.js',
  // O manifest NÃO entra aqui. Ele carrega o token dentro do `start_url`, então
  // o servidor exige token pra devolvê-lo — e o service worker pede sem token.
  // Com ele na lista, o `addAll` inteiro era recusado por causa de um 401, a
  // instalação falhava e o app nunca chegava a funcionar sem rede. O navegador
  // lê o manifest na hora de instalar, com os cabeçalhos da página; offline ele
  // não faz falta.
  '/icon-192.png', '/icon-512.png',
  // Os dicionários entram na casca porque a tela sem rede tem que continuar no
  // idioma que a pessoa escolheu — cair pro português seria a troca se desfazer
  // justamente quando ela não pode refazer.
  '/idiomas/en.json', '/idiomas/es.json'
];

self.addEventListener('install', (event) => {
  // Um arquivo por vez, e falha de um não derruba os outros. `addAll` é tudo ou
  // nada: bastou um 401 pra instalação inteira ser recusada e o app ficar sem
  // versão offline por completo, calado. Um arquivo que faltar aparece na
  // primeira vez que a rede cair, não no dia em que alguém trocar uma rota.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        Promise.all(
          SHELL.map((caminho) =>
            c.add(caminho).catch((err) => {
              console.warn('[sw] fora da casca:', caminho, String(err));
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Rede primeiro: o servidor é local, então é rápido e sempre atual.
  // O cache só entra quando o servidor está fora do ar.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Só resposta boa entra no cache. Um 500 momentâneo no `app.js` viraria
        // a versão offline permanente, e o app abriria quebrado sem servidor.
        if (res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/index.html')))
  );
});
