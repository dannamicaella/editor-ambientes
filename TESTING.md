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
| Geometria MobileSAM | Coordenadas de pontos e caixa, interpolação antes de retirar o padding, deslocamento fracionário da região, prioridade do toque explícito e alfa nativo em partes finas, concavidades e furos |
| Sombras | Ajuste ao vivo, diferença entre ambiente e contato, rotação, persistência após reabrir e comparação de pixels na prévia, PNG e JPEG |
| Duplicação de montagens | Banco v1 preparado antes de abrir a PWA, duplicação offline de duas camadas com sombras, edição, renomeação, reabertura e exclusão da cópia |
| Meus Recortes | Grade e toque a 360 px em modo offline, prévia PNG com alfa, renomeação, reutilização na mesma e em outra montagem, exportação após exclusão da biblioteca e liberação das imagens ao apagar a última montagem |
| Backup e restauração | Exportação e restauração offline a 360 px, migração v2, conteúdo idêntico com IDs diferentes, versões modificadas, referências compartilhadas, importação repetida e simultânea, arquivos inválidos e rollback após falha de quota simulada |
| Falha e compatibilidade no Chrome | Orientação JPEG/EXIF, troca de fundo, tentativa sem modelo e sem rede, alternativa manual e compartilhamento simulado |
| Contorno na resolução original | Foto de 2.600 × 1.000 px com textura clara e estampa azul, contorno côncavo desenhado com mouse e zoom/pan em DPR 2, pixels opacos intactos na estampa, transparência nas áreas externas, antialiasing no PNG e alternância do fundo de prévia |

As suítes usam imagens geradas no navegador, a fotografia CC0 `test-fixtures/mobilesam-sala-cc0.jpg` e a foto original da almofada. A imagem CC0 funciona como referência fixa para o teste do MobileSAM offline. O seletor de câmera é exercitado com arquivo de teste. A simulação de Web Share verifica o arquivo e a ativação por clique.

## Resultado da verificação

Passaram o lint, os 27 testes de lógica e os 11 fluxos Playwright da PWA. Os builds de produção e PWA foram gerados com sucesso. A regressão da foto original também passou isoladamente com um único **Remover** sobre o vime e sem pincel. Ela cobre uma remoção proposital na estampa, a recuperação com **Manter** no mesmo ponto e o aviso ao repetir uma indicação. O teste compara RGBA nos três peixes e no tecido e verifica alfa zero em cinco amostras da palha.

O benchmark usa o Worker compilado da PWA, força cada backend e executa ambos no Chrome com a mesma foto e as mesmas indicações. Mede preparação em localhost, primeira codificação, primeira decodificação e decodificação após corrigir os pontos. Os comparativos e o JSON ficam em `.tmp/mobilesam-benchmark/` para a foto CC0 do editor e em `.tmp/mobilesam-acceptance/` para a foto original.

O codificador tem 27.969.728 bytes, transportados em 16.777.216 e 11.192.512 bytes. O decodificador tem 16.492.407 bytes. Os dois artefatos somam 44.462.135 bytes. Com os arquivos JS e WASM do runtime, os downloads são de aproximadamente 56,9 MB para WASM ou 70,3 MB para WebGPU.

### Medição com a foto original

Chrome 157 no Windows, Intel Core i5-8250U e Intel UHD Graphics 620. A tabela registra uma execução em localhost por backend após a mudança no rasterizador.

| Backend | Preparação | Primeira codificação | Primeira decodificação | Decodificação após correção |
| --- | ---: | ---: | ---: | ---: |
| WASM | 2,756 s | 5,563 s | 0,305 s | 0,315 s |
| WebGPU | 4,816 s | 3,918 s | 1,200 s | 0,268 s |

Com só a guia e com guia mais **Manter** no centro, os três peixes ficaram opacos, mas permaneceu um fragmento de vime na borda direita. Com guia, ponto central e um único **Remover** em `(784, 1178)`, os dois backends deixaram as cinco amostras de vime transparentes e preservaram as quatro amostras da estampa e do tecido. A inspeção visual do WASM confirmou a remoção do fragmento visível. As imagens `*-guia.png`, `*-inicial.png` e `*-uma-correcao.png` ficam em `.tmp/mobilesam-acceptance/`.

Na seleção com guia e ponto central, a escolha foi a candidata 3 com 16.508 células positivas no WASM. As outras candidatas tinham 15.351, 13.731 e 2.071 células. A de maior confiança bruta deixou lacunas na almofada. Os quatro resultados são hipóteses do decodificador e devem ser comparados com as indicações e com o contorno esperado. Os escores e as áreas estão em `.tmp/mobilesam-acceptance/results.json`.

O WebGPU exigiu emparelhar a entrada JavaScript do ONNX Runtime com o binário JSEP correspondente. A integração da PWA também passou a enviar objetos JavaScript simples ao Worker, de modo que os pontos possam ser clonados sem os proxies do Vue.

## Roteiro manual pendente em Android físico

