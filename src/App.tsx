// App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import './global.css';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { WordListPage } from './pages/WordListPage';
import { WordEditPage } from './pages/WordEditPage';
import {
  ROUTE_SIGN_IN,
  ROUTE_SIGN_UP,    
  ROUTE_USER_WORDS,
  ROUTE_USER_WORDS_EDIT,
} from '~/constants/routes';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-root bg-black text-light min-vh-100">
        <Routes>
          <Route path={ROUTE_SIGN_IN} element={<SignInPage />} />
          <Route path={ROUTE_SIGN_UP} element={<SignUpPage />} />
          <Route path={ROUTE_USER_WORDS} element={<WordListPage />} />
          <Route path={ROUTE_USER_WORDS_EDIT} element={<WordEditPage />} />          

          {/* Default Page */}
          <Route path="*" element={<Navigate to={ROUTE_SIGN_IN} replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
