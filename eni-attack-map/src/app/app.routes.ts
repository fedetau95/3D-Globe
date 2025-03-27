import { Routes } from '@angular/router';
import { GlobeComponent } from './components/globe/globe.component';

export const routes: Routes = [
  {
    path: '',
    component: GlobeComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];