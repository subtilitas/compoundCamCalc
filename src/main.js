import './ui/style.css';

const version = document.getElementById('app-version');
if (version) version.textContent = `v${__APP_VERSION__}`;
