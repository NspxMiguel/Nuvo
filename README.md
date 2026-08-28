# Nuvo

Servidor de IA para rodar na própria máquina. Junta modelo local, modelo de API
e IA de linha de comando numa interface só — e dá a todos eles **a mesma
memória**. O que você contou pro Claude, o GPT sabe na próxima conversa.

Roda em Windows, macOS e Linux. Abre no navegador do PC e instala como app no
celular pela rede local.

## Requisitos

Node 22.5 ou mais novo. Nada além disso: o projeto usa `node:sqlite`, embutido
no Node, então **não há dependência para instalar** e não há compilação nativa.

## Rodar

```bash
node bin/nuvo.mjs
```

O servidor imprime o endereço local e o da rede, já com o token de acesso:

```
Nuvo no ar
local:  http://localhost:4747/?token=...
rede:   http://10.0.0.72:4747/?token=...
```

Abrir o endereço de rede no celular e usar "Adicionar à Tela de Início" instala
como app.

| Opção | Efeito |
| --- | --- |
| `--port 4747` | troca a porta |
| `--host 0.0.0.0` | troca o endereço de escuta |
| `--token` | imprime o token e sai |
| `--no-token` | desliga o token (só em rede confiável) |
| `--com-token` | religa o token |

Tudo do usuário fica em `~/.nuvo`: banco (`data.db`), configuração
(`config.json`, criado com permissão 600), anexos (`uploads/`) e as cópias
automáticas (`backups/`).

## Operação

```bash
node bin/nuvo.mjs instalar-servico   # sobe junto com a máquina
node bin/nuvo.mjs servico            # instalado? rodando?
node bin/nuvo.mjs remover-servico
```

launchd no macOS, `systemd --user` no Linux, Agendador de Tarefas no Windows —
tudo no escopo do usuário, sem pedir senha de administrador. No Linux o comando
tenta `loginctl enable-linger`; sem ele o servidor só fica de pé enquanto houver
sessão aberta, e isso é dito na saída.

### Ícone no dock

```bash
node bin/nuvo.mjs instalar-app   # Linux e Windows: atalho com ícone
node bin/nuvo.mjs remover-app
```

Não é Electron: empacotar um Chromium por aparência custaria centenas de
megabytes e a primeira dependência do projeto.

No macOS, o `Nuvo.app` baixado das releases abre uma **janela nativa** — uma
`WKWebView` num `NSWindow`, 136 kB compilados de `build/janela.swift` na hora de
empacotar. É o ícone do Nuvo no Dock e "Nuvo" no Cmd+Tab; o Chrome não entra na
história. Ela sobe o servidor se ninguém estiver atendendo na porta e só o
derruba ao fechar se foi ela quem subiu — quem tem um `nuvo` rodando no terminal
não perde a sessão fechando a janela. Link pra fora de `127.0.0.1` abre no
navegador de verdade. Empacotar sem `swiftc` na máquina devolve o pacote antigo,
que abre pelo navegador.

O `instalar-app` é o outro caminho, e continua sendo o único no Linux e no
Windows. No macOS ele reconhece o pacote das releases e não escreve por cima —
os dois moram em `~/Applications/Nuvo.app`, e trocar um pelo outro devolveria a
janela do navegador sem ninguém entender por quê. Ele: abre o navegador que você já tem em modo aplicativo — janela sem barra
de endereço e sem abas — apontado pro servidor. No Linux sai um `.desktop` no
menu; no Windows, um atalho no Menu Iniciar. Sem Chrome/Edge/Brave instalado,
abre numa aba comum do navegador padrão.

Os dois confirmam que quem atende na porta é mesmo o Nuvo (`GET /api/ping`,
a única rota sem token) antes de abrir a janela — o endereço carrega o token de
acesso, e mandá-lo pra qualquer programa que tenha tomado a porta seria entregar
a chave da casa.

### Backup

