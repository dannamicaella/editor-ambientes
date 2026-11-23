# Editor de Ambientes

Aplicativo web instalável para criar montagens com fotografias de móveis e objetos. A edição acontece no navegador. Fotos e projetos ficam no dispositivo, sem login, telemetria, backend ou serviços de processamento de imagens.

## Executar localmente

Node.js 22.12+ da série 22 ou Node.js 24+, com npm. Use Chrome atualizado, especialmente no Android. No PowerShell, use `npm.cmd` se a política de execução bloquear `npm.ps1`.

```sh
npm ci
npm run dev
```

Abra o endereço exibido pelo Vite, normalmente `http://127.0.0.1:5173/`. A primeira instalação de dependências precisa de internet. O servidor escuta apenas no computador local.

| Comando | Resultado |
| --- | --- |
| `npm run build` | Build estático de produção em `dist/` |
| `npm run build:pwa` | Build instalável e offline em `dist-pwa/` |
| `npm run preview -- --mode pwa` | Prévia local do build PWA em `http://127.0.0.1:4173/` |
| `npm run lint` | ESLint |
| `npm test` | Testes de lógica e segmentação |
| `npm run test:e2e` | Testes Playwright no build PWA já gerado |
| `node tools/benchmark-mobilesam.mjs` | Mede a inferência no build PWA com uma foto real em WASM e WebGPU no Chrome local |

## Usar

1. Selecione **Nova montagem** e fotografe ou escolha o fundo. Você pode substituí-lo em **Camadas → Trocar foto de fundo**.
2. Selecione **Adicionar objeto**. Toque no produto com **Manter** e depois em **Remover fundo**. Se houver objetos muito próximos, desenhe um **Contorno guia** aproximado e marque o produto com **Manter**. O desenho indica a caixa de busca para a IA.
3. Revise o recorte. Se faltar uma parte do produto ou sobrar fundo, toque em **Ver foto** e marque a região com **Manter** ou **Remover**. O editor avisa quando o toque muda a máscara, reforça o resultado atual ou precisa de correção com pincel. Use zoom, fundo contrastante, **Apagar** e **Restaurar** para acertar bordas e detalhes pequenos. A opção **Recorte manual** aparece quando a IA falha.
4. Arraste o objeto na montagem. As alças nos cantos ajustam a escala proporcional e a alça superior gira o objeto. Inicie a pinça em um objeto para transformá-lo. Use **Navegar** para ampliar ou deslocar a visualização sem mover objetos. No painel **Camadas**, também é possível digitar posições, ajustar escala, rotação e opacidade, aplicar sombra, duplicar, reordenar, excluir e editar novamente a máscara.
5. Nomeie e **Salve** a montagem. Reabra em **Minhas montagens**. As ações de desfazer e refazer estão disponíveis durante a edição.
6. Use **Exportar** para baixar PNG ou JPEG. PNG preserva a transparência da composição e JPEG permite ajustar a qualidade. Em **Compartilhar**, prepare a imagem e selecione **Compartilhar arquivo**. No Android, escolha o WhatsApp no menu do dispositivo, se estiver instalado. Quando o menu estiver indisponível, baixe o arquivo e anexe-o no aplicativo desejado.

### Duplicar montagens e reutilizar recortes

- Em **Minhas montagens**, use **Duplicar** para criar uma versão independente, com o sufixo **- Cópia**. Abra a cópia para editá-la ou use a ação de renomear no cartão.
- Ao concluir um recorte, use **Salvar em Meus Recortes** e dê um nome ao objeto. A mesma ação fica disponível no painel da camada para guardar recortes existentes.
- No editor, use **Adicionar objeto → Meus Recortes** para inserir o objeto em uma nova camada. Repita para inserir outras instâncias. Na tela inicial, **Meus Recortes** permite visualizar, renomear e excluir itens da biblioteca. Excluir um item da biblioteca preserva as montagens que já o utilizam.

### Ajustar sombras

Selecione o objeto, marque **Aplicar sombra** e abra **Ajustar sombras**. Comece com **Sombra automática**. Regule a opacidade e o desfoque da sombra ambiente e a intensidade da sombra de contato. A cor e os deslocamentos X e Y afetam ambas. Os ajustes acompanham a posição, escala e rotação e ficam salvos na montagem e visíveis no PNG ou JPEG exportado.

### Backup e Restauração

Abra **Backup e Restauração** na tela inicial e escolha **Exportar backup**. Guarde o arquivo `.eabackup` fora dos dados do navegador. Ele contém as montagens salvas, a biblioteca e as imagens necessárias para continuar editando.

