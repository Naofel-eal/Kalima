import './style.css';
import { bootstrap } from './app';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const root = document.getElementById('app');
if (root) bootstrap(root);
