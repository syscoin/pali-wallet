import { registerRootComponent } from 'expo';
import React from 'react';
import App from '../App';
import { initializeNativeLanguage } from './platform/localization';

void initializeNativeLanguage();
registerRootComponent(() => <App />);
