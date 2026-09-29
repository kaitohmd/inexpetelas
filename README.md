# INEXPETELAS

App para compartilhar telas com amigos. A sala é única e comporta até 8 pessoas. Não tem câmera, microfone nem áudio dos aplicativos compartilhados.

## Abrir

Baixe o launcher em [Releases](https://github.com/kaitohmd/inexpetelas/releases) e abra. Ele procura atualizações e instala o app no seu usuário. Depois, o próprio app também verifica atualizações.

## Usar

Entre na sala, escolha **Compartilhar tela** e selecione um monitor ou uma janela. Clique numa tela para vê-la em destaque; use **Esc** para voltar à grade. O perfil de imagem e o nome ficam salvos no computador.

## Desenvolvimento

No Windows, rode `npm ci` e depois `npm start`. Para criar o instalador, use `npm run dist`. Para criar o launcher, use `npm run dist:launcher`.

O app usa a Square Cloud para a sala e a sinalização, e o Cloudflare Realtime SFU para encaminhar as telas. As credenciais privadas do SFU ficam somente no servidor.