Para recuperar os dados, escolha **Importar backup**, selecione o arquivo e confirme. A restauração adiciona itens novos e versões com conteúdo diferente. Montagens e recortes idênticos são ignorados mesmo quando têm IDs diferentes. O resumo informa quantos itens foram adicionados e ignorados. O editor avisa se o espaço estimado for insuficiente. Na PWA, a operação pode ser feita offline após aparecer **Offline pronto**.

## Testar e instalar no Android

1. Execute `npm run build:pwa` e `npm run preview -- --mode pwa`.
2. Com o celular conectado por USB, habilite a depuração USB e autorize o computador. No Chrome do computador, abra `chrome://inspect/#devices`, selecione **Port forwarding** e encaminhe a porta **4173** do celular para `127.0.0.1:4173` no computador. Abra `http://localhost:4173/` no Chrome do Android. [Guia do Chrome para encaminhamento por USB](https://developer.chrome.com/docs/devtools/remote-debugging/local-server/)
3. Aguarde **Offline pronto**. Instale pelo botão do editor quando disponível ou pelo menu do Chrome. Para preparar a IA, gere o primeiro recorte com conexão e aguarde **IA disponível offline**. Teste o app instalado em modo avião após fechar a aba e reabrir pelo ícone.
4. Execute o roteiro de câmera, toque, instalação e WhatsApp de [TESTING.md](TESTING.md).

Uma publicação estática HTTPS também permite testar no celular. `file://` e HTTP sobre um IP da rede local não fornecem o contexto seguro necessário para o Service Worker.

## Publicação gratuita opcional

O Cloudflare Pages oferece uma modalidade estática gratuita, com endereço HTTPS `pages.dev` e cadastro sem cartão. Gere `dist-pwa/`, crie um projeto Pages pelo painel **Workers & Pages** e use **Direct Upload** com a pasta de saída. Envie somente o build. Use o plano Free, com os recursos de backend e analytics desativados. [Cloudflare Pages](https://www.cloudflare.com/products/pages/) · [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) · [Limites do plano](https://developers.cloudflare.com/pages/platform/limits/)

## Limitações

- O MobileSAM roda no navegador. O primeiro recorte baixa aproximadamente 57 MB com WASM ou 70 MB com WebGPU. Os arquivos ficam no cache do dispositivo. O modo manual continua disponível sem esse download. Limpeza do cache ou mudança de navegador pode exigir baixar novamente.
- A precisão depende da foto e das indicações. Objetos pequenos, sobrepostos ou visualmente parecidos podem exigir uma caixa mais próxima e pontos de exclusão. Um orifício real dentro do objeto pode precisar de um ponto **Remover** para ficar transparente. A inferência tem entrada de 1.024 px e máscara-base de 256 px. O recorte é rasterizado na resolução original, com antialiasing no contorno.
- As sombras são efeitos 2D. A sombra de contato usa a base do recorte como referência. Ajuste-a à posição do objeto e à iluminação da foto do ambiente.
- WebGPU depende do adaptador e do navegador. O aplicativo tenta WASM quando WebGPU falha. A primeira análise da imagem pode ser lenta em aparelhos com pouca memória ou CPU mais fraca. O editor oferece recorte manual quando o dispositivo não consegue concluir a inferência.
- O importador aceita JPEG, PNG e WebP com até 32 MB, 32 megapixels e 12.000 px por lado, de acordo com a decodificação do navegador. A prévia da foto de objeto usa até 2.400 px por lado e 4 megapixels. A máscara e o PNG do objeto usam os pixels da foto original. Seleções muito grandes podem atingir o limite de memória do navegador.
- A exportação usa a proporção do fundo e limita a resolução a 4.096 px por lado e 12 megapixels. Em fotos maiores, a interface avisa sobre a redução e oferece tamanho compacto quando aplicável. Pressão de memória pode exigir a opção compacta.
- IndexedDB e cache são separados por origem e perfil do navegador. Limpeza de dados, modo privativo e políticas de armazenamento podem eliminar projetos ou o cache offline. Um PNG/JPEG exportado preserva a imagem final, sem os dados editáveis da montagem. O histórico da sessão reinicia quando o projeto é reaberto.
- A câmera e o menu de compartilhamento variam entre aparelhos e navegadores. A galeria e o download são alternativas locais. Recursos de instalação e partilha de arquivos dependem do contexto seguro e do suporte do navegador.

A stack inclui Vue 3, Quasar, Vite, Canvas 2D, Pointer Events, IndexedDB, Web Workers e Service Worker. Veja [ARCHITECTURE.md](ARCHITECTURE.md), [TESTING.md](TESTING.md) e [LICENSES.md](LICENSES.md).
