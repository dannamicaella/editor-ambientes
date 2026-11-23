# Licenças e créditos

A verificação usa a árvore fixada em `package-lock.json` e os arquivos de licença instalados. Os builds geram `THIRD-PARTY-NOTICES.txt` com os textos e avisos das dependências da aplicação.

| Dependência de aplicação | Licença |
| --- | --- |
| Vue 3 | MIT |
| Quasar Framework | MIT |
| Lucide para Vue | ISC e MIT para ícones derivados de Feather |
| DM Sans distribuída pelo Fontsource | SIL Open Font License 1.1 |
| Instrument Serif distribuída pelo Fontsource | SIL Open Font License 1.1 |
| MobileSAM, pesos oficiais exportados para ONNX | Apache 2.0 |
| ONNX Runtime Web 1.24.3 | MIT |
| Dependências transitivas da aplicação | MIT, ISC, BSD-2-Clause e BSD-3-Clause |

As licenças acima permitem uso comercial com as condições de cada licença, incluindo preservar avisos aplicáveis na redistribuição. As ferramentas de desenvolvimento são Vite e seu plugin Vue (MIT), ESLint e plugins (MIT e Apache-2.0) e Playwright (Apache-2.0). Dependências transitivas apenas de desenvolvimento incluem ainda BlueOak-1.0.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0 e 0BSD. Os binários Lightning CSS sob MPL-2.0 são ferramentas de build e ficam fora do pacote web.

A fotografia decorativa da tela inicial é *Furnished living room*, de Stephen Di Donato, publicada em 2016 sob CC0 1.0. A imagem é distribuída com o aplicativo para uso offline. [Ficha e licença no Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Furnished_living_room._(Unsplash).jpg)

Os pesos em `public/ai/mobilesam-v1/` derivam do checkpoint oficial MobileSAM. O manifesto informa o commit e os hashes dos artefatos. A licença acompanha o modelo. O build inclui os avisos da distribuição do ONNX Runtime Web. O pacote transitivo `guid-typescript@1.0.9` declara ISC no npm e é acompanhado da atribuição e do texto aplicável. [MobileSAM](https://github.com/ChaoningZhang/MobileSAM/blob/master/LICENSE) · [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/blob/main/js/web/package.json) · [guid-typescript](https://www.npmjs.com/package/guid-typescript/v/1.0.9)
