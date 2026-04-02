import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { SkyExplorer } from './components/sky/SkyExplorer';
import { TargetDetail } from './components/detail/TargetDetail';
import { LabView } from './components/lab/LabView';
import { MyAnalyses } from './components/pages/MyAnalyses';
import { Settings } from './components/pages/Settings';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <SkyExplorer /> },
      { path: '/target/:targetId', element: <TargetDetail /> },
      { path: '/lab/:targetId', element: <LabView /> },
      { path: '/my', element: <MyAnalyses /> },
      { path: '/settings', element: <Settings /> },
    ],
  },
]);
