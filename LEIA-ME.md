# INEXPETELAS

Aplicativo privado para Windows com uma sala fixa de até 8 pessoas. Cada pessoa escolhe nome e foto, salvos no próprio computador. Não há câmera, microfone ou chamada de voz: somente telas compartilhadas, áudio das transmissões e avisos sonoros.

## Abrir

Baixe o launcher na página Releases do GitHub e abra. A janela própria do INEXPETELAS aparece antes de procurar atualizações; na primeira execução, use **Instalar e abrir**. Ele baixa a versão atual, instala para o usuário sem pedir administrador e abre o app. Depois, o app instalado também verifica atualizações. Seus amigos não precisam instalar Node.js.

Para gerar o app/instalador a partir do código no Windows: `npm ci` e `npm run dist`. Para gerar a janelinha launcher independente e leve: `npm run dist:launcher`; o resultado fica em `installer/dist/INEXPETELAS.exe`. Para desenvolvimento, use `npm start`.

## Usar

Entre na sala e clique em **Compartilhar tela**. Escolha qualquer monitor ou janela listado. No Windows, o aplicativo solicita também o áudio do computador inteiro — mesmo quando você escolhe apenas uma janela. Se o sistema não fornecer uma faixa de áudio, a tela ainda é transmitida e aparece um aviso. Os amigos clicam em uma prévia para assistir em destaque e podem voltar para a grade ou escolher outra tela.

Enquanto você transmite, o app deixa de reproduzir o áudio de transmissões recebidas para evitar que esse som retorne para a sua própria transmissão e crie eco. Quando você para de transmitir, volta a ouvi-las. Os sons de abertura, entrada, saída e início/fim do compartilhamento continuam a 50% do volume.

## Testar e hospedar

O app já vem configurado para `wss://inexpetelas.squareweb.app`. Não é necessário configurar o servidor em cada PC. O código de acesso está embutido no cliente; quem obtiver o app ou o código-fonte pode entrar na sala.

Na Square Cloud, mantenha `ROOM_KEY`, o subdomínio `inexpetelas`, 512 MB e `node server.js` como inicialização. Configure também `REALTIME_SFU_APP_ID` e `REALTIME_SFU_API_TOKEN` como variáveis privadas do servidor. Nunca coloque o token da Cloudflare no app, no `.exe` ou no GitHub. `GITHUB_TOKEN` é opcional: como o repositório é público, a ponte `/updates/` pode buscar a Release mais recente sem token. Ela autentica os clientes usando `ROOM_KEY`.

Para publicar outra versão do app: aumente `version` no `package.json`, gere com `npm run dist`, crie uma Release no GitHub com a tag correspondente e anexe o instalador, `.blockmap` e `latest.yml` produzidos em `dist/`. Para atualizar o launcher, rode `npm run dist:launcher` e anexe o `.exe` de `installer/dist/`. A integração da Square faz deploy quando `server.js` muda em `main`.

## Telas e qualidade

A grade acomoda de uma a oito pessoas mantendo a proporção das prévias. Clique numa transmissão para abrir em tela cheia; mova o mouse para mostrar os controles e pressione Esc para voltar. A imagem inteira aparece por padrão. O botão Preencher ocupa o monitor cortando bordas quando as proporções diferem; Ajustar restaura a imagem inteira. Os botões inferiores alternam entre transmissores e o controle de volume atua na transmissão em foco.

No seletor de fonte, escolha Monitores ou Janelas e a qualidade: 720p/60 (padrão), 1080p/60 ou 720p/30. Enquanto ninguém assiste em destaque, envia-se só uma prévia 320×180/8 FPS. Ao abrir uma transmissão, ela sobe para a qualidade escolhida. O app também observa o relatório de carga do codificador; se o WebRTC reportar limitação de CPU por alguns segundos, reduz temporariamente a tela em destaque para 960×540/24 FPS e tenta restaurar a escolha após um período sem pressão. Isso é uma adaptação automática, não uma garantia de FPS do jogo. Com o SFU, cada transmissor envia uma única cópia da tela, independentemente do número de espectadores. Janelas minimizadas podem deixar de renderizar no Windows.

Validação: `npm test` testa o encaixe de 1–8 cards em diferentes resoluções. `electron tests/media-electron.cjs` usa duas janelas isoladas e vídeo sintético para verificar negociação simultânea, recepção nos dois sentidos, persistência dos vídeos e reinício de transmissão.

As telas são enviadas por WebRTC ao Cloudflare Realtime SFU, que encaminha a transmissão apenas aos participantes inscritos. A Square continua hospedando a sala, a presença e a sinalização; a mídia em tempo real passa pelo SFU da Cloudflare. O token da Cloudflare é usado exclusivamente no backend da Square. STUN ajuda a estabelecer a conexão; o uso de rede e o desempenho ainda dependem do computador de quem transmite, da conexão de internet e do tráfego de mídia.

**O áudio de origem está temporariamente desativado para evitar vazamento do Discord.** O loopback geral do sistema poderia incluir o Discord, então o app não captura nem envia áudio das janelas compartilhadas nesta versão. A captura seletiva é necessária para transmitir somente o app escolhido e excluir Discord; ela depende da API Application Loopback do Windows (build 20348 ou posterior) e ainda precisa de um helper nativo e testes com janelas, monitores e diferentes instalações. Se essa captura seletiva não estiver disponível, o app deve continuar sem áudio, nunca voltar ao loopback geral.