```bash
node bin/nuvo.mjs backup [arquivo.zip]   # banco + config + anexos
node bin/nuvo.mjs restore arquivo.zip
node bin/nuvo.mjs backups                # as cópias automáticas
```

Uma cópia por dia é feita sozinha quando o servidor sobe, e as sete últimas
ficam guardadas. Na interface, a mesma coisa fica em Config → Backup.

O banco sai por `VACUUM INTO`, não por cópia do arquivo: com WAL ligado, o
`.db` sozinho pode estar atrás do que já foi gravado. A restauração valida
assinatura e cabeçalho antes de tocar em qualquer coisa, guarda o banco atual
como `data.db.antes-da-restauracao` e pede reinício — o processo em execução
ainda tem o banco antigo aberto.

### Token de acesso

O token é exigido por padrão e vale para tudo, menos `GET /api/ping`. Desligar é
possível — `--no-token`, ou a chave em Config → Acesso — mas a decisão fica
gravada e vale nas próximas subidas, então o servidor avisa em todo start
enquanto estiver desligado. Religar: `--com-token` ou a mesma chave na tela.

Religando pela tela, o servidor devolve o token na resposta e o navegador o
guarda. Sem isso o botão seria armadilha: o pedido seguinte da própria aba que
apertou o botão levaria 401. Os outros aparelhos precisam do token, que aparece
no terminal e em `nuvo --token`.

### Quando não vem resposta

Em Provedores, **Testar todos** fala com cada um e escreve o resultado no
cartão dele. Provedor de CLI é testado disparando o binário, não lendo a
configuração; API é testada listando modelos.

O erro que aparece na conversa é traduzido em instrução: "o Ollama não
respondeu em localhost:11434, abra o app do Ollama", "a chave foi recusada,
gere uma nova", "o provedor pediu pra esperar, ou troque de modelo". A mensagem
crua do provedor vai junto, entre parênteses.

Modelo que trava é cortado: 240 s até o primeiro pedaço da resposta (modelo
local grande demora pra subir na memória) e 120 s entre pedaços. O que já tinha
chegado é gravado como resposta interrompida. Os dois prazos ficam em
`config.json`, em `limits`.

## Testes

```bash
npm test
```

203 testes com o runner do próprio Node, sem dependência de teste. Cada arquivo
roda num `NUVO_HOME` temporário e substitui o `fetch` global, então nada
toca o banco real nem a rede.

## Provedores

No primeiro start o servidor varre a máquina sozinho: portas conhecidas de
servidores locais e binários de IA no `PATH`.

| Tipo | Cobre |
| --- | --- |
| `openai` | OpenAI, Groq, DeepSeek, OpenRouter, xAI, Mistral, LM Studio, llama.cpp, vLLM, LocalAI |
| `anthropic` | API da Anthropic |
| `google` | Gemini |
| `ollama` | Ollama |
| `cli` | Claude Code, Codex, Gemini CLI, OpenCode — qualquer binário que aceite prompt |

A chave de API é gravada em `config.json` e **nunca sai do servidor**: a API
expõe apenas se existe chave (`has_secret`), jamais o valor.

Provedor de CLI é configurado por JSON, com `{{prompt}}` e `{{model}}` nos
argumentos:

```json
{ "command": "claude", "args": ["-p", "{{prompt}}"], "stdin": true, "models": ["default"] }
```

## Memória compartilhada

É o núcleo do projeto. Um único banco de fatos, lido e escrito por qualquer
modelo, independente de quem respondeu.

- **Recuperação híbrida** — FTS5 (BM25) sempre, mais similaridade de cosseno
  quando há modelo de embedding configurado. Sem embedding o app continua
  funcionando, só com menos precisão;
- **Escrita automática** — depois de cada resposta, um extrator lê a troca e
  guarda o que é duradouro. Sem modelo extrator configurado, cai numa heurística
  local que não faz nenhuma chamada de rede;
