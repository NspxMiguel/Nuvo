# Fontes da página

Duas famílias, servidas do próprio domínio. Nada de CDN: uma requisição a
`fonts.googleapis.com` entrega o visitante a um terceiro, e o arquivo daqui
carrega antes porque vem do mesmo servidor que o HTML.

| Arquivo | Família | Onde aparece | Licença |
| --- | --- | --- | --- |
| `bricolage-*.woff2` | Bricolage Grotesque (variável: `opsz`, `wdth`, `wght`) | títulos e a saudação da primeira tela | SIL Open Font License 1.1 |
| `geist-*.woff2` | Geist (variável: `wght`) | texto corrido, botões, rótulos | SIL Open Font License 1.1 |

Cada família vem em dois arquivos, `latin` e `latin-ext`, com o `unicode-range`
que o `@font-face` declara. Português e espanhol cabem no `latin`; o `latin-ext`
só é baixado se a página encontrar um caractere que peça.

As duas são OFL, o que permite servir o arquivo daqui. O texto da licença está
em <https://openfontlicense.org>; os projetos de origem são
<https://github.com/ateliertriay/bricolage> e
<https://github.com/vercel/geist-font>.

Os arquivos são os subconjuntos que o Google Fonts publica — o mesmo binário que
o `fonts.gstatic.com` serviria, só que hospedado aqui.

**Isto vale só para a página de apresentação.** O app em `web/` continua na
fonte do sistema de propósito: ele roda sem internet, e uma fonte baixada seria
a única coisa da interface a depender de rede.
