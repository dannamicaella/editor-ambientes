# Arquitetura

O Editor de Ambientes é uma SPA estática em Vue 3. Quasar fornece diálogos, botões e indicadores de progresso em português. A Canvas API desenha as fotos e os recortes. A mesma função de desenho dos objetos é usada na visualização e na exportação.

## Módulos

| Local | Responsabilidade |
| --- | --- |
| `src/App.vue`, `src/pages/` | Tela inicial, navegação, lista de projetos e ciclo de edição |
| `src/components/ImageSource.vue`, `src/services/camera.js`, `src/services/images.js` | Seleção local, captura nativa pelo seletor Android, decodificação respeitando EXIF e cópia de trabalho |
| `src/components/CutoutEditor.vue`, `src/utils/contour.js` | Eventos de ponteiro, desenho, pan, zoom e rasterização do contorno |
| `src/services/mobileSam*.js`, `src/services/masks.js` | Cliente e Worker do MobileSAM, projeção de indicações e composição com o alfa original |
| `src/composables/useMaskHistory.js` | Pincéis e desfazer/refazer por trajetória |
| `src/components/CompositionStage.vue`, `LayerInspector.vue` | Manipulação, navegação, transformações e camadas |
| `src/components/ShadowControls.vue`, `src/services/shadows.js` | Ajustes de sombra e rasterização das silhuetas ambiente e de contato |
| `src/composables/projectModel.js`, `useProject.js`, `history.js` | Estado, histórico e coleta de ativos sem referência |
| `src/services/projects.js` | Projetos, ativos e miniaturas no IndexedDB |
| `src/components/CutoutLibrary.vue`, `NameDialog.vue` | Biblioteca de recortes e formulários locais de nomes |
| `src/services/backup.js`, `src/services/backupContent.js`, `src/components/BackupDialog.vue` | Formato do backup, verificação, comparação de conteúdo e fluxo de restauração |
| `src/services/export.js`, `src/components/ExportDialog.vue` | Renderização em resolução própria, codificação, download e Web Share |
| `src/services/pwa.js`, `tools/sw-template.js`, `vite.config.js` | Instalação, geração do precache e verificação de disponibilidade offline |

## Segmentação interativa no navegador

O MobileSAM usa os pesos oficiais, exportados como codificador TinyViT e decodificador de indicações ONNX. O navegador executa ambos num Web Worker pelo ONNX Runtime Web. A forma do objeto vem dos logits de segmentação.

1. O fim de um toque é mapeado para coordenadas normalizadas da foto orientada, considerando zoom e posição. Um toque de sentido oposto junto a outro ponto substitui a marca anterior. O contorno guia gera a caixa passada ao modelo.
2. O Worker preserva a proporção, normaliza RGB e preenche a entrada até 1.024 × 1.024. Com um contorno guia, a inferência usa a região da caixa com margem. O decodificador reutiliza a representação da foto e os logits da última máscara aceita quando a região de inferência coincide. Um ponto positivo fora da região codificada solicita nova análise da imagem inteira. O cliente tenta WebGPU e recria o Worker em WASM se o backend falhar.
3. O editor faz uma inferência por vez e aplica apenas a previsão para a seleção mais recente. O escore combina a confiança do modelo, as indicações, a sobreposição com a máscara anterior e a área de lacunas internas sem indicação. A seleção preserva pequenas lacunas na máscara como partes do objeto, regiões internas já aceitas e áreas internas marcadas com Manter. Pontos negativos explícitos permitem excluir essas áreas. Os logits de 256 × 256 são interpolados e rasterizados na resolução original, com antialiasing e o alfa original da foto.
4. O recorte manual por contorno fica disponível em caso de falha da IA. A máscara resultante e os traços dos pincéis compartilham o mesmo fluxo de histórico e exportação.

## Coordenadas, mídia e armazenamento

- Os centros de objetos são normalizados em relação à largura e altura do fundo. A escala usa o menor lado do fundo, com proporção preservada. As mudanças por gesto usam um rascunho de transformação durante o movimento e uma entrada no histórico por gesto concluído.
- A prévia usa bitmaps reduzidos e liberta os removidos. A exportação decodifica cada camada conforme a dimensão de destino e descarta o bitmap após desenhá-lo.
- Cada camada armazena os ajustes de sombra. A renderização usa a mesma silhueta ambiente e uma projeção concentrada da base do recorte na prévia e na exportação. Os deslocamentos seguem os eixos do objeto e o tamanho é proporcional à camada. O raster de cada sombra tem resolução limitada e é reaproveitado até os parâmetros relevantes ou a imagem mudarem. Montagens antigas com sombra ativa preservam sua aparência até o primeiro ajuste.
- Projetos e camadas referenciam ativos por ID. Cada objeto guarda o Blob original, um PNG de máscara e um PNG do recorte. Camadas duplicadas e recortes reutilizados compartilham o ativo imutável. Editar uma máscara cria um novo ativo para a camada selecionada. Os históricos retêm os ativos referenciados durante a sessão.
- O histórico de composição guarda até 40 estados de metadados. O histórico da máscara guarda os traços de pincel da sessão e permite desfazer os 24 mais recentes. O editor reaplica os traços ao atualizar a máscara por IA.
- Miniaturas, metadados e ativos do projeto são salvos numa transação de IndexedDB. Exclusão também é transacional. Em abas diferentes a última gravação concluída para o mesmo projeto prevalece.

