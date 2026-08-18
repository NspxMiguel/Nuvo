# Prompt pro Claude Design

Copiar daqui pra baixo.

---

Preciso do desenho de interface de um app chamado **IAUnifier**.

## O que é

Um app que roda no servidor de casa e junta **todas as IAs num lugar só**: modelos
locais (Ollama), modelos de API (Claude, GPT, Gemini) e IAs de linha de comando
(Claude Code, Codex). Você abre uma aba e fala com qualquer uma delas.

A ideia que sustenta o app, e que precisa aparecer no desenho: **a memória é
compartilhada entre todas.** O que você contou pro Claude, o GPT sabe. Não é um
agregador de chats — é uma memória só, com várias vozes em cima dela. Se o
desenho tratar isso como mais um item de menu, perdeu o ponto.

## Quem usa, e onde

Uma pessoa só — o dono da máquina. Não tem conta, não tem equipe, não tem
cadastro. Abre pelo navegador na rede de casa, instalado como app: **celular e
computador, os dois de verdade**. No celular é uso de sofá; no computador é uso
de trabalho, com várias conversas abertas.

Idioma: **português do Brasil**.

## As 8 telas

1. **Conversas** — o chat. Lista lateral de conversas, mensagens, campo de
   escrever. Cada resposta chega **em streaming**, letra por letra. Tem bloco de
   raciocínio que dá pra abrir e fechar, anexos (PDF, docx, epub, imagem),
   estatística por resposta (tempo, tokens) e um botão de refazer com outro
   modelo. Dá pra trocar de modelo no meio da conversa.
2. **Conselho** — a mesma pergunta vai pra vários modelos **ao mesmo tempo**, em
   colunas paralelas. Três modos: *comparar* (lado a lado), *conselho* (mais uma
   resposta final costurada por um modelo juiz) e *votação* (cada modelo dá nota
   às respostas dos outros, sem saber de quem é cada uma, e sai um placar com
   vencedor).
3. **Pesquisa** — pesquisa profunda na web. Mostra o andamento ao vivo: planejou
   estas buscas → buscando isto → lendo estas páginas → escrevendo. Termina num
   relatório com fontes numeradas e clicáveis.
4. **Projetos** — pastas de trabalho. Cada projeto tem arquivos, instrução
   própria e memória própria.
5. **Gems** — personalidades salvas (instrução + modelo + temperatura), pra
   chamar direto.
6. **Memória** — a lista de fatos que o app sabe sobre você. Cada fato mostra de
   onde veio (de qual conversa, de qual importação) e se vale pra tudo ou só pra
   um projeto. Dá pra editar e apagar. É aqui que o app se explica.
7. **Provedores** — onde as IAs são ligadas. Três tipos bem diferentes que hoje
   parecem iguais na tela: **local** (Ollama, com download de modelo e barra de
   progresso), **API** (chave, custo por token) e **CLI** (programa instalado na
   máquina). Cada um com estado de saúde e lista de modelos.
8. **Config** — tema, token de acesso, backup, importar conversa de outras IAs.

## Os momentos difíceis (onde o desenho decide)

Estes são os que eu quero ver resolvidos, não os formulários:

- **conselho em paralelo**: 2 a 5 colunas enchendo em velocidades diferentes.
  Uma termina em 3 segundos, outra em 40, uma falha. Depois some tudo numa
  resposta final. Como isso não vira bagunça?
- **placar da votação**: nota média por modelo, quem votou o quê, o vencedor —
  e uma linha discreta pra "1 voto anulado: nota fora da escala";
- **o andamento da pesquisa**: um registro que cresce sozinho por uns 40
  segundos e depois é substituído pelo relatório. Enquanto cresce, tem que dar
  vontade de esperar;
- **a resposta chegando**: streaming, com bloco de raciocínio que pode ser
  enorme e não pode roubar a cena;
