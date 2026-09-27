# INEXPETELAS

Aplicativo privado para Windows com uma sala fixa de até 8 pessoas. Cada pessoa escolhe nome e foto, salvos no próprio computador. Não há câmera, microfone ou chamada de voz: somente telas compartilhadas, áudio das transmissões e avisos sonoros.

## Abrir

Clique em `abrir-app.bat`. Ele é o inicializador de desenvolvimento; o instalador `.exe` pode ser criado depois. A abertura mostra uma tela de carregamento de cerca de 5 segundos.

## Usar

Entre na sala e clique em **Compartilhar tela**. Escolha qualquer monitor ou janela listado. No Windows, o aplicativo solicita também o áudio do computador inteiro — mesmo quando você escolhe apenas uma janela. Se o sistema não fornecer uma faixa de áudio, a tela ainda é transmitida e aparece um aviso. Os amigos clicam em uma prévia para assistir em destaque e podem voltar para a grade ou escolher outra tela.

Enquanto você transmite, o app deixa de reproduzir o áudio de transmissões recebidas para evitar que esse som retorne para a sua própria transmissão e crie eco. Quando você para de transmitir, volta a ouvi-las. Os sons de abertura, entrada, saída e início/fim do compartilhamento continuam a 50% do volume.

## Testar e hospedar

Para testar neste computador, abra um terminal nesta pasta e execute `npm run server`. O app vem configurado para `ws://localhost:3000`.

Para usar com amigos, hospede `server.js` na Square Cloud como aplicação Node.js e configure `ROOM_KEY` com um código longo e exclusivo. Quando o servidor estiver pronto, o endereço seguro `wss://...` e o código serão colocados diretamente na versão distribuída do app. Sem `ROOM_KEY`, o servidor só aceita conexões locais.

Vídeo e áudio são enviados diretamente entre os computadores por WebRTC. Redes restritivas podem precisar de TURN, ainda não incluído. Muitas telas ao mesmo tempo podem exigir bastante upload de quem transmite. Teste o áudio do sistema entre dois PCs Windows antes de distribuir o app.