- **Fixar** um fato o injeta em toda conversa, sem disputar pontuação;
- **Escopo** — fato global vale em tudo; fato de projeto só naquele projeto;
- **Importação** — export do ChatGPT ou do Claude (`conversations.json`) vira
  memória. Só os turnos do usuário são lidos.

A interface mostra, em cada resposta, o que foi lembrado e o que foi aprendido.

## Documentos (RAG)

Anexo entra pelo clipe, arrastando pra cima da conversa ou colando no campo de
texto. Arquivo do projeto vale em toda conversa dele.

Lê texto e código, PDF, DOCX, PPTX e EPUB — os quatro últimos com extrator
próprio, sem dependência. PDF digitalizado em imagem não tem texto pra extrair e
o app diz isso em vez de fingir que leu.

Arquivo curto entra inteiro no prompt. Arquivo grande é quebrado em trechos,
indexado em FTS5 (mais embeddings quando houver) e só o trecho relevante entra —
com o nome do arquivo junto, pra resposta poder citar a fonte.

## Busca na web e pesquisa profunda

Sem chave de API: a busca sai pelo endpoint HTML do DuckDuckGo e a leitura de
página derruba script, estilo e navegação antes de virar texto.

- **Busca no chat** — o botão do globo liga a busca na conversa: cada pergunta
  passa por uma busca, três páginas são lidas e entram no prompt numeradas;
- **Pesquisa profunda** — o modelo planeja de 3 a 6 consultas, o servidor busca
  e lê as páginas, e o relatório final cita cada afirmação pelo número da fonte.
  Página que não abre aparece como não aberta; sem fonte, não há relatório.

## Conselho de IAs

O mesmo prompt em vários modelos ao mesmo tempo, em três modos:

| Modo | O que faz |
| --- | --- |
| comparar | as respostas lado a lado, você julga |
| conselho | as respostas mais uma síntese feita por um modelo juiz |
| votação cega | cada modelo avalia as respostas dos outros sem saber de quem é cada uma, e o resultado é a nota média |

A votação é cega de propósito: modelo que sabe qual resposta é a dele tende a
votar nela. A ordem das candidatas muda por jurado, derivada do índice — sem
sorteio, o que mantém o resultado reproduzível.

## Gerenciar modelos

Provedor Ollama tem baixar e apagar modelo pela interface, com barra de
progresso lida do stream do próprio Ollama.

## Gems e projetos

**Gem** é a personalidade: instruções, modelo preferido, temperatura, modo
(`chat` ou `coding`) e se lê/grava memória. **Projeto** agrupa conversas, tem
instrução própria, memória de escopo próprio e um diretório de trabalho, usado
pelas IAs de CLI no modo coding.

Cada gem tem um sinalizador `unfiltered`, que troca o prompt de sistema por um
sem restrição e, no Gemini, envia `safetySettings: BLOCK_NONE`. Em modelo local
isso remove o filtro de fato. Em API hospedada, o provedor continua aplicando a
política dele — o sinalizador não muda isso.

## Estudos

Um professor por vez. Dentro dele, as avaliações passadas e o material de aula —
e a diferença entre os dois é o produto.

**A tela é a do NotebookLM, copiada de propósito e medida no navegador**: barra
de 64px, colunas de 270 | resto | 270 com vão de 16, painel de raio 16 sobre
`#22262b`, linha de fonte de 48px, ladrilho de 56px com rótulo de 12px. Fontes à
esquerda, **conversa no meio**, estúdio à direita. A conversa responde com o
material daquele professor e cita o arquivo de onde tirou — é o que dá sentido
às outras duas colunas. As laterais recolhem pra 56px quando a resposta precisa
de espaço.

O que a cópia literal jogaria fora ficou: a fonte fechada continua dizendo
quantos arquivos são a prova, o que a prova cobrou e o que só foi dado em aula.

Cada arquivo tem um papel, e a tela diz qual em todo lugar em que ele aparece:

| Papel | O que é |
| --- | --- |
| prova | o documento como o professor entregou |
| conteúdo | o que aquela prova cobrou de verdade |
| aula | o que ele ensinou no período |

Clicar num arquivo abre ele: o texto como o extrator guardou, na coluna do meio.
É onde uma extração ruim se denuncia — PDF que virou salada de caracteres
aparece aqui, e não três telas depois, num simulado que sai estranho sem motivo
aparente.

**O retrato do professor** sai das provas passadas em duas passadas: uma leitura
por prova, depois uma síntese sobre todas. O esqueleto não foi inventado — é a
tabela de especificações que se usa pra montar prova de verdade: conteúdo ×
nível cognitivo (Bloom) × formato de questão × peso. Ela é verificável, o que
"estilo do professor" não é: cada achado vem com o trecho literal da prova que o
sustenta, e a tela mostra esse trecho do lado.

Prova é amostra; material de aula é o universo. A distância entre os dois é o que
o retrato chama de "ensina e nunca cobrou".

A leitura de cada prova fica guardada com a impressão digital dos arquivos e do
modelo: ler cinco provas leva minutos, e uma falha na síntese não pode jogar isso
fora. Trocar de modelo ou anexar outra prova muda a impressão digital, então a
leitura é refeita.

**O estúdio** gera dez formatos: simulado, guia de estudo, cartões, quiz, resumo,
mapa mental, linha do tempo, conversa em áudio, infográfico e slides. A geração
tem duas mãos: o NotebookLM lê o material e rascunha, e a IA escolhida reescreve
o rascunho com o retrato por cima — é esse segundo passo que transforma "um
simulado de biologia" em "a prova que este professor faria". Nenhuma das duas é
ponto único de falha: sem NotebookLM ligado, a segunda mão lê os arquivos direto;
escolhendo o NotebookLM no seletor, não há segunda mão.

**O simulado é uma prova, não um relatório.** Ele sai em folha, com dois modos e
um botão de imprimir: assinalar na tela — e aí o app corrige a objetiva sozinha,
pelo índice da alternativa certa que o gerador devolve, e mostra o que o
professor esperava ao lado do que você escreveu na discursiva — ou imprimir em
branco, com Nome, Data, Nota e linhas pautadas pra escrever à mão. O que o
retrato descobriu (peso do tema, nível, por que a questão existe) fica no
gabarito: numa prova pra fazer, dizer "esta cai com 30%" é entregar metade da
resposta.

**A prova que vem** abre a tela do professor, com quanto falta e os três
geradores que servem pra estudar pra uma. Abrir uma avaliação põe o estúdio a
serviço dela, e o que for gerado fica arquivado ali. Prova de ano anterior tem
lugar próprio, separado da agenda: ela é a melhor amostra que existe da forma
como aquele professor cobra, e a pior fonte de conteúdo — o programa do ano pode
ter mudado.

**A revisão** usa FSRS-4.5 — dificuldade, estabilidade e recuperabilidade por
cartão. É o que o NotebookLM e os concorrentes não têm: eles geram material e
param ali.

## Estrutura