- **primeira abertura**: nenhum modelo configurado ainda. O app procura sozinho
  o que tem na máquina. Essa tela decide se a pessoa continua;
- **erro de provedor**: chave errada, Ollama desligado, cota estourada. Tem que
  dizer o que fazer, não só que falhou.

## O que já existe e não pode quebrar

O app **funciona hoje** — servidor, banco, 284 testes passando. O desenho entra
por cima, não por baixo. Então:

- **sem etapa de build.** HTML, CSS e ES modules servidos direto. Nada de React,
  Tailwind, bundler, npm install. Se precisar de uma biblioteca, ela tem que
  caber num arquivo servido pelo próprio app — não tem CDN, o app roda na rede
  de casa e às vezes sem internet;
- **os `id` e `data-view` do HTML são a fiação.** `#chat-list`, `#sidebar`,
  `#nav`, `data-view="chat"`, etc. Pode mudar tudo de aparência, estrutura e
  classe — mas se um `id` sumir, o app para. Se precisar mexer em algum, diz
  qual e por quê;
- **tema claro e escuro nos dois**, por variável CSS. Já existe um conjunto
  (`--bg`, `--panel`, `--panel-2`, `--panel-3`, `--line`, `--text`, `--muted`,
  `--accent`, `--danger`, `--ok`, `--warn`, mais 8 cores de rótulo). Pode trocar
  os valores, e pode propor outro conjunto — só me diz o que mudou;
- **celular de verdade**: 375 px de largura sem barra horizontal, alvo de toque
  com 44 px, campo de texto com 16 px (abaixo disso o iPhone dá zoom sozinho e
  desalinha tudo), e a área segura do notch respeitada;
- **PWA**: instala na tela inicial e abre em tela cheia. Precisa de ícone que
  funcione recortado em círculo (Android corta).

## A paleta de hoje

Escuro: fundo `#0e0e13`, painel `#15151c`, texto `#e8e8f0`, acento `#6b8afd`.
Claro: fundo `#f6f6f9`, painel `#ffffff`, texto `#1b1b24`, acento `#4661d8`.
Canto de 10 px.

**Não estou apegado.** Isso é o que saiu de escrever o app às pressas, não uma
decisão de desenho. Se tiver um caminho melhor, quero ver — inclusive um que não
pareça "mais um app de chat escuro com azul", que é exatamente o que ele parece
hoje.

## O código está aberto

**https://github.com/NspxMiguel/IAUnifier** — público, pode ler tudo.

O que interessa pro desenho está em `web/`, e são poucos arquivos:

| arquivo | linhas | o que é |
| --- | ---: | --- |
| `web/index.html` | 126 | a casca. **Aqui moram os `id` e os `data-view` que são a fiação** — é o arquivo pra ler primeiro |
| `web/styles.css` | 772 | tudo que é aparência hoje, e os tokens de tema no `:root` |
| `web/views.js` | 1153 | o que cada tela desenha: `renderCouncil`, `renderResearch`, `renderMemory`, `renderProviders`, `renderSettings`, `renderFirstRun`, `renderOllamaManager` |
| `web/app.js` | 1201 | a conversa e o streaming: é onde os eventos `delta`, `reasoning`, `phase`, `stats` viram tela |
| `web/icons.js` | 79 | os ícones, em SVG inline |
| `web/md.js` | 272 | markdown e bloco de código |

O resto (`server/`, `test/`, `bin/`) é o back-end e não entra no desenho — mas
serve pra entender o que cada tela recebe: os eventos que chegam por streaming
estão em `server/chat.mjs`, `server/council.mjs` e `server/research.mjs`, e são
eles que definem os estados que a tela precisa saber mostrar.

`PEDIDOS.md`, na raiz, é o registro do que foi pedido e consertado — dá o
histórico de por que as coisas estão do jeito que estão.

## O que eu quero de volta

O desenho das 8 telas, em celular e computador, com os momentos difíceis acima
resolvidos — e o CSS pra valer, não só a imagem.

