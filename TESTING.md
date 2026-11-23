# Testes

## Reproduzir no desktop

```sh
npm ci
npm run lint
npm test
npm run build
npm run build:pwa
npm run test:e2e
node tools/benchmark-mobilesam.mjs
node tools/benchmark-mobilesam.mjs --original
```

O Playwright usa o Chrome instalado no caminho padrão do Windows, quando encontrado. Em outros ambientes, configure `CHROME_PATH` para o executável do Chrome ou execute `npx playwright install chromium` para usar o Chromium gerenciado pelo Playwright. A suíte inicia e encerra uma prévia isolada em loopback na porta 4177.

| Verificação | Cobertura |
| --- | --- |
| Node.js | Criação do projeto, metadados de camadas, histórico, PNG, cabeçalhos das imagens, projeção de pontos e caixa, seleção da máscara, descarte de ilhas e rasterização subpixel |
| Chrome desktop | Captura simulada, galeria, pincéis e histórico, composição, duplicação, camadas, salvamento, reabertura de máscara e downloads PNG/JPEG |
| Chrome com viewport móvel | Layout a 360 px e em paisagem, app offline, contorno por toque, pinça e rotação, navegação e download alternativo |
| IA na PWA | Inferência real com foto de almofada apoiada num sofá, contorno guia, pontos de inclusão e exclusão, cache verificado, nova inferência de outra seleção em modo offline com fallback WASM |
| Foto original de aceitação | Foto de 900 × 1.600 px da almofada dos três peixes sobre palha. Verificação de RGB e alfa no PNG do objeto, além da inspeção visual do recorte em WASM e WebGPU |
| Sombras | Ajuste ao vivo, diferença entre ambiente e contato, rotação, persistência após reabrir e comparação de pixels na prévia, PNG e JPEG |
| Duplicação de montagens | Banco v1 preparado antes de abrir a PWA, duplicação offline de duas camadas com sombras, edição, renomeação, reabertura e exclusão da cópia |
| Meus Recortes | Grade e toque a 360 px em modo offline, prévia PNG com alfa, renomeação, reutilização na mesma e em outra montagem, exportação após exclusão da biblioteca e liberação das imagens ao apagar a última montagem |
| Backup e restauração | Exportação e restauração offline a 360 px, migração v2, conteúdo idêntico com IDs diferentes, versões modificadas, referências compartilhadas, importação repetida e simultânea, arquivos inválidos e rollback após falha de quota simulada |
| Falha e compatibilidade no Chrome | Orientação JPEG/EXIF, troca de fundo, tentativa sem modelo e sem rede, alternativa manual e compartilhamento simulado |
| Contorno na resolução original | Foto de 2.600 × 1.000 px com textura clara e estampa azul, contorno côncavo desenhado com mouse e zoom/pan em DPR 2, pixels opacos intactos na estampa, transparência nas áreas externas, antialiasing no PNG e alternância do fundo de prévia |

As suítes usam imagens geradas no navegador, a fotografia CC0 `test-fixtures/mobilesam-sala-cc0.jpg` e a foto original da almofada. A imagem CC0 funciona como referência fixa para o teste do MobileSAM offline. O seletor de câmera é exercitado com arquivo de teste. A simulação de Web Share verifica o arquivo e a ativação por clique.

## Resultado da verificação

Passaram o lint, os 22 testes de lógica e os 11 fluxos Playwright da PWA. Os builds de produção e PWA foram gerados com sucesso. O teste da foto original inclui toques negativos consecutivos, uma remoção proposital na estampa, a recuperação com **Manter** no mesmo ponto e a confirmação de que repetir o toque dá feedback sem duplicar a indicação. O teste conferiu igualdade RGBA nos três peixes e no tecido, além de alfa zero em cinco amostras da palha. A inspeção visual da rodada de segmentação está registrada no PNG `.tmp/mobilesam-acceptance/editor-recorte.png`.

O benchmark usa o Worker compilado da PWA, força cada backend e executa ambos no Chrome com a mesma foto e as mesmas indicações. Mede preparação em localhost, primeira codificação, primeira decodificação e decodificação após corrigir os pontos. Os comparativos e o JSON ficam em `.tmp/mobilesam-benchmark/` para a foto CC0 do editor e em `.tmp/mobilesam-acceptance/` para a foto original.

O codificador tem 27.969.728 bytes, transportados em 16.777.216 e 11.192.512 bytes. O decodificador tem 16.492.407 bytes. Os dois artefatos somam 44.462.135 bytes. Com os arquivos JS e WASM do runtime, os downloads são de aproximadamente 56,9 MB para WASM ou 70,3 MB para WebGPU.

### Medição com a foto original

Chrome 157 no Windows, Intel Core i5-8250U e Intel UHD Graphics 620. Os intervalos abaixo vêm de duas execuções locais por backend.

