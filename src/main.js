import './ui/style.css';
import { startApp } from './ui/app.js';

const version = document.getElementById('app-version');
if (version) version.textContent = `v${__APP_VERSION__}`;

startApp();
