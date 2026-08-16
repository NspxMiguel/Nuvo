# IAUnifier

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
node bin/iaunifier.mjs
```

O servidor imprime o endereço local e o da rede, já com o token de acesso:

```
IAUnifier no ar
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

Tudo do usuário fica em `~/.iaunifier`: banco (`data.db`), configuração
(`config.json`, criado com permissão 600), anexos (`uploads/`) e as cópias
automáticas (`backups/`).

## Operação

```bash
node bin/iaunifier.mjs instalar-servico   # sobe junto com a máquina
node bin/iaunifier.mjs servico            # instalado? rodando?
node bin/iaunifier.mjs remover-servico
```

launchd no macOS, `systemd --user` no Linux, Agendador de Tarefas no Windows —
tudo no escopo do usuário, sem pedir senha de administrador. No Linux o comando
tenta `loginctl enable-linger`; sem ele o servidor só fica de pé enquanto houver
sessão aberta, e isso é dito na saída.

### Ícone no dock

```bash
node bin/iaunifier.mjs instalar-app   # atalho com ícone, janela sem abas
node bin/iaunifier.mjs remover-app
```

Não é Electron: empacotar um Chromium por aparência custaria centenas de
megabytes e a primeira dependência do projeto. O atalho abre o navegador que
você já tem em modo aplicativo — janela sem barra de endereço e sem abas —
apontado pro servidor, subindo ele antes se não estiver de pé. No macOS sai um
`IAUnifier.app` em `~/Applications` com ícone próprio; no Linux, um `.desktop`
no menu; no Windows, um atalho no Menu Iniciar. Sem Chrome/Edge/Brave instalado,
abre numa aba comum do navegador padrão.

O atalho confirma que quem atende na porta é mesmo o IAUnifier (`GET /api/ping`,
a única rota sem token) antes de abrir a janela — o endereço carrega o token de
acesso, e mandá-lo pra qualquer programa que tenha tomado a porta seria entregar
a chave da casa.

### Backup

```bash
node bin/iaunifier.mjs backup [arquivo.zip]   # banco + config + anexos
node bin/iaunifier.mjs restore arquivo.zip
node bin/iaunifier.mjs backups                # as cópias automáticas
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
no terminal e em `iaunifier --token`.

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

191 testes com o runner do próprio Node, sem dependência de teste. Cada arquivo
roda num `IAUNIFIER_HOME` temporário e substitui o `fetch` global, então nada
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

## Estrutura

```
bin/iaunifier.mjs      entrada de linha de comando
server/
  index.mjs            HTTP: estáticos, autenticação por token, roteamento
  api.mjs              rotas /api
  config.mjs           ~/.iaunifier, segredos, token
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

Todas as rotas exigem o cabeçalho `x-iaunifier-token` (ou `?token=`).

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
| `GET /api/ping` | única rota sem token: diz só que é um IAUnifier |
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

O desenho de produção vem depois, por cima da mesma API.
