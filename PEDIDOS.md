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

## Pendências abertas

- [ ] Empacotar como app nativo (Electron no PC, Capacitor no celular) — hoje
      é PWA instalável, que já cobre celular e desktop.
- [x] Portar a landing pra `https://www.nspx.dev/IAUnifier/` — feito em
      16/08/2026: página em `docs/`, GitHub Pages ligado no repositório
      `NspxMiguel/IAUnifier`, endereço conferido no domínio (200, sem link
      absoluto pro github.io). O app em si roda no servidor da casa, não em
      host estático.