### Montagens duplicadas e Meus Recortes

A versão 2 do IndexedDB introduziu `media` para os ativos imutáveis e `cutouts` para os nomes, miniaturas PNG e referências da biblioteca. A tabela `assets` mantém as referências por montagem, com um índice para encontrar seus vínculos com `media`. A biblioteca lista só os metadados e as miniaturas e carrega a imagem em tamanho integral ao visualizar ou adicionar um recorte.

A atualização do banco preserva os registros v1. A abertura interpreta tanto os ativos do formato anterior, armazenados na própria montagem, quanto as novas referências. Ao salvar ou duplicar uma montagem antiga, uma transação converte seus ativos em referências. Duplicar copia os dados editáveis e preserva os mesmos arquivos de imagem e a miniatura, sem recomprimir. As camadas reutilizadas ganham IDs próprios e guardam o nome que tinham ao ser adicionadas.

As exclusões consultam os índices de montagens e de recortes na mesma transação. O ativo compartilhado é removido somente quando perde a última referência persistida. Um editor já aberto conserva seus ativos em memória, inclusive no histórico. Ele pode gravá-los novamente ao salvar, mesmo que uma entrada da biblioteca tenha sido excluída em outra aba.

### Backup e restauração

O `.eabackup` v1 contém um cabeçalho de 48 bytes, um manifesto JSON em UTF‑8 e os blobs originais em sequência. O cabeçalho contém a assinatura `EABACKUP`, a versão e o comprimento JSON em big-endian e o SHA‑256 do manifesto. Cada blob tem comprimento, tipo de imagem e um SHA‑256 da concatenação dos hashes binários dos blocos de até 1 MiB. O arquivo tem limites de 16 MiB para o manifesto e 256 MiB por imagem. A verificação usa fatias binárias, sem decodificar fotos, e o backup inclui somente os registros e imagens necessários para montagens e recortes salvos.

Uma transação de leitura obtém um estado consistente para exportação. Os ativos antigos armazenados em `assets` ganham referências na representação do backup. Ao restaurar, o editor valida estrutura, referências, cabeçalhos de imagem e somas de verificação antes de comparar os dados. As assinaturas incluem os registros editáveis completos com chaves ordenadas, a ordem das camadas e os hashes da foto, do recorte e da máscara. IDs, datas da biblioteca e miniaturas ficam fora da assinatura. As referências são comparadas pelo conteúdo das imagens.

A restauração grava apenas itens novos, reaproveita mídias compartilhadas equivalentes e remapeia os IDs que colidem com dados diferentes. Cada gravação de montagens ou recortes atualiza a revisão local na tabela `imports` do banco v3. Depois de comparar o conteúdo fora do IndexedDB, a transação de importação verifica a revisão e repete a comparação se outra aba tiver alterado os dados. Isso preserva a atomicidade sem manter a transação aberta durante o cálculo dos hashes. O formato v1 continua compatível com backups anteriores. A estimativa de cota é consultada no painel e antes da restauração.

## Offline

O build PWA gera o Service Worker com uma lista de arquivos do build e uma versão derivada do conteúdo. A instalação só conclui depois do cache dos arquivos essenciais, incluindo Worker, imagem, fontes e ícones. A página só indica **Offline pronto** após o Service Worker controlador conferir cada entrada. O cache usa um namespace por escopo. A atualização espera que a versão antiga deixe de controlar suas abas e remove caches obsoletos durante a ativação. O cache do aplicativo e as montagens armazenadas no IndexedDB têm ciclos de vida independentes.

Os pesos e binários de inferência têm cache opcional por versão. Entram no cache ao usar a IA pela primeira vez, e a interface sinaliza **IA disponível offline** quando o Service Worker confirma os arquivos do backend usado. Os SHA-256 das exportações ONNX são verificados antes de abrir as sessões. O codificador viaja em dois arquivos menores e é remontado no dispositivo, permitindo hospedagem estática com limite de 25 MiB por arquivo. A inferência e as fotografias ficam no navegador.
