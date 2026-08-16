# PEDIDOS — IAUnifier

Registro dos pedidos do Miguel, nas palavras dele. Item só sai daqui quando
estiver entregue e conferido.

---

## 16/08/2026 — pedido de criação do projeto

> "cria um app tipo o locally ai. um app mobile e pc, que roda num servidor da
> minha casa, meu pc, windows, mac, linux e etc. ele seria tipo isso, locally ai
> misturado com o projeto do pewripi, onde vc consegue usar ias locais, usa ias
> api, usar ias CLI, opcao de coding, opcao de conversa, opcao de projetos,
> customizar a ia, criar gems, tirar o filtro de ias (n sei se funciona api, mas
> local da) memoria scraping de ias e um monte de coisa. um IA UNIFIER. o melhor
> disso tudo, q as ias vao ter memorias entre si, ou seja, vc pode fala pro
> claude q vc gosta de algo, o chat gpt vai lembrar e etc"

Quebrado em itens:

- [x] 1. "um app mobile e pc, que roda num servidor da minha casa, meu pc,
      windows, mac, linux e etc" — servidor único em Node, sem dependência
      nativa; cliente é PWA (abre no celular e no PC, instalável).
- [x] 2. "vc consegue usar ias locais" — LM Studio, Ollama, llama.cpp, vLLM,
      qualquer endpoint OpenAI-compatível, com descoberta automática na rede
      local.
- [x] 3. "usa ias api" — Anthropic, OpenAI, Google Gemini, Groq, DeepSeek,
      OpenRouter, xAI, Mistral.
- [x] 4. "usar ias CLI" — `claude`, `codex`, `opencode` e qualquer comando
      configurável rodando como provedor.
- [x] 5. "opcao de coding" — modo coding com diretório de trabalho, roteamento
      pros agentes CLI e render de código/diff.
- [x] 6. "opcao de conversa" — modo conversa (chat normal).
- [x] 7. "opcao de projetos" — projetos agrupam conversas, com instrução própria
      e memória de escopo do projeto.
- [x] 8. "customizar a ia, criar gems" — Gems: nome, emoji, system prompt,
      modelo preferido, temperatura, escopo de memória (o emoji virou ícone e cor no
      pedido 14).
- [x] 9. "tirar o filtro de ias (n sei se funciona api, mas local da)" — toggle
      "sem filtro" por Gem. Em modelo local vale de verdade (o system prompt é
      nosso). Em API hospedada o provedor aplica a política dele — está escrito
      na interface, sem prometer o que não dá.
- [x] 10. "memoria scraping de ias" — importador de export do ChatGPT
      (`conversations.json`), do Claude (`conversations.json`) e de markdown
      solto, extraindo fatos pra memória compartilhada.
- [x] 11. "as ias vao ter memorias entre si ... vc pode fala pro claude q vc
      gosta de algo, o chat gpt vai lembrar" — memória compartilhada: um único
      banco de fatos, injetado no prompt de qualquer modelo, gravado por
      qualquer modelo. É o núcleo do produto.
- [x] 12. "um monte de coisa" — busca híbrida (FTS5 + embeddings), troca de
      modelo no meio da conversa, streaming, descoberta automática de IA local
      na máquina, fixar fato na memória, token de acesso pra LAN.

## 16/08/2026 — UI

> "faz uma ui simples, com funcoes e etc, dps usamos o claude desing pra fazer a
> ui pra producao"

- [x] 13. UI crua e funcional, cobrindo todas as funções. O visual de produção
      fica pra depois, com o Claude Design.

## 16/08/2026 — tirar emoji, botar ícone, e encher o app de função

> "tira os emojis pelo menos e coloca icones. deixa o app boladao, cheio de
> coisa legal, um app realmente pra producao, ai nao tem nada alem de ta feio
> kkkk. mas a feiura dps nois resolve, mas ai o app ta cru msm, ta mt simples,
> pesquisa, analiza o codigo do app do pewdipie, analiza lm studio e o locally
> ai e etc. pra tu ve, sao apps completassos, tem de tudo, deixa o app bomzao"

Quebrado em itens:

- [x] 14. "tira os emojis pelo menos e coloca icones" — nenhum emoji na
      interface; conjunto de ícones SVG próprio, inclusive em gem e projeto.
- [x] 15. "pesquisa, analiza o codigo do app do pewdipie, analiza lm studio e o
      locally ai" — pesquisado. Odysseus (pewdiepie-archdaemon/odysseus):
      chat com agentes, deep research multi-passo com relatório, comparação
      lado a lado com teste cego, memória vetorial, gerenciador de modelos
      ciente do hardware, presets, temas. LM Studio: anexo de arquivo com RAG,
      navegador/baixador de modelo, presets por modelo, servidor OpenAI.
      Locally AI: modo de voz no aparelho, system prompt customizável.
