import React from 'react';
import { createRoot } from 'react-dom/client';
import '../popup/styles.css';
import './report.css';
import ReportApp from './ReportApp';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ReportApp /></React.StrictMode>,
);
