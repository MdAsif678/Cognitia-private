import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import '../ui';
import { renderApiStatus } from '../config';

ReactDOM.createRoot(document.getElementById('playground')!).render(<React.StrictMode><App /></React.StrictMode>);
void renderApiStatus();