- [x] 16. "deixa o app boladao, cheio de coisa legal, um app realmente pra
      producao ... ta cru msm, ta mt simples ... deixa o app bomzao" — o que
      entra:
      - anexo de arquivo com RAG (chunk + índice + citação da fonte);
      - busca na web como ferramenta, sem chave de API;
      - deep research: várias buscas, leitura das páginas e relatório;
      - conselho de IAs: o mesmo prompt em vários modelos e uma síntese;
      - gerenciador de modelo do Ollama (baixar com progresso, remover);
      - medição por resposta (tempo até o primeiro token, tokens/s, total);
      - regenerar, editar e apagar mensagem;
      - parâmetros por conversa (system, temperatura, top_p, limite);
      - busca em todas as conversas;
      - exportar conversa em Markdown e JSON;
      - voz: ditado e leitura da resposta;
      - tema claro e escuro, paleta de comandos e atalhos de teclado;
      - Markdown de verdade, com código destacado e bloco de raciocínio.

> "mas a feiura dps nois resolve"

O visual de produção continua sendo do Claude Design; o que entra agora é
função e estrutura, não desenho.

## 16/08/2026 — apresentação para investidor

> "apresente o projeto para um investidor"

- [x] 17. Deck de apresentação do IAUnifier para investidor, em `pitch.html`.
      Só entra número que dá pra provar: o produto existe e foi testado, mas
      não há usuário, receita nem time — isso fica escrito no próprio deck em
      vez de ser preenchido com estimativa inventada. Dado de mercado sai com
      a fonte junto.

> "apresente a ideia n visualmente"

- [x] 18. A mesma apresentação em texto, na conversa, sem página. O deck
      continua no repositório pra quando ele quiser mostrar.

## 16/08/2026 — levar o app até quase produção

> "n tem investidor nenhum, so queria ouvir vc falando pra eu ver se ideia bate
> com a minha. vamo faze o app entao..... fica fazendo o app, até ele estar
> praticamente pronto pra producao, tudo funcionando e testado. pra dai eu fazer
> o desing com claude desing"

- [x] 19. Bateria de testes automatizados de verdade (`node --test`), cobrindo
      extração de arquivo, memória, chunking, rotas da API, adaptadores,
      conselho e pesquisa. — 155 testes, `npm test`, sem dependência de teste.
      Acharam quatro defeitos reais: página de PDF curta descartada, dedupe de
      memória que não enxergava acento, último resultado da busca web engolido
      pelo regex, e "regenerar" apagando a pergunta junto com a resposta.
- [x] 20. Robustez: limite de tamanho, tempo máximo, provedor que cai no meio
      da resposta, duas requisições na mesma conversa, transação onde importa.
      — corpo limitado a 64 MB; vigia que corta modelo travado (240 s até o
      primeiro pedaço, 120 s entre pedaços) e grava o que já tinha chegado;
      uma resposta por conversa, com 409 na segunda; anexo e trechos em
      transação; ping SSE a cada 15 s.
- [x] 21. Segurança de rede local: restringir CORS, proteger o token contra
      tentativa repetida, revisar caminho de arquivo. — origem aceita só a
      própria máquina e a LAN; token comparado em tempo constante, com 20
      tentativas por minuto por IP; caminho de estático e de anexo restaurado
      não escapa da pasta.
- [x] 22. Operação: subir sozinho junto com a máquina (launchd, systemd,
      agendador do Windows), backup e restauração dos dados. — `iaunifier
      instalar-servico`; backup em zip com banco, config e anexos, com cópia
      automática diária (sete guardadas) e restauração validada.
- [x] 23. Arremates de produto: renomear conversa, ver arquivadas, primeira
      abertura guiada, checar saúde do provedor, mensagem de erro que explica
      o que fazer. — todos entregues; a saúde do CLI dispara o binário de
      verdade, e o erro do provedor vira instrução ("abra o Ollama", "gere uma
      chave nova", "espere ou troque de modelo").

O desenho continua sendo dele com o Claude Design — o que entra aqui é
funcionamento e teste.

## Pendências abertas

- [ ] Empacotar como app nativo (Electron no PC, Capacitor no celular) — hoje
      é PWA instalável, que já cobre celular e desktop.
- [x] Portar a landing pra `https://www.nspx.dev/IAUnifier/` — feito em
      16/08/2026: página em `docs/`, GitHub Pages ligado no repositório
      `NspxMiguel/IAUnifier`, endereço conferido no domínio (200, sem link
      absoluto pro github.io). O app em si roda no servidor da casa, não em
      host estático.

### Conferido rodando de verdade (16/08/2026)

Não é só teste automatizado: o app foi exercido contra modelo e web reais.

- **memória compartilhada, que é a ideia do projeto** — contei ao Claude Code
  CLI que meu domínio é `nspx.dev`; numa conversa nova, com o Codex CLI (outro
  modelo, outro fornecedor), a pergunta "qual é o meu domínio?" foi respondida
  com "Seu domínio é nspx.dev";
- **conselho** — os dois CLIs responderam em paralelo à mesma pergunta;
- **pesquisa profunda** — planejou duas consultas, leu três de quatro páginas
  (a quarta devolveu 403 e apareceu como não aberta) e citou as fontes;
- **instalação limpa** — sobe, descobre os provedores da máquina, semeia as
  gems, exige token e devolve 401 sem ele;
- **interface** — todos os painéis, tema claro e escuro, gaveta do celular, sem
  erro de console.
