const title = document.querySelector('#title');
const message = document.querySelector('#message');
const install = document.querySelector('#install');
const progress = document.querySelector('#progress-wrap');
const bar = document.querySelector('#bar');
const percent = document.querySelector('#percent');

install.addEventListener('click', () => {
  install.disabled = true;
  window.setup.install();
});
document.querySelector('#downloads').addEventListener('click', () => window.setup.openDownloads());

window.setup.onState(state => {
  if (state.type === 'checking') {
    title.textContent = 'Procurando a versão mais recente';
    message.textContent = 'Só um instante.';
  } else if (state.type === 'downloading') {
    title.textContent = `Baixando INEXPETELAS ${state.version}`;
    message.textContent = 'O app será instalado automaticamente ao terminar.';
    progress.hidden = percent.hidden = false;
    bar.style.width = `${state.percent}%`;
    percent.textContent = `${state.percent}%`;
  } else if (state.type === 'installing') {
    title.textContent = 'Instalando';
    message.textContent = 'Já vamos abrir o INEXPETELAS.';
    progress.hidden = percent.hidden = true;
  } else if (state.type === 'error') {
    title.textContent = 'Não foi possível instalar';
    message.textContent = state.message;
    install.disabled = false;
    install.textContent = 'Tentar de novo';
  }
});