```
bin/nuvo.mjs      entrada de linha de comando
server/
  index.mjs            HTTP: estáticos, autenticação por token, roteamento
  api.mjs              rotas /api
  config.mjs           ~/.nuvo, segredos, token
  db.mjs               esquema SQLite + FTS5 e migrações
  pending-restore.mjs  troca do banco na abertura, quando há restauração pendente

  chat.mjs             uma rodada de conversa, como gerador assíncrono
  complete.mjs         chamada avulsa a um modelo, com recuo em erro de cota
  council.mjs          conselho de IAs e votação cega
  memory.mjs           recuperação híbrida, extração, escrita
  vectors.mjs          embeddings, cosseno e consulta FTS
  documents.mjs        anexo, chunking, recuperação por trecho
  extract.mjs          texto de PDF, DOCX, PPTX, EPUB e código
  visao.mjs            imagem lida por modelo que enxerga
  texto-do-modelo.mjs  tira a marcação que o modelo inventa

  estudos.mjs          professor, pastas, saídas e a leitura guardada de cada prova
  retrato.mjs          o retrato do professor: tabela de especificações a partir das provas
  estudos-formatos.mjs os dez formatos do estúdio, em duas mãos
  cartoes.mjs          cartões e a fila de revisão
  fsrs.mjs             FSRS-4.5, função pura

  web.mjs              busca e leitura de página
  research.mjs         pesquisa profunda com relatório
  navegador.mjs        Chrome dirigido por CDP, com perfil próprio
  agente-web.mjs       o agente que navega: IA barata pra andar, boa pra responder
  notebooklm.mjs       o NotebookLM dirigido pela tela dele
  chromium.mjs         baixar o Chrome for Testing quando não há navegador

  loja.mjs             vitrine de MCPs e skills, puxada do GitHub
  catalogo-hf.mjs      catálogo de modelos locais do Hugging Face
  machine.mjs          o que a máquina aguenta rodar
  discovery.mjs        varredura de portas e binários
  importers.mjs        leitura de export do ChatGPT/Claude/Gemini
  backup.mjs           zip escrito à mão, cópia e restauração
  service.mjs          launchd, systemd e Agendador de Tarefas
  desktop.mjs          atalho com ícone, em janela de aplicativo
  instalar.mjs         instalação do Ollama e companhia
  errors.mjs           erro do provedor traduzido em instrução
  erro-traduzivel.mjs  erro que chega na tela no idioma dela
  idioma.mjs           idioma do servidor
  projeto-arquivos.mjs árvore de arquivos e anexo dentro do projeto
  eventos-cli.mjs      passo a passo lido do stream de uma IA de terminal
  empacotado.mjs       o que muda quando é executável único
  providers/           um adaptador por tipo de provedor
web/
  index.html           casca
  app.js               chat, barra lateral, paleta, atalhos
  core.js              estado, API, SSE, peças de interface
  views.js             painéis
  view-estudos.js      a tela de Estudos e as dez saídas
  view-code.js         a tela Programar e o painel de trabalho
  view-loja.js         a loja
  dialogo.js           diálogo próprio, sobre <dialog>
  i18n.js              tradução da tela
  lugar.js             de onde a pessoa está, pelo fuso
  md.js                Markdown e destaque de código
  icons.js             ícones SVG
  glow.js              o sinal de convergência
  sw.js                service worker
```
bin/nuvo.mjs      entrada de linha de comando
server/
  index.mjs            HTTP: estáticos, autenticação por token, roteamento
  api.mjs              rotas /api
  config.mjs           ~/.nuvo, segredos, token
  db.mjs               esquema SQLite + FTS5 e migrações
  chat.mjs             uma rodada de conversa, como gerador assíncrono
  complete.mjs         chamada avulsa a um modelo, sem conversa por trás
  memory.mjs           recuperação híbrida, extração, escrita
  vectors.mjs          embeddings, cosseno e consulta FTS
  documents.mjs        anexo, chunking, recuperação por trecho
  extract.mjs          texto de PDF, DOCX, PPTX, EPUB e código
  web.mjs              busca e leitura de página
  research.mjs         pesquisa profunda com relatório
  council.mjs          conselho de IAs e votação cega
  importers.mjs        leitura de export do ChatGPT/Claude
  discovery.mjs        varredura de portas e binários
  backup.mjs           zip escrito à mão, cópia e restauração
  service.mjs          launchd, systemd e Agendador de Tarefas
  desktop.mjs          atalho com ícone, em janela de aplicativo
  errors.mjs           erro do provedor traduzido em instrução
  providers/           um adaptador por tipo de provedor
web/
  index.html           casca
  app.js               chat, barra lateral, paleta, atalhos
  core.js              estado, API, SSE, peças de interface
  views.js             painéis
  icons.js             ícones SVG
  md.js                Markdown e destaque de código
