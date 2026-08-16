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

Tudo do usuário fica em `~/.iaunifier`: banco (`data.db`) e configuração
(`config.json`, criado com permissão 600).

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
  db.mjs               esquema SQLite + FTS5
  chat.mjs             uma rodada de conversa, como gerador assíncrono
  memory.mjs           recuperação híbrida, extração, escrita
  importers.mjs        leitura de export do ChatGPT/Claude
  discovery.mjs        varredura de portas e binários
  providers/           um adaptador por tipo de provedor
web/                   PWA sem build: HTML, CSS e ES modules
```

Adaptador de provedor implementa `listModels(ctx)` e `stream(ctx, req)` — um
gerador assíncrono que emite `{delta}`, `{reasoning}` e `{usage}` — e
opcionalmente `embed(ctx, req)`.

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
| `GET/PATCH /api/settings` | configuração de memória e acesso |

O stream emite `user`, `memory-used`, `reasoning`, `delta`, `done`,
`memory-new`, `error` e `end`.

## Interface

A interface atual é funcional e crua de propósito — cobre todas as
funcionalidades do servidor sem etapa de build. O desenho de produção vem
depois, por cima da mesma API.