| Backend | Preparação | Primeira codificação | Primeira decodificação | Decodificação após correção |
| --- | ---: | ---: | ---: | ---: |
| WASM | 3,057–3,160 s | 6,409–7,948 s | 0,379–0,410 s | 0,336–0,351 s |
| WebGPU | 5,961–10,676 s | 3,854–4,084 s | 1,079–1,176 s | 0,315–0,327 s |

A primeira comparação desta rodada reproduziu regiões dos peixes transparentes em ambos os backends. Após ajustar a seleção da máscara, a primeira previsão deixou opacos os pontos conferidos nos três peixes e no tecido. A segunda passou seis indicações de remoção juntas, incluindo uma junto à borda inferior direita. Os pontos do tecido e da estampa continuaram opacos e cinco amostras na palha ficaram transparentes. A inspeção visual confirmou a estampa íntegra e ausência de palha visível no recorte final. Os arquivos `.tmp/mobilesam-acceptance/wasm.png` e `.tmp/mobilesam-acceptance/webgpu.png` mostram a foto e o recorte lado a lado.

O WebGPU exigiu emparelhar a entrada JavaScript do ONNX Runtime com o binário JSEP correspondente. A integração da PWA também passou a enviar objetos JavaScript simples ao Worker, de modo que os pontos possam ser clonados sem os proxies do Vue.

## Roteiro manual pendente em Android físico

O Chrome desktop não valida hardware, desempenho térmico ou a integração nativa do Android. Use as instruções do [README](README.md#testar-e-instalar-no-android) e registre modelo do aparelho, versão do Android e versão do Chrome.

1. Abra o editor, crie uma montagem e capture uma poltrona ou ambiente com a câmera traseira. Repita com JPEG, PNG e WebP da galeria. Confira uma foto vertical com EXIF.
2. Carregue a fotografia original da almofada dos três peixes apoiada na cadeira de palha. Gere a máscara com um ponto positivo e repita com contorno guia. Use pontos negativos na palha que ainda aparecer. Inspecione os três peixes, a costura e a silhueta ampliada sobre fundo sólido e quadriculado. Compare o PNG original do objeto com a foto para conferir a transparência e a preservação da textura.
3. Arraste, redimensione e gire o objeto com alças e gestos de dois dedos. Duplique, arraste a cópia para outra poltrona e troque a ordem. Use **Sombra automática**, teste a opacidade ambiente e a intensidade de contato separadamente e ajuste cor, desfoque e posição. Repita em retrato e paisagem.
4. Salve, feche a aba e reabra a montagem. Edite a máscara de uma cópia e verifique a outra camada. Faça exportações PNG e JPEG, inclusive com uma foto de fundo grande e qualidade JPEG ajustada.
5. Instale pelo Chrome, aguarde **Offline pronto**, feche todas as abas do editor e reabra pelo ícone em modo avião. Repita o recorte e a exportação com a rede desligada.
6. Compartilhe o arquivo no menu Android, selecione o WhatsApp instalado e confira a prévia do anexo. Experimente o download alternativo. O envio pelo WhatsApp depende da conectividade dele.
7. Repita com pouca memória e espaço reduzido para observar o comportamento do navegador e as mensagens de erro.

A foto original fica em `test-fixtures/almofada-peixes.jpeg` e é usada localmente na aceitação. Ela fica fora dos builds distribuídos. As medições são do Chrome no Windows. Tempo e pico de memória ainda precisam ser medidos em Android físico.

## Testar duplicação e biblioteca

1. Em **Minhas montagens**, duplique uma montagem com camadas. Abra a cópia, altere uma sombra, salve e verifique a original. Exclua a cópia e reabra a original.
2. Ao terminar um recorte, escolha **Salvar em Meus Recortes**. Nomeie o item e abra a biblioteca pela tela inicial para verificar a miniatura e a transparência.
3. Abra uma montagem e use **Adicionar objeto → Meus Recortes** duas vezes. Mova apenas uma das camadas. Salve, repita em outra montagem, exclua o item da biblioteca e exporte ambas.
4. Na PWA, aguarde **Offline pronto**, desligue a conexão e repita a duplicação, a consulta à biblioteca e a exportação depois de reabrir o aplicativo.

## Testar backup e restauração

1. Aguarde **Offline pronto**, desligue a conexão e abra **Backup e Restauração** na tela inicial. Exporte uma montagem salva que use um item de **Meus Recortes**.
2. Importe o arquivo no mesmo navegador e confirme. Confira que os itens já salvos aparecem como ignorados e que as quantidades permanecem iguais ao repetir a importação.
3. Altere e salve a sombra de uma montagem. Importe o backup original novamente e verifique que as duas versões aparecem, cada uma com seus ajustes. Abra a versão restaurada e verifique camadas, transparência e edição da máscara.