O Chrome desktop não valida hardware, desempenho térmico ou a integração nativa do Android. Use as instruções do [README](README.md#testar-e-instalar-no-android) e registre modelo do aparelho, versão do Android e versão do Chrome.

1. Abra o editor, crie uma montagem e capture uma poltrona ou ambiente com a câmera traseira. Repita com JPEG, PNG e WebP da galeria. Confira uma foto vertical com EXIF.
2. Compare um ponto **Manter**, uma guia sozinha e uma guia com **Manter** na almofada original. Marque **Remover** no vime junto à borda direita. Repita com zoom e deslocamento usando toque. Confira os três peixes, a costura e a silhueta sobre fundo sólido e quadriculado. Registre o número de correções e verifique o alfa no PNG.
3. Arraste, redimensione e gire o objeto com alças e gestos de dois dedos. Duplique, arraste a cópia para outra poltrona e troque a ordem. Use **Sombra automática**, teste a opacidade ambiente e a intensidade de contato separadamente e ajuste cor, desfoque e posição. Repita em retrato e paisagem.
4. Salve, feche a aba e reabra a montagem. Edite a máscara de uma cópia e verifique a outra camada. Faça exportações PNG e JPEG, inclusive com uma foto de fundo grande e qualidade JPEG ajustada.
5. Instale pelo Chrome, aguarde **Offline pronto**, feche todas as abas do editor e reabra pelo ícone em modo avião. Repita o recorte e a exportação com a rede desligada.
6. Compartilhe o arquivo no menu Android, selecione o WhatsApp instalado e confira a prévia do anexo. Experimente o download alternativo. O envio pelo WhatsApp depende da conectividade dele.
7. Repita com uma foto grande, pouca memória e espaço reduzido. Registre a latência da primeira inferência, o tempo por correção, o pico de memória e se a PWA reabre e segmenta em modo avião.

A foto original fica em `test-fixtures/almofada-peixes.jpeg` e é usada localmente na aceitação. Ela fica fora dos builds distribuídos. As medições são do Chrome no Windows. Tempo e pico de memória ainda precisam ser medidos em Android físico.

## Comparar um modelo de segmentação alternativo

| Modelo | Evidência e custo para a PWA |
| --- | --- |
| EfficientSAM-Ti | O artigo reporta ganho de 3,6 AP no COCO e 5,5 no LVIS sobre MobileSAM naquela avaliação. O OpenCV publica ONNX FP32 de 48,3 MB e INT8 de 20,5 MB. Testar as duas variantes em WASM e avaliar uma exportação separada do codificador e decodificador para reutilizar o embedding entre toques. [Artigo](https://openaccess.thecvf.com/content/CVPR2024/papers/Xiong_EfficientSAM_Leveraged_Masked_Image_Pretraining_for_Efficient_Segment_Anything_CVPR_2024_paper.pdf) · [Arquivos OpenCV](https://huggingface.co/opencv/image_segmentation_efficientsam/tree/main) · [Exportação separada](https://github.com/yformer/EfficientSAM) |
| EfficientViT-SAM-L0 | Codificador de 512 px, exportação ONNX documentada e checkpoint de 139 MB. O benchmark publicado usa hardware de aceleração. Medir o pacote ONNX, memória e latência no navegador em Android antes de habilitar download offline. [Resultados e exportação](https://github.com/mit-han-lab/efficientvit/blob/master/applications/efficientvit_sam/README.md) · [Checkpoint](https://huggingface.co/mit-han-lab/efficientvit-sam/blob/main/efficientvit_sam_l0.pt) |
| SAM 2.1 Hiera Tiny | Modelo de 38,9 milhões de parâmetros com checkpoint Apache 2.0. Serve como referência de qualidade e exige testar a exportação para imagens, operadores WASM/WebGPU e consumo de RAM. Os números oficiais de velocidade são de uma A100. [Modelo e licença](https://github.com/facebookresearch/sam2) |

Priorizar EfficientSAM-Ti em um comparativo com a almofada e outras fotos de mobiliário com textura, oclusão e contato com o fundo. Usar as mesmas indicações nos dois modelos, anotar vazamento de fundo e perda de detalhes na borda e registrar quantos toques são necessários. Medir tamanho real do pacote, pico de memória, tempo da primeira inferência, tempo por correção e reabertura em modo avião em Android. Escolher o modelo com base nesses resultados.

## Testar duplicação e biblioteca

1. Em **Minhas montagens**, duplique uma montagem com camadas. Abra a cópia, altere uma sombra, salve e verifique a original. Exclua a cópia e reabra a original.
2. Ao terminar um recorte, escolha **Salvar em Meus Recortes**. Nomeie o item e abra a biblioteca pela tela inicial para verificar a miniatura e a transparência.
3. Abra uma montagem e use **Adicionar objeto → Meus Recortes** duas vezes. Mova apenas uma das camadas. Salve, repita em outra montagem, exclua o item da biblioteca e exporte ambas.
4. Na PWA, aguarde **Offline pronto**, desligue a conexão e repita a duplicação, a consulta à biblioteca e a exportação depois de reabrir o aplicativo.

## Testar backup e restauração

1. Aguarde **Offline pronto**, desligue a conexão e abra **Backup e Restauração** na tela inicial. Exporte uma montagem salva que use um item de **Meus Recortes**.
2. Importe o arquivo no mesmo navegador e confirme. Confira que os itens já salvos aparecem como ignorados e que as quantidades permanecem iguais ao repetir a importação.
3. Altere e salve a sombra de uma montagem. Importe o backup original novamente e verifique que as duas versões aparecem, cada uma com seus ajustes. Abra a versão restaurada e verifique camadas, transparência e edição da máscara.
