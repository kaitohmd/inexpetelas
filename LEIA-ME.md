# INEXPETELAS

Aplicativo privado para Windows com uma sala fixa de até 8 pessoas. Cada pessoa escolhe nome e foto, salvos no próprio computador. Não há câmera, microfone ou chamada de voz: somente telas compartilhadas, áudio das transmissões e avisos sonoros.

## Abrir

Baixe o instalador mais recente na página Releases do GitHub, execute e conclua a instalação. O instalador inclui o Electron, cria atalhos e permite desinstalar pelo Windows. Seus amigos não precisam instalar Node.js. O próprio app verifica versões ao abrir, baixa atualizações e mostra o progresso numa janela INEXPETELAS.

Para gerar o instalador a partir do código no Windows: `npm ci` e `npm run dist`. O resultado fica em `dist/`. Para desenvolvimento, use `npm start`.

## Usar

Entre na sala e clique em **Compartilhar tela**. Escolha qualquer monitor ou janela listado. No Windows, o aplicativo solicita também o áudio do computador inteiro — mesmo quando você escolhe apenas uma janela. Se o sistema não fornecer uma faixa de áudio, a tela ainda é transmitida e aparece um aviso. Os amigos clicam em uma prévia para assistir em destaque e podem voltar para a grade ou escolher outra tela.

Enquanto você transmite, o app deixa de reproduzir o áudio de transmissões recebidas para evitar que esse som retorne para a sua própria transmissão e crie eco. Quando você para de transmitir, volta a ouvi-las. Os sons de abertura, entrada, saída e início/fim do compartilhamento continuam a 50% do volume.

## Testar e hospedar

O app já vem configurado para `wss://inexpetelas.squareweb.app`. Não é necessário configurar o servidor em cada PC. O código de acesso está embutido no cliente privado; quem receber o app também recebe acesso à sala. Não distribua publicamente.

Na Square Cloud, mantenha `ROOM_KEY`, o subdomínio `inexpetelas`, 512 MB e `node server.js` como inicialização. Configure também `GITHUB_TOKEN` como segredo com acesso de leitura somente ao conteúdo do repositório privado `kaitohmd/inexpetelas` (a API de Releases e os instaladores privados usam essa permissão). O arquivo `squarecloud.app` registra os parâmetros; substitua o texto de exemplo pelo token real no painel, sem gravá-lo no Git. A ponte `/updates/` autentica o app com `ROOM_KEY` e busca no GitHub a versão mais recente publicada. O app usa o instalador NSIS para atualizar dentro da própria instalação.

Para publicar outra versão: aumente `version` no `package.json`, gere com `npm run dist`, crie uma Release no GitHub com a tag correspondente e anexe `INEXPETELAS-Setup-<versão>.exe`, o arquivo `.blockmap` e `latest.yml` produzidos em `dist/`. A Square procura automaticamente a Release mais recente; em novas versões do servidor, faça deploy na Square também. O token só deve existir nas variáveis de ambiente da Square e ter acesso de leitura.

## Telas e qualidade

A grade acomoda de uma a oito pessoas mantendo a proporção das prévias. Clique numa transmissão para abrir em tela cheia; mova o mouse para mostrar os controles e pressione Esc para voltar. A imagem inteira aparece por padrão. O botão Preencher ocupa o monitor cortando bordas quando as proporções diferem; Ajustar restaura a imagem inteira. Os botões inferiores alternam entre transmissores e o controle de volume atua na transmissão em foco.

No seletor de fonte, escolha Monitores ou Janelas e a qualidade: 720p/60 (padrão), 1080p/60 ou 720p/30. O teto por espectador é de 5, 8 ou 3 Mbps respectivamente, com orçamento total de vídeo de 16 Mbps. O WebRTC pode diminuir a qualidade sob congestionamento; 60 FPS é uma meta, não uma garantia. Janelas minimizadas podem deixar de renderizar no Windows.

Validação: `npm test` testa o encaixe de 1–8 cards em diferentes resoluções. `electron tests/media-electron.cjs` usa duas janelas isoladas e vídeo sintético para verificar negociação simultânea, recepção nos dois sentidos, persistência dos vídeos e reinício de transmissão.

Vídeo e áudio são enviados diretamente entre os computadores por WebRTC. Redes restritivas podem precisar de TURN, ainda não incluído. Muitas telas ao mesmo tempo podem exigir bastante upload de quem transmite. Teste o áudio do sistema entre dois PCs Windows antes de distribuir o app.