```

Adaptador de provedor implementa `listModels(ctx)` e `stream(ctx, req)` — um
gerador assíncrono que emite `{delta}`, `{reasoning}` e `{usage}` — e
opcionalmente `embed(ctx, req)` e `check(ctx)`, quando listar modelos não prova
que o provedor funciona.

## API

Todas as rotas exigem o cabeçalho `x-nuvo-token` (ou `?token=`).

| Rota | Faz |
| --- | --- |
| `GET /api/state` | provedores, gems, projetos, conversas e configuração |
| `POST /api/discover` | varre a máquina atrás de IA local |
| `POST /api/providers` | cadastra provedor (`secretValue` é gravado, não devolvido) |
| `POST /api/chats/:id/stream` | resposta em SSE |
| `GET/POST /api/memories` | lista e grava fatos |
| `POST /api/memories/import` | importa export de outra IA |
| `POST /api/chats/:id/regenerate` | refaz a última resposta (SSE) |
| `POST /api/chats/:id/attachments` | anexa arquivo (corpo cru, nome na query) |
| `GET /api/chats/:id/export` | exporta em `md` ou `json` |
| `POST /api/research` | pesquisa profunda (SSE) |
| `POST /api/council` | conselho de IAs (SSE) |
| `POST /api/providers/:id/pull` | baixa modelo do Ollama (SSE) |
| `GET /api/search` | busca em mensagens e memória |
| `GET/PATCH /api/settings` | configuração de memória e acesso |
| `GET /api/ping` | única rota sem token: diz só que é um Nuvo |
| `GET /api/health` | testa cada provedor e diz o que está errado |
| `GET /api/backup` | baixa o zip com banco, configuração e anexos |
| `POST /api/restore` | restaura de um zip (corpo cru); pede reinício |

O stream do chat emite `user`, `memory-used`, `docs-used`, `web-used`, `phase`,
`reasoning`, `delta`, `stats`, `done`, `memory-new`, `error` e `end`.

## Interface

Sem etapa de build: HTML, CSS e ES modules servidos direto.

- Markdown de verdade — título, lista, tabela, citação, link, e bloco de código
  com destaque e botão copiar;
- raciocínio do modelo em bloco recolhido, quando o provedor expõe;
- medição por resposta: tempo até o primeiro token, tokens por segundo e total
  (marcado como estimado quando o provedor não devolve a contagem);
- regenerar, editar, copiar e apagar mensagem;
- ajustes por conversa: prompt de sistema, temperatura, top_p, limite de tokens;
- busca em tudo que já foi conversado, e na memória, pelo índice FTS5;
- exportar conversa em Markdown ou JSON;
- voz: ditado e leitura da resposta, pelas APIs do próprio navegador;
- renomear conversa no lugar do rótulo, fixar e arquivar, com lista própria
  para as arquivadas;
- primeira abertura guiada quando ainda não há modelo nenhum;
- tema claro e escuro, paleta de comandos (Ctrl/Cmd+K) e atalhos;
- ícones próprios em SVG — nada de emoji, que muda de desenho a cada sistema.

### Idiomas

Português, inglês e espanhol. O padrão sai, nesta ordem, do que a pessoa
escolheu no seletor, do país deduzido do fuso horário, do `Accept-Language` do
navegador e do idioma do sistema — nenhuma consulta de IP em passo nenhum.

`NUVO_LANG` força o idioma, do servidor e da tela, acima de tudo isso:

```sh
NUVO_LANG=en nuvo
```

Serve para conferir a tradução sem mexer no idioma da máquina. Ela decide
também o idioma dos quatro perfis que vêm prontos no primeiro start — eles são
gravados no banco como dado de quem usa, então nascem certos em vez de serem
traduzidos ao desenhar, o que desfaria qualquer renomeação.

O desenho de produção vem depois, por cima da mesma API.
